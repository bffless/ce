import { RequestLogService } from './request-log.service';
import { TrafficEventsService } from './traffic-events.service';
import { TrafficEvent } from './traffic-event.interface';

// Mock the db client with a thenable chainable: every builder method returns
// the chain, and awaiting the chain consumes the next queued result (in the
// order the service awaits its queries). Mirrors proxy-rules.service.spec.
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'values',
    'onConflictDoUpdate',
    'update',
    'set',
    'delete',
  ];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) {
    chainable[method] = jest.fn(() => chainable);
  }
  chainable.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

import { db } from '../db/client';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

/** postgres.js DELETE results are array-likes carrying a count property. */
const deleteResult = (count: number) => Object.assign([], { count });

const makeEvent = (overrides: Partial<TrafficEvent> = {}): TrafficEvent => ({
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
  ...overrides,
});

describe('RequestLogService', () => {
  const envBackup = { ...process.env };
  let events: TrafficEventsService;

  const makeService = () => new RequestLogService(events);

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env.TRAFFIC_LOG_ENABLED;
    delete process.env.TRAFFIC_LOG_RETENTION_DAYS;
    delete process.env.TRAFFIC_LOG_MAX_ROWS;
    delete process.env.TRAFFIC_LOG_MAX_IPS;
    mockDb.__reset();
    events = new TrafficEventsService();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  describe('configuration', () => {
    it('uses bounded-retention defaults', () => {
      const service = makeService();
      expect(service.enabled).toBe(true);
      expect(service.retentionDays).toBe(14);
      expect(service.maxRows).toBe(100_000);
      expect(service.maxIps).toBe(50_000);
    });

    it('honours env overrides and rejects garbage values', () => {
      process.env.TRAFFIC_LOG_RETENTION_DAYS = '30';
      process.env.TRAFFIC_LOG_MAX_ROWS = 'not-a-number';
      process.env.TRAFFIC_LOG_MAX_IPS = '-5';
      const service = makeService();
      expect(service.retentionDays).toBe(30);
      expect(service.maxRows).toBe(100_000);
      expect(service.maxIps).toBe(50_000);
    });
  });

  describe('persistence', () => {
    it('persists only the non-matched subset of observed events', async () => {
      const service = makeService();
      service.observe(makeEvent({ classification: 'matched', status: 200 }));
      await service.flush();
      expect(mockDb.insert).not.toHaveBeenCalled();

      service.observe(makeEvent());
      await service.flush();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('maps the TrafficEvent onto a traffic_requests row', async () => {
      const service = makeService();
      service.observe(makeEvent());
      await service.flush();

      const rows = mockDb.values.mock.calls[0][0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ip: '203.0.113.7',
        method: 'GET',
        path: '/backend/.env',
        httpVersion: '1.1',
        status: 404,
        bytes: 42,
        userAgent: 'scanner',
        host: 'j5s.dev',
        classification: 'unmatched',
      });
      expect(rows[0].timestamp).toEqual(new Date('2026-07-02T09:05:03.000Z'));
    });

    it('creates a rollup row for a first-seen IP with capped samples', async () => {
      const service = makeService();
      service.observe(makeEvent({ path: '/.env' }));
      service.observe(makeEvent({ path: '/wp-login.php', userAgent: 'other-scanner' }));
      // rollup lookup finds nothing for this IP
      mockDb.__queue([]); // insert traffic_requests
      mockDb.__queue([]); // select existing rollup -> none
      await service.flush();

      // second values() call is the rollup insert
      const rollup = mockDb.values.mock.calls[1][0];
      expect(rollup).toMatchObject({
        ip: '203.0.113.7',
        requestCount: 2,
        samplePaths: ['/.env', '/wp-login.php'],
        sampleUserAgents: ['scanner', 'other-scanner'],
      });
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('increments an existing rollup and merges samples without duplicates', async () => {
      const service = makeService();
      service.observe(makeEvent({ path: '/.env' }));
      service.observe(makeEvent({ path: '/phpmyadmin' }));

      mockDb.__queue([]); // insert traffic_requests
      mockDb.__queue([
        {
          id: 'rollup-1',
          ip: '203.0.113.7',
          requestCount: 10,
          firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
          lastSeenAt: new Date('2026-06-30T00:00:00.000Z'),
          samplePaths: ['/.env'],
          sampleUserAgents: ['scanner'],
        },
      ]);
      await service.flush();

      expect(mockDb.update).toHaveBeenCalled();
      const set = mockDb.set.mock.calls[0][0];
      expect(set.requestCount).toBe(12);
      expect(set.firstSeenAt).toEqual(new Date('2026-06-01T00:00:00.000Z'));
      expect(set.lastSeenAt).toEqual(new Date('2026-07-02T09:05:03.000Z'));
      expect(set.samplePaths).toEqual(['/.env', '/phpmyadmin']);
      expect(set.sampleUserAgents).toEqual(['scanner']);
    });

    it('subscribes on module init and flushes on destroy', async () => {
      const service = makeService();
      service.onModuleInit();
      events.emit(makeEvent());
      await service.onModuleDestroy();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('does nothing when TRAFFIC_LOG_ENABLED=false', async () => {
      process.env.TRAFFIC_LOG_ENABLED = 'false';
      const service = makeService();
      service.onModuleInit();
      events.emit(makeEvent());
      await service.onModuleDestroy();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('retention and row caps', () => {
    it('prunes by age and trims both tables to their caps', async () => {
      process.env.TRAFFIC_LOG_MAX_ROWS = '10';
      process.env.TRAFFIC_LOG_MAX_IPS = '5';
      const service = makeService();

      mockDb.__queue(deleteResult(3)); // requests age prune
      mockDb.__queue([{ value: 12 }]); // requests count -> 2 over cap
      mockDb.__queue([{ id: 'a' }, { id: 'b' }]); // oldest victims
      mockDb.__queue(deleteResult(2)); // victim delete
      mockDb.__queue(deleteResult(1)); // rollups age prune
      mockDb.__queue([{ value: 7 }]); // rollup count -> 2 over cap
      mockDb.__queue([{ id: 'r1' }, { id: 'r2' }]); // stalest rollups
      mockDb.__queue(deleteResult(2)); // rollup victim delete

      const summary = await service.prune();
      expect(summary).toEqual({
        requestsDeletedByAge: 3,
        requestsDeletedOverCap: 2,
        rollupsDeletedByAge: 1,
        rollupsDeletedOverCap: 2,
      });
      expect(mockDb.delete).toHaveBeenCalledTimes(4);
    });

    it('deletes nothing when within bounds', async () => {
      const service = makeService();
      mockDb.__queue(deleteResult(0)); // requests age prune
      mockDb.__queue([{ value: 100 }]); // under cap
      mockDb.__queue(deleteResult(0)); // rollups age prune
      mockDb.__queue([{ value: 10 }]); // under cap

      const summary = await service.prune();
      expect(summary).toEqual({
        requestsDeletedByAge: 0,
        requestsDeletedOverCap: 0,
        rollupsDeletedByAge: 0,
        rollupsDeletedOverCap: 0,
      });
      // only the two age-prune deletes ran; no victim selection
      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('read API', () => {
    const dbRow = {
      id: 'row-1',
      timestamp: new Date('2026-07-02T09:05:03.000Z'),
      ip: '203.0.113.7',
      method: 'GET',
      path: '/backend/.env',
      httpVersion: '1.1',
      status: 404,
      bytes: 42,
      referer: null,
      userAgent: 'scanner',
      host: 'j5s.dev',
      classification: 'unmatched' as const,
      createdAt: new Date('2026-07-02T09:05:04.000Z'),
    };

    it('lists requests with pagination metadata and rendered log lines', async () => {
      const service = makeService();
      mockDb.__queue([{ value: 101 }]); // count
      mockDb.__queue([dbRow]); // page rows

      const result = await service.listRequests({ ip: '203.0.113.7' }, 2, 50);
      expect(result.total).toBe(101);
      expect(result.totalPages).toBe(3);
      expect(result.page).toBe(2);
      expect(result.data[0].timestamp).toBe('2026-07-02T09:05:03.000Z');
      expect(result.data[0].line).toContain('203.0.113.7 - - [02/Jul/2026:09:05:03 +0000]');
      expect(result.data[0].line).toContain('"GET /backend/.env HTTP/1.1" 404 42');
      expect(mockDb.offset).toHaveBeenCalledWith(50);
    });

    it('lists the per-IP rollup with pagination', async () => {
      const service = makeService();
      const rollup = {
        id: 'rollup-1',
        ip: '203.0.113.7',
        requestCount: 12,
        firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
        lastSeenAt: new Date('2026-07-02T09:05:03.000Z'),
        samplePaths: ['/.env'],
        sampleUserAgents: ['scanner'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.__queue([{ value: 1 }]);
      mockDb.__queue([rollup]);

      const result = await service.listIpRollups({}, 'requestCount', 'desc', 1, 50);
      expect(result.total).toBe(1);
      expect(result.data[0].ip).toBe('203.0.113.7');
    });

    it('exports requests as CSV with proper escaping', async () => {
      const service = makeService();
      mockDb.__queue([{ ...dbRow, path: '/a,b', userAgent: 'quote "ua"' }]);

      const csv = await service.exportRequests({}, 'csv', 100);
      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'timestamp,ip,method,path,status,bytes,referer,userAgent,host,classification',
      );
      expect(lines[1]).toContain('"/a,b"');
      expect(lines[1]).toContain('"quote ""ua"""');
    });

    it('exports requests as JSON', async () => {
      const service = makeService();
      mockDb.__queue([dbRow]);

      const json = await service.exportRequests({}, 'json', 100);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].ip).toBe('203.0.113.7');
      expect(parsed[0].line).toContain('404');
    });

    it('exports the rollup as CSV', async () => {
      const service = makeService();
      mockDb.__queue([
        {
          id: 'rollup-1',
          ip: '203.0.113.7',
          requestCount: 12,
          firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
          lastSeenAt: new Date('2026-07-02T09:05:03.000Z'),
          samplePaths: ['/.env', '/wp-login.php'],
          sampleUserAgents: ['scanner'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const csv = await service.exportIpRollups({}, 'csv', 100);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('ip,requestCount,firstSeenAt,lastSeenAt,samplePaths,sampleUserAgents');
      expect(lines[1]).toContain('203.0.113.7,12,2026-06-01T00:00:00.000Z');
      expect(lines[1]).toContain('/.env /wp-login.php');
    });
  });
});
