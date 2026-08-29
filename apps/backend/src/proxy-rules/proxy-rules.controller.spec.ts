import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ProxyRulesController, PipelineLogsController } from './proxy-rules.controller';
import { PermissionsService } from '../permissions/permissions.service';
import { ProxyRulesService } from './proxy-rules.service';
import { PipelineExecutionService } from '../pipelines/execution';
import { PipelineExecutionLogService } from '../pipelines/pipeline-execution-log.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { UserGroupsService } from '../user-groups/user-groups.service';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';

describe('ProxyRulesController', () => {
  let controller: ProxyRulesController;
  let mockProxyRulesService: jest.Mocked<ProxyRulesService>;
  let mockPipelineExecutionService: jest.Mocked<PipelineExecutionService>;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;
  let mockUserGroupsService: jest.Mocked<UserGroupsService>;
  let mockExecutionLogService: {
    log: jest.Mock;
    getByRuleId: jest.Mock;
    getCountByRuleId: jest.Mock;
    deleteByRuleId: jest.Mock;
  };
  let mockPermissionsService: { requireProjectAccess: jest.Mock };

  const mockRuleSet = { id: 'rule-set-1', projectId: 'project-1' };

  const mockUser: CurrentUserData = {
    id: 'user-1',
    email: 'test@example.com',
    role: 'admin',
  };

  const createMockRule = (overrides: Record<string, unknown> = {}) => ({
    id: 'rule-1',
    ruleSetId: 'rule-set-1',
    pathPattern: '/api/*',
    method: null,
    methods: null,
    targetUrl: 'https://api.example.com',
    stripPrefix: true,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: false,
    proxyType: 'external_proxy' as const,
    emailHandlerConfig: null,
    pipelineConfig: null,
    isEnabled: true,
    description: null,
    debugEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    mockProxyRulesService = {
      getRulesByRuleSetId: jest.fn(),
      getEffectiveRulesForRuleSet: jest.fn(),
      getRuleById: jest.fn(),
      getRuleSetById: jest.fn().mockResolvedValue(mockRuleSet),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      reorder: jest.fn(),
    } as unknown as jest.Mocked<ProxyRulesService>;

    mockPipelineExecutionService = {
      executePipelineWithDebug: jest.fn(),
    } as unknown as jest.Mocked<PipelineExecutionService>;

    mockDeploymentsService = {
      resolveAlias: jest.fn(),
    } as unknown as jest.Mocked<DeploymentsService>;

    mockProjectsService = {
      getProjectById: jest.fn(),
    } as unknown as jest.Mocked<ProjectsService>;

    mockUserGroupsService = {
      getGroupIdsForUser: jest.fn(),
    } as unknown as jest.Mocked<UserGroupsService>;

    mockExecutionLogService = {
      log: jest.fn().mockResolvedValue(undefined),
      getByRuleId: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      getCountByRuleId: jest.fn().mockResolvedValue(0),
      deleteByRuleId: jest.fn().mockResolvedValue(undefined),
    };

    mockPermissionsService = { requireProjectAccess: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyRulesController],
      providers: [
        { provide: ProxyRulesService, useValue: mockProxyRulesService },
        { provide: PipelineExecutionService, useValue: mockPipelineExecutionService },
        { provide: PipelineExecutionLogService, useValue: mockExecutionLogService },
        { provide: DeploymentsService, useValue: mockDeploymentsService },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: UserGroupsService, useValue: mockUserGroupsService },
        { provide: PermissionsService, useValue: mockPermissionsService },
      ],
    }).compile();

    controller = module.get<ProxyRulesController>(ProxyRulesController);
  });

  describe('getRule', () => {
    it('should return rule when found', async () => {
      const mockRule = createMockRule();
      mockProxyRulesService.getRuleById.mockResolvedValue(mockRule);

      const result = await controller.getRule('rule-1', mockUser);

      expect(result.id).toBe('rule-1');
      expect(result.ruleSetId).toBe('rule-set-1');
      expect(mockProxyRulesService.getRuleById).toHaveBeenCalledWith('rule-1');
      // Scoped to the rule set's own project, read-level role.
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'admin',
        'viewer',
        undefined,
      );
    });

    it('should throw NotFoundException when rule not found', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(null);

      await expect(controller.getRule('non-existent', mockUser)).rejects.toThrow(NotFoundException);
      expect(mockPermissionsService.requireProjectAccess).not.toHaveBeenCalled();
    });
  });

  // Rule ids are not secrets (X-Pipeline-Log-Id, logs, exports), and ApiKeyGuard
  // only proves the caller has *a* credential on the instance. Every by-id route
  // must therefore scope to the rule's own project, mirroring update/delete.
  describe('project scoping of by-id routes', () => {
    const outsider: CurrentUserData = { id: 'outsider', email: 'o@example.com', role: 'user' };
    const forbidden = new ForbiddenException('You do not have access to this project');

    const pipelineRule = () =>
      createMockRule({
        proxyType: 'pipeline' as const,
        pipelineConfig: {
          name: 'Test Pipeline',
          steps: [{ id: 'step-1', handlerType: 'response_handler', config: {}, isEnabled: true }],
        },
      });

    beforeEach(() => {
      mockProxyRulesService.getRuleById.mockResolvedValue(createMockRule());
      mockPermissionsService.requireProjectAccess.mockRejectedValue(forbidden);
    });

    it('GET :id refuses a caller with no role on the project', async () => {
      await expect(controller.getRule('rule-1', outsider)).rejects.toThrow(ForbiddenException);
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'outsider',
        'user',
        'viewer',
        undefined,
      );
    });

    it('GET :id/logs refuses a caller with no role on the project', async () => {
      await expect(controller.getRuleLogs('rule-1', outsider)).rejects.toThrow(ForbiddenException);
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'outsider',
        'user',
        'viewer',
        undefined,
      );
      expect(mockExecutionLogService.getByRuleId).not.toHaveBeenCalled();
    });

    it('GET :id/logs/count refuses a caller with no role on the project', async () => {
      await expect(controller.getRuleLogCount('rule-1', outsider)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'outsider',
        'user',
        'viewer',
        undefined,
      );
      expect(mockExecutionLogService.getCountByRuleId).not.toHaveBeenCalled();
    });

    it('DELETE :id/logs refuses a caller with no role and requires contributor', async () => {
      await expect(controller.clearRuleLogs('rule-1', outsider)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'outsider',
        'user',
        'contributor',
        undefined,
      );
      expect(mockExecutionLogService.deleteByRuleId).not.toHaveBeenCalled();
    });

    it('POST :id/test refuses a caller with no role and requires contributor', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(pipelineRule());

      await expect(
        controller.testPipelineRule('rule-1', {}, outsider, { file: undefined } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'outsider',
        'user',
        'contributor',
        undefined,
      );
      expect(mockPipelineExecutionService.executePipelineWithDebug).not.toHaveBeenCalled();
    });

    it('forwards the API key project scope so a key minted for another project is refused', async () => {
      const scopedKey: CurrentUserData = {
        id: 'user-1',
        role: 'user',
        apiKeyProjectId: 'project-b',
      };
      mockPermissionsService.requireProjectAccess.mockRejectedValue(
        new ForbiddenException('API key is not authorized for this project'),
      );

      await expect(controller.getRuleLogs('rule-1', scopedKey)).rejects.toThrow(ForbiddenException);
      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'user',
        'viewer',
        'project-b',
      );
    });

    it('GET :id/logs/count 404s on an unknown id without consulting permissions', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(null);

      await expect(controller.getRuleLogCount('missing', mockUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPermissionsService.requireProjectAccess).not.toHaveBeenCalled();
      expect(mockExecutionLogService.getCountByRuleId).not.toHaveBeenCalled();
    });

    it('serves logs, count and clear to an authorized caller', async () => {
      mockPermissionsService.requireProjectAccess.mockResolvedValue(undefined);

      await controller.getRuleLogs('rule-1', mockUser, '2', '50');
      expect(mockExecutionLogService.getByRuleId).toHaveBeenCalledWith('rule-1', 2, 50);

      await expect(controller.getRuleLogCount('rule-1', mockUser)).resolves.toEqual({
        count: 0,
      });

      await expect(controller.clearRuleLogs('rule-1', mockUser)).resolves.toEqual({
        success: true,
      });
      expect(mockExecutionLogService.deleteByRuleId).toHaveBeenCalledWith('rule-1');
    });
  });

  describe('updateRule', () => {
    it('should update rule fields', async () => {
      const updatedRule = createMockRule({ targetUrl: 'https://new-api.example.com' });
      mockProxyRulesService.update.mockResolvedValue(updatedRule);

      const result = await controller.updateRule(
        'rule-1',
        { targetUrl: 'https://new-api.example.com' },
        mockUser,
      );

      expect(result.targetUrl).toBe('https://new-api.example.com');
      expect(mockProxyRulesService.update).toHaveBeenCalledWith(
        'rule-1',
        { targetUrl: 'https://new-api.example.com' },
        'user-1',
        'admin',
        undefined,
      );
    });
  });

  describe('deleteRule', () => {
    it('should delete a rule', async () => {
      mockProxyRulesService.delete.mockResolvedValue(undefined);

      const result = await controller.deleteRule('rule-1', mockUser);

      expect(result).toEqual({ success: true });
      expect(mockProxyRulesService.delete).toHaveBeenCalledWith(
        'rule-1',
        'user-1',
        'admin',
        undefined,
      );
    });
  });

  describe('testPipelineRule', () => {
    const createMockPipelineRule = (overrides: Record<string, unknown> = {}) =>
      createMockRule({
        proxyType: 'pipeline' as const,
        pipelineConfig: {
          name: 'Test Pipeline',
          steps: [
            {
              id: 'step-1',
              handlerType: 'response_handler',
              config: {},
              isEnabled: true,
            },
          ],
        },
        ...overrides,
      });

    beforeEach(() => {
      mockPipelineExecutionService.executePipelineWithDebug.mockResolvedValue({
        success: true,
        response: { status: 200, body: {} },
        stepOutputs: {},
        debug: undefined,
      } as any);
    });

    it('passes mockUser.groups through to executePipelineWithDebug', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(createMockPipelineRule());

      await controller.testPipelineRule(
        'rule-1',
        {
          mockUser: {
            id: 'mock-user-1',
            email: 'mock@example.com',
            role: 'user',
            groups: ['group-a', 'group-b'],
          },
        },
        mockUser,
        { file: undefined } as any,
      );

      expect(mockPipelineExecutionService.executePipelineWithDebug).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          id: 'mock-user-1',
          groups: ['group-a', 'group-b'],
        }),
        expect.anything(),
      );
    });

    it('does not crash when mockUser.groups is absent', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(createMockPipelineRule());

      await expect(
        controller.testPipelineRule(
          'rule-1',
          { mockUser: { id: 'mock-user-1', email: 'mock@example.com', role: 'user' } },
          mockUser,
          { file: undefined } as any,
        ),
      ).resolves.toBeDefined();

      expect(mockPipelineExecutionService.executePipelineWithDebug).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: 'mock-user-1', groups: undefined }),
        expect.anything(),
      );
    });

    it('enriches the real-user branch with group memberships', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(createMockPipelineRule());
      mockUserGroupsService.getGroupIdsForUser.mockResolvedValue(['group-x']);

      await controller.testPipelineRule('rule-1', {}, mockUser, { file: undefined } as any);

      expect(mockUserGroupsService.getGroupIdsForUser).toHaveBeenCalledWith('user-1');
      expect(mockPipelineExecutionService.executePipelineWithDebug).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: 'user-1', groups: ['group-x'] }),
        expect.anything(),
      );
    });

    it('degrades to empty groups when group lookup fails for the real user', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(createMockPipelineRule());
      mockUserGroupsService.getGroupIdsForUser.mockRejectedValue(new Error('db down'));

      await controller.testPipelineRule('rule-1', {}, mockUser, { file: undefined } as any);

      expect(mockPipelineExecutionService.executePipelineWithDebug).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: 'user-1', groups: [] }),
        expect.anything(),
      );
    });

    // "Test" must load skills from the same deployment production would, or a
    // rule that works in the editor breaks live (and vice versa).
    describe('skills deployment context', () => {
      const aiStepRule = (skills: Record<string, unknown>) =>
        createMockPipelineRule({
          pipelineConfig: {
            name: 'Test Pipeline',
            steps: [
              { id: 'draft', handlerType: 'ai_handler', config: { skills }, isEnabled: true },
            ],
          },
        });

      beforeEach(() => {
        mockProjectsService.getProjectById.mockResolvedValue({
          owner: 'bffless',
          name: 'studio',
        } as never);
        mockDeploymentsService.resolveAlias.mockResolvedValue('sha-1' as never);
      });

      it("resolves the step's own skills alias instead of production", async () => {
        mockProxyRulesService.getRuleById.mockResolvedValue(
          aiStepRule({ mode: 'selected', enabled: ['image-prompts'], alias: 'studio' }),
        );

        await controller.testPipelineRule('rule-1', {}, mockUser, { file: undefined } as any);

        expect(mockDeploymentsService.resolveAlias).toHaveBeenCalledWith(
          'bffless/studio',
          'studio',
        );
      });

      it('still falls back to production when no step declares an alias', async () => {
        mockProxyRulesService.getRuleById.mockResolvedValue(
          aiStepRule({ mode: 'selected', enabled: ['image-prompts'] }),
        );

        await controller.testPipelineRule('rule-1', {}, mockUser, { file: undefined } as any);

        expect(mockDeploymentsService.resolveAlias).toHaveBeenCalledWith(
          'bffless/studio',
          'production',
        );
      });

      it('lets an explicitly requested alias win over the step config', async () => {
        mockProxyRulesService.getRuleById.mockResolvedValue(
          aiStepRule({ mode: 'selected', enabled: ['image-prompts'], alias: 'studio' }),
        );

        await controller.testPipelineRule('rule-1', { deploymentAlias: 'staging' }, mockUser, {
          file: undefined,
        } as any);

        expect(mockDeploymentsService.resolveAlias).toHaveBeenCalledWith(
          'bffless/studio',
          'staging',
        );
      });
    });
  });

  describe('user role fallback', () => {
    it('should default to "user" role when role is not set', async () => {
      const userWithoutRole: CurrentUserData = {
        id: 'user-1',
        email: 'test@example.com',
        role: undefined,
      };

      const updatedRule = createMockRule();
      mockProxyRulesService.update.mockResolvedValue(updatedRule);

      await controller.updateRule('rule-1', { isEnabled: false }, userWithoutRole);

      expect(mockProxyRulesService.update).toHaveBeenCalledWith(
        'rule-1',
        { isEnabled: false },
        'user-1',
        'user',
        undefined,
      );
    });
  });
});

