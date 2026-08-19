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
  chainable.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

import { ForbiddenException } from '@nestjs/common';
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
      triggerImpl ??
      jest.fn(async () => ({ found: true, hasPipeline: true, result: { success: true } })),
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

describe('PipelineSchedulesService CRUD api-key project scope', () => {
  beforeEach(() => mockDb.__reset());

  // Mirrors the real requireProjectAccess short-circuit: a project-scoped
  // api-key is authorized iff its scope matches the target project.
  function buildScopedService() {
    const requireProjectAccess = jest.fn(
      async (
        projectId: string,
        _userId: string,
        _userRole?: string,
        _requiredRole?: string,
        apiKeyProjectId?: string | null,
      ) => {
        if (apiKeyProjectId !== undefined && apiKeyProjectId !== null) {
          if (apiKeyProjectId !== projectId) {
            throw new ForbiddenException('API key is not authorized for this project');
          }
        }
      },
    );
    const permissions = { requireProjectAccess } as unknown as PermissionsService;
    const systemTrigger = {
      triggerByProxyRuleId: jest.fn(),
    } as unknown as SystemPipelineTriggerService;
    const service = new PipelineSchedulesService(permissions, systemTrigger);
    return { service, requireProjectAccess };
  }

  const createDto = {
    name: 'Refresh',
    targetProxyRuleId: 'rule-1',
    cronExpression: '*/15 * * * *',
  };

  it('createSchedule threads apiKeyProjectId and succeeds for a key scoped to the project', async () => {
    const { service, requireProjectAccess } = buildScopedService();
    mockDb.__queue([{ projectId: 'proj-1' }]); // assertTargetInProject
    mockDb.__queue([schedule()]); // insert .returning()

    await expect(
      service.createSchedule('proj-1', createDto, 'user-1', 'user', 'proj-1'),
    ).resolves.toMatchObject({ id: 'sched-1', projectId: 'proj-1' });

    expect(requireProjectAccess).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'user',
      'contributor',
      'proj-1',
    );
  });

  it('createSchedule rejects a key scoped to another project before touching the db', async () => {
    const { service } = buildScopedService();

    await expect(
      service.createSchedule('proj-1', createDto, 'user-1', 'user', 'proj-2'),
    ).rejects.toThrow(ForbiddenException);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('listSchedules threads apiKeyProjectId and rejects a cross-project scoped key', async () => {
    const { service, requireProjectAccess } = buildScopedService();
    mockDb.__queue([schedule()]);

    await expect(service.listSchedules('proj-1', 'user-1', 'user', 'proj-1')).resolves.toHaveLength(
      1,
    );
    expect(requireProjectAccess).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'user',
      'viewer',
      'proj-1',
    );

    await expect(service.listSchedules('proj-1', 'user-1', 'user', 'proj-2')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('by-id methods enforce scope against the row project (cross-project isolation)', async () => {
    const { service, requireProjectAccess } = buildScopedService();

    // The schedule row belongs to proj-1; the key is scoped to proj-2.
    mockDb.__queue([schedule()]); // getById for getSchedule
    await expect(service.getSchedule('sched-1', 'user-1', 'user', 'proj-2')).rejects.toThrow(
      ForbiddenException,
    );

    mockDb.__queue([schedule()]); // getById for updateSchedule
    await expect(
      service.updateSchedule('sched-1', { enabled: false }, 'user-1', 'user', 'proj-2'),
    ).rejects.toThrow(ForbiddenException);

    mockDb.__queue([schedule()]); // getById for deleteSchedule
    await expect(service.deleteSchedule('sched-1', 'user-1', 'user', 'proj-2')).rejects.toThrow(
      ForbiddenException,
    );

    // Scope was checked against the row's projectId, with the key's scope threaded.
    for (const call of requireProjectAccess.mock.calls) {
      expect(call[0]).toBe('proj-1');
      expect(call[4]).toBe('proj-2');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('session auth (no apiKeyProjectId) still passes undefined through unchanged', async () => {
    const { service, requireProjectAccess } = buildScopedService();
    mockDb.__queue([]);

    await expect(service.listSchedules('proj-1', 'user-1', 'admin')).resolves.toEqual([]);
    expect(requireProjectAccess).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'admin',
      'viewer',
      undefined,
    );
  });
});

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

describe('listPipelineRules', () => {
  it('returns pipeline rules for the project mapped to option rows', async () => {
    const requireProjectAccess = jest.fn().mockResolvedValue(undefined);
    const permissions = { requireProjectAccess } as unknown as PermissionsService;
    const systemTrigger = {} as unknown as SystemPipelineTriggerService;
    const service = new PipelineSchedulesService(permissions, systemTrigger);

    mockDb.__reset();
    mockDb.__queue([
      {
        id: 'rule-1',
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/feeds',
        method: 'GET',
        pipelineName: 'feeds-sync',
      },
      {
        id: 'rule-2',
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/report',
        method: null,
        pipelineName: null,
      },
    ]);

    const result = await service.listPipelineRules('proj-1', 'user-1', 'admin', null);

    expect(requireProjectAccess).toHaveBeenCalledWith('proj-1', 'user-1', 'admin', 'viewer', null);
    expect(result).toEqual([
      {
        id: 'rule-1',
        name: 'feeds-sync',
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/feeds',
        method: 'GET',
      },
      {
        id: 'rule-2',
        name: '/api/report', // falls back to pathPattern when pipelineName is null
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/report',
        method: null,
      },
    ]);
  });
});
