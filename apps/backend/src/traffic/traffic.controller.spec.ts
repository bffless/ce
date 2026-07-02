import { MessageEvent } from '@nestjs/common';
import { Request } from 'express';
import { ROLES_KEY } from '../auth/roles.guard';
import { TrafficController } from './traffic.controller';
import { TrafficEventsService } from './traffic-events.service';
import { TrafficEvent } from './traffic-event.interface';

// bcrypt is a native module the auth barrel imports transitively; mock it like
// the other guard specs do so the suite runs without the compiled binding.
jest.mock('bcrypt');

describe('TrafficController', () => {
  let controller: TrafficController;
  let events: TrafficEventsService;

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

  beforeEach(() => {
    events = new TrafficEventsService();
    controller = new TrafficController(events);
  });

  it('is admin-only: stream handler carries the admin roles metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.stream);
    expect(roles).toEqual(['admin']);
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
});
