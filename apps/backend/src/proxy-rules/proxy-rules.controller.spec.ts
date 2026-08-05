import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProxyRulesController } from './proxy-rules.controller';
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

    const mockExecutionLogService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyRulesController],
      providers: [
        { provide: ProxyRulesService, useValue: mockProxyRulesService },
        { provide: PipelineExecutionService, useValue: mockPipelineExecutionService },
        { provide: PipelineExecutionLogService, useValue: mockExecutionLogService },
        { provide: DeploymentsService, useValue: mockDeploymentsService },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: UserGroupsService, useValue: mockUserGroupsService },
      ],
    }).compile();

    controller = module.get<ProxyRulesController>(ProxyRulesController);
  });

  describe('getRule', () => {
    it('should return rule when found', async () => {
      const mockRule = createMockRule();
      mockProxyRulesService.getRuleById.mockResolvedValue(mockRule);

      const result = await controller.getRule('rule-1');

      expect(result.id).toBe('rule-1');
      expect(result.ruleSetId).toBe('rule-set-1');
      expect(mockProxyRulesService.getRuleById).toHaveBeenCalledWith('rule-1');
    });

    it('should throw NotFoundException when rule not found', async () => {
      mockProxyRulesService.getRuleById.mockResolvedValue(null);

      await expect(controller.getRule('non-existent')).rejects.toThrow(NotFoundException);
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

    const mockRuleSet = { id: 'rule-set-1', projectId: 'project-1' };

    beforeEach(() => {
      mockProxyRulesService.getRuleSetById = jest.fn().mockResolvedValue(mockRuleSet);
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
          mockUser: { id: 'mock-user-1', email: 'mock@example.com', role: 'user', groups: ['group-a', 'group-b'] },
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

        await controller.testPipelineRule(
          'rule-1',
          { deploymentAlias: 'staging' },
          mockUser,
          { file: undefined } as any,
        );

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
