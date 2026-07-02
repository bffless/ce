import { TrafficRetentionScheduler } from './traffic-retention.scheduler';
import { RequestLogService } from './request-log.service';

jest.mock('../db/client', () => ({ db: {} }));

const emptySummary = {
  requestsDeletedByAge: 0,
  requestsDeletedOverCap: 0,
  rollupsDeletedByAge: 0,
  rollupsDeletedOverCap: 0,
};

describe('TrafficRetentionScheduler', () => {
  const makeRequestLog = (overrides: Partial<RequestLogService> = {}) =>
    ({
      enabled: true,
      prune: jest.fn().mockResolvedValue(emptySummary),
      ...overrides,
    }) as unknown as jest.Mocked<RequestLogService>;

  it('prunes on schedule', async () => {
    const requestLog = makeRequestLog();
    const scheduler = new TrafficRetentionScheduler(requestLog);
    await scheduler.handleRetention();
    expect(requestLog.prune).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the Request log is disabled', async () => {
    const requestLog = makeRequestLog({ enabled: false } as Partial<RequestLogService>);
    const scheduler = new TrafficRetentionScheduler(requestLog);
    await scheduler.handleRetention();
    expect(requestLog.prune).not.toHaveBeenCalled();
  });

  it('skips a run while the previous one is still in progress', async () => {
    let release!: () => void;
    let calls = 0;
    const requestLog = makeRequestLog({
      prune: jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return new Promise((resolve) => {
            release = () => resolve(emptySummary);
          });
        }
        return Promise.resolve(emptySummary);
      }),
    } as Partial<RequestLogService>);
    const scheduler = new TrafficRetentionScheduler(requestLog);

    const first = scheduler.handleRetention();
    await scheduler.handleRetention(); // overlapping run
    expect(requestLog.prune).toHaveBeenCalledTimes(1);

    release();
    await first;
    await scheduler.handleRetention(); // next run proceeds again
    expect(requestLog.prune).toHaveBeenCalledTimes(2);
  });

  it('survives a failing prune without throwing', async () => {
    const requestLog = makeRequestLog({
      prune: jest.fn().mockRejectedValue(new Error('db down')),
    } as Partial<RequestLogService>);
    const scheduler = new TrafficRetentionScheduler(requestLog);
    await expect(scheduler.handleRetention()).resolves.toBeUndefined();
  });
});
