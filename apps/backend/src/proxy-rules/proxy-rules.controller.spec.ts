import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProxyRulesController } from './proxy-rules.controller';
import { ProxyRulesService } from './proxy-rules.service';
import { PipelineExecutionService } from '../pipelines/execution';
import { PipelineExecutionLogService } from '../pipelines/pipeline-execution-log.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';

describe('ProxyRulesController', () => {
  let controller: ProxyRulesController;
  let mockProxyRulesService: jest.Mocked<ProxyRulesService>;
  let mockPipelineExecutionService: jest.Mocked<PipelineExecutionService>;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;

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
      );
    });
  });

  describe('deleteRule', () => {
    it('should delete a rule', async () => {
      mockProxyRulesService.delete.mockResolvedValue(undefined);

      const result = await controller.deleteRule('rule-1', mockUser);

      expect(result).toEqual({ success: true });
      expect(mockProxyRulesService.delete).toHaveBeenCalledWith('rule-1', 'user-1', 'admin');
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
      );
    });
  });
});