describe('PipelineLogsController', () => {
  let controller: PipelineLogsController;
  let mockLogService: { getById: jest.Mock };
  let mockPermissionsService: { requireProjectAccess: jest.Mock };

  const log = {
    id: 'log-1',
    projectId: 'project-a',
    proxyRuleId: 'rule-1',
    success: false,
    statusCode: 400,
    method: 'POST',
    path: '/api/items',
    durationMs: 12,
    stepsCount: 1,
    errorCode: 'VALIDATION_ERROR',
    errorMessage: 'bad input',
    errorStep: 'validate',
    requestMeta: { ip: '203.0.113.9', userAgent: 'curl/8' },
    debug: { validators: [], steps: [], totalDurationMs: 12, startTime: '', endTime: '' },
    createdAt: new Date(),
  };

  beforeEach(() => {
    mockLogService = { getById: jest.fn().mockResolvedValue(log) };
    mockPermissionsService = { requireProjectAccess: jest.fn().mockResolvedValue(undefined) };
    controller = new PipelineLogsController(
      mockLogService as unknown as PipelineExecutionLogService,
      mockPermissionsService as unknown as PermissionsService,
    );
  });

  it('returns the log to a caller authorized on its project', async () => {
    const user: CurrentUserData = { id: 'user-1', role: 'user', apiKeyProjectId: undefined };
    await expect(controller.getLogDetail('log-1', user)).resolves.toBe(log);
    // Scoped to the log's own project (not a caller-supplied one), read-level role.
    expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
      'project-a',
      'user-1',
      'user',
      'viewer',
      undefined,
    );
  });

  it('forwards the API key project scope so a key minted for another project is refused', async () => {
    const user: CurrentUserData = { id: 'user-1', role: 'user', apiKeyProjectId: 'project-b' };
    mockPermissionsService.requireProjectAccess.mockRejectedValue(
      new ForbiddenException('API key is not authorized for this project'),
    );
    await expect(controller.getLogDetail('log-1', user)).rejects.toThrow(ForbiddenException);
    expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
      'project-a',
      'user-1',
      'user',
      'viewer',
      'project-b',
    );
  });

  it('does not return the log when the caller has no role on its project', async () => {
    const user: CurrentUserData = { id: 'outsider', role: 'user' };
    mockPermissionsService.requireProjectAccess.mockRejectedValue(
      new ForbiddenException('You do not have access to this project'),
    );
    await expect(controller.getLogDetail('log-1', user)).rejects.toThrow(ForbiddenException);
  });

  it('404s on an unknown id without consulting permissions', async () => {
    mockLogService.getById.mockResolvedValue(null);
    const user: CurrentUserData = { id: 'user-1', role: 'admin' };
    await expect(controller.getLogDetail('missing', user)).rejects.toThrow(NotFoundException);
    expect(mockPermissionsService.requireProjectAccess).not.toHaveBeenCalled();
  });
});
