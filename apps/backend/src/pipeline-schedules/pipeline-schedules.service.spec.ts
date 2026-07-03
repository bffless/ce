// Thenable chainable db mock: every builder method returns the chain, and
// awaiting consumes the next queued result in await order. Mirrors
// blocklist.service.spec / request-log.service.spec (the house pattern).
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = [
    'select',
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'update',
    'set',
    'delete',
    'returning',
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
import { PipelineSchedulesService } from './pipeline-schedules.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SystemPipelineTriggerService } from '../pipelines/execution/system-pipeline-trigger.service';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

const NOW = new Date('2024-01-01T00:00:00.000Z');

const schedule = (overrides: Record<string, unknown> = {}) => ({
  id: 'sched-1',
  projectId: 'proj-1',
  name: 'Refresh',
  targetProxyRuleId: 'rule-1',
  cronExpression: '*/15 * * * *',
  timezone: 'UTC',
  enabled: true,
  lastRunAt: null,
  nextRunAt: new Date('2023-12-31T23:59:00.000Z'),
  executionStartedAt: null,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

function buildService(triggerImpl?: jest.Mock) {
  const permissions = {} as unknown as PermissionsService;
  const systemTrigger = {
    triggerByProxyRuleId:
      triggerImpl ?? jest.fn(async () => ({ found: true, hasPipeline: true, result: { success: true } })),
  } as unknown as jest.Mocked<Pick<SystemPipelineTriggerService, 'triggerByProxyRuleId'>>;
  const service = new PipelineSchedulesService(
    permissions,
    systemTrigger as unknown as SystemPipelineTriggerService,
  );
  return { service, systemTrigger };
}

/** Find the db.update().set(...) call that advances the schedule (has nextRunAt). */
function advanceSetArg(): Record<string, unknown> | undefined {
  return mockDb.set.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .find((arg) => arg && 'nextRunAt' in arg && 'lastRunAt' in arg);
}

describe('PipelineSchedulesService.runDueSchedules', () => {
  beforeEach(() => mockDb.__reset());

  it('claims a due schedule, fires its pipeline, and advances nextRunAt', async () => {
    const { service, systemTrigger } = buildService();
    mockDb.__queue([schedule()]); // due select
    mockDb.__queue([{ id: 'sched-1' }]); // claim update .returning() → claimed
    mockDb.__queue([]); // advance update

    const result = await service.runDueSchedules(NOW);

    expect(result).toEqual({ due: 1, ran: 1 });
    expect(systemTrigger.triggerByProxyRuleId).toHaveBeenCalledWith(
      'rule-1',
      expect.objectContaining({ captureDebug: false }),
    );

    const advance = advanceSetArg();
    expect(advance).toBeDefined();
    expect(advance!.executionStartedAt).toBeNull(); // claim released
    expect(advance!.lastError).toBeNull(); // clean run
    expect(advance!.lastRunAt).toEqual(NOW);
    // */15 from 00:00:00 → next fire at 00:15
    expect((advance!.nextRunAt as Date).toISOString()).toBe('2024-01-01T00:15:00.000Z');
  });

  it('does not fire when the atomic claim is lost to another worker', async () => {
    const { service, systemTrigger } = buildService();
    mockDb.__queue([schedule()]); // due select
    mockDb.__queue([]); // claim update returns 0 rows → someone else claimed

    const result = await service.runDueSchedules(NOW);

    expect(result).toEqual({ due: 1, ran: 0 });
    expect(systemTrigger.triggerByProxyRuleId).not.toHaveBeenCalled();
  });

  it('does nothing when no schedules are due', async () => {
    const { service, systemTrigger } = buildService();
    mockDb.__queue([]); // due select empty

    const result = await service.runDueSchedules(NOW);

    expect(result).toEqual({ due: 0, ran: 0 });
    expect(systemTrigger.triggerByProxyRuleId).not.toHaveBeenCalled();
  });

  it('records lastError and still advances when the pipeline run fails', async () => {
    const failing = jest.fn(async () => ({
      found: true,
      hasPipeline: true,
      result: { success: false, error: { code: 'X', message: 'step blew up' } },
    }));
    const { service } = buildService(failing);
    mockDb.__queue([schedule()]);
    mockDb.__queue([{ id: 'sched-1' }]);
    mockDb.__queue([]);

    const result = await service.runDueSchedules(NOW);

    expect(result).toEqual({ due: 1, ran: 1 });
    const advance = advanceSetArg();
    expect(advance!.lastError).toBe('step blew up');
    expect(advance!.executionStartedAt).toBeNull(); // still released
    expect((advance!.nextRunAt as Date).toISOString()).toBe('2024-01-01T00:15:00.000Z');
  });

  it('swallows a thrown trigger error, recording it as lastError', async () => {
    const throwing = jest.fn(async () => {
      throw new Error('connection reset');
    });
    const { service } = buildService(throwing);
    mockDb.__queue([schedule()]);
    mockDb.__queue([{ id: 'sched-1' }]);
    mockDb.__queue([]);

    await expect(service.runDueSchedules(NOW)).resolves.toEqual({ due: 1, ran: 1 });
    const advance = advanceSetArg();
    expect(advance!.lastError).toBe('connection reset');
  });
});
