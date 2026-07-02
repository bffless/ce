import { MessageEvent } from '@nestjs/common';
import { Request, Response } from 'express';
import { ROLES_KEY } from '../auth/roles.guard';
import { TrafficController } from './traffic.controller';
import { TrafficEventsService } from './traffic-events.service';
import { TrafficEvent } from './traffic-event.interface';
import { RequestLogService } from './request-log.service';

// bcrypt is a native module the auth barrel imports transitively; mock it like
// the other guard specs do so the suite runs without the compiled binding.
jest.mock('bcrypt');
// RequestLogService imports the db client; keep this spec db-free.
jest.mock('../db/client', () => ({ db: {} }));

describe('TrafficController', () => {
  let controller: TrafficController;
  let events: TrafficEventsService;
  let requestLog: jest.Mocked<RequestLogService>;

  const sampleEvent: TrafficEvent = {
    id: '1',
    timestamp: '2026-07-02T09:05:03.000Z',
    ip: '203.0.113.7',
    method: 'GET',
    path: '/backend/.env',
    httpVersion: '1.1',
    status: 404,
    bytes: 42,
    referer: null,
    userAgent: 'scanner',
    host: 'j5s.dev',
    classification: 'unmatched',
    line: 'formatted line',
  };

  const makeReq = () => ({ res: { setHeader: jest.fn() } }) as unknown as Request;

  const makeRes = () =>
    ({ setHeader: jest.fn(), send: jest.fn() }) as unknown as Response;

  beforeEach(() => {
    events = new TrafficEventsService();
    requestLog = {
      listRequests: jest.fn(),
      listIpRollups: jest.fn(),
      exportRequests: jest.fn(),
      exportIpRollups: jest.fn(),
    } as unknown as jest.Mocked<RequestLogService>;
    controller = new TrafficController(events, requestLog);
  });

  it('is admin-only: every handler carries the admin roles metadata', () => {
    for (const handler of [
      controller.stream,
      controller.listRequests,
      controller.exportRequests,
      controller.listIpRollups,
      controller.exportIpRollups,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin']);
    }
  });

  it('is guarded: controller declares ApiKeyGuard + RolesGuard', () => {
    const guards = Reflect.getMetadata('__guards__', TrafficController) ?? [];
    const guardNames = guards.map((g: any) => g.name);
    expect(guardNames).toEqual(expect.arrayContaining(['ApiKeyGuard', 'RolesGuard']));
  });

  it('relays observed requests to SSE subscribers as "request" events', (done) => {
    const received: MessageEvent[] = [];
    const subscription = controller.stream(makeReq()).subscribe((message) => {
      received.push(message);
      subscription.unsubscribe();
      expect(received[0]).toEqual({ type: 'request', data: sampleEvent });
      done();
    });

    events.emit(sampleEvent);
  });

  it('disables proxy buffering on the stream response', () => {
    const req = makeReq();
    controller.stream(req).subscribe().unsubscribe();
    expect(req.res!.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  });

  describe('Request-log read API', () => {
    it('lists requests with default pagination and passes filters through', async () => {
      requestLog.listRequests.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });
      await controller.listRequests({ ip: '203.0.113.7', status: 404 });
      expect(requestLog.listRequests).toHaveBeenCalledWith(
        { ip: '203.0.113.7', status: 404 },
        1,
        50,
      );
    });

    it('lists the per-IP rollup with default sort (worst offenders first)', async () => {
      requestLog.listIpRollups.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });
      await controller.listIpRollups({});
      expect(requestLog.listIpRollups).toHaveBeenCalledWith({}, 'requestCount', 'desc', 1, 50);
    });

    it('exports the Request log as a CSV attachment', async () => {
      requestLog.exportRequests.mockResolvedValue('a,b\n1,2');
      const res = makeRes();
      await controller.exportRequests({ classification: 'unmatched' }, res);
      expect(requestLog.exportRequests).toHaveBeenCalledWith(
        { classification: 'unmatched' },
        'csv',
        10_000,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="request-log.csv"',
      );
      expect(res.send).toHaveBeenCalledWith('a,b\n1,2');
    });

    it('exports the rollup as JSON when requested', async () => {
      requestLog.exportIpRollups.mockResolvedValue('[]');
      const res = makeRes();
      await controller.exportIpRollups({ format: 'json', limit: 5 }, res);
      expect(requestLog.exportIpRollups).toHaveBeenCalledWith({}, 'json', 5);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.send).toHaveBeenCalledWith('[]');
    });
  });
});
