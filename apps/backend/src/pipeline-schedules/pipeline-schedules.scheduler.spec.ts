import { PipelineSchedulesScheduler } from './pipeline-schedules.scheduler';
import { PipelineSchedulesService } from './pipeline-schedules.service';

function makeService(runImpl?: () => Promise<{ due: number; ran: number }>) {
  return {
    runDueSchedules: jest.fn(runImpl ?? (async () => ({ due: 0, ran: 0 }))),
  } as unknown as jest.Mocked<Pick<PipelineSchedulesService, 'runDueSchedules'>>;
}

describe('PipelineSchedulesScheduler', () => {
  it('delegates a tick to runDueSchedules', async () => {
    const service = makeService(async () => ({ due: 2, ran: 1 }));
    const scheduler = new PipelineSchedulesScheduler(service as unknown as PipelineSchedulesService);

    await scheduler.pollDueSchedules();

    expect(service.runDueSchedules).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while a previous run is still in progress', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = makeService(async () => {
      await gate;
      return { due: 1, ran: 1 };
    });
    const scheduler = new PipelineSchedulesScheduler(service as unknown as PipelineSchedulesService);

    const first = scheduler.pollDueSchedules(); // holds the lock on `gate`
    await scheduler.pollDueSchedules(); // should early-return, not call again
    expect(service.runDueSchedules).toHaveBeenCalledTimes(1);

    release();
    await first;

    // Lock released — a subsequent tick runs again.
    await scheduler.pollDueSchedules();
    expect(service.runDueSchedules).toHaveBeenCalledTimes(2);
  });

  it('swallows a failing run without throwing and releases the lock', async () => {
    const service = makeService(async () => {
      throw new Error('boom');
    });
    const scheduler = new PipelineSchedulesScheduler(service as unknown as PipelineSchedulesService);

    await expect(scheduler.pollDueSchedules()).resolves.toBeUndefined();
    // Lock was released despite the throw, so the next tick still runs.
    await scheduler.pollDueSchedules();
    expect(service.runDueSchedules).toHaveBeenCalledTimes(2);
  });
});
