import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ProxyRuleSetsController } from './proxy-rule-sets.controller';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRulesService } from './proxy-rules.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';
import type { RuleSetExport } from './export-format.util';
import type {
  SyncProxyRuleSetDto,
  SyncProxyRuleSetResponseDto,
  RevisionListResponseDto,
  RevisionDetailResponseDto,
} from './dto';

describe('ProxyRuleSetsController', () => {
  let controller: ProxyRuleSetsController;
  let mockProxyRuleSetsService: jest.Mocked<ProxyRuleSetsService>;
  let mockProxyRulesService: jest.Mocked<ProxyRulesService>;

  const mockUser: CurrentUserData = {
    id: 'user-1',
    email: 'test@example.com',
    role: 'admin',
    apiKeyProjectId: 'project-1',
  };

  const mockEnvelope: RuleSetExport = {
    version: 2,
    exportedAt: '2026-07-11T00:00:00.000Z',
    kind: 'bffless-proxy-rule-set',
    ruleSet: { name: 'api-backend' },
    rules: [{ pathPattern: '/api/*', targetUrl: 'https://api.example.com' }],
  };

  beforeEach(async () => {
    mockProxyRuleSetsService = {
      listByProject: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      copy: jest.fn(),
      importRuleSet: jest.fn(),
      exportRuleSet: jest.fn(),
      syncRuleSet: jest.fn(),
      listRevisions: jest.fn(),
      getRevision: jest.fn(),
    } as unknown as jest.Mocked<ProxyRuleSetsService>;

    mockProxyRulesService = {
      getRulesByRuleSetId: jest.fn(),
      create: jest.fn(),
      reorder: jest.fn(),
    } as unknown as jest.Mocked<ProxyRulesService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyRuleSetsController],
      providers: [
        { provide: ProxyRuleSetsService, useValue: mockProxyRuleSetsService },
        { provide: ProxyRulesService, useValue: mockProxyRulesService },
      ],
    }).compile();

    controller = module.get<ProxyRuleSetsController>(ProxyRuleSetsController);
  });

  describe('export', () => {
    it('returns the export envelope from the service', async () => {
      mockProxyRuleSetsService.exportRuleSet.mockResolvedValue(mockEnvelope);

      const result = await controller.export('rule-set-1', mockUser);

      expect(result).toBe(mockEnvelope);
      expect(mockProxyRuleSetsService.exportRuleSet).toHaveBeenCalledWith(
        'rule-set-1',
        'project-1',
      );
    });

    it('passes NotFoundException through from the service', async () => {
      mockProxyRuleSetsService.exportRuleSet.mockRejectedValue(
        new NotFoundException('Rule set missing not found'),
      );

      await expect(controller.export('missing', mockUser)).rejects.toThrow(NotFoundException);
    });

    it('is wired as GET :id/export', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller.export)).toBe(':id/export');
      expect(Reflect.getMetadata(METHOD_METADATA, controller.export)).toBe(RequestMethod.GET);
    });

    it('is declared before GET :id so the static segment is never shadowed', () => {
      // Nest registers routes in declaration order; ':id/export' must register
      // before ':id' (belt-and-braces — Express matches ':id/export' anyway
      // because of the extra path segment, but declaration order keeps this
      // unambiguous).
      const methodNames = Object.getOwnPropertyNames(ProxyRuleSetsController.prototype);
      expect(methodNames.indexOf('export')).toBeGreaterThan(-1);
      expect(methodNames.indexOf('export')).toBeLessThan(methodNames.indexOf('getById'));
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the service returns null', async () => {
      mockProxyRuleSetsService.getById.mockResolvedValue(null);

      await expect(controller.getById('missing', mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listRevisions', () => {
    const revisionsResponse: RevisionListResponseDto = {
      revisions: [
        {
          id: 'revision-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          trigger: 'sync',
          contentHash: 'hash-1',
          ruleCount: 1,
          current: true,
          source: null,
        },
      ],
    };

    it('delegates to the service with the full user context', async () => {
      mockProxyRuleSetsService.listRevisions.mockResolvedValue(revisionsResponse);

      const result = await controller.listRevisions('rule-set-1', mockUser);

      expect(result).toBe(revisionsResponse);
      expect(mockProxyRuleSetsService.listRevisions).toHaveBeenCalledWith(
        'rule-set-1',
        'user-1',
        'admin',
        'project-1',
      );
    });

    it("defaults the role to 'user' when the current user has none", async () => {
      mockProxyRuleSetsService.listRevisions.mockResolvedValue(revisionsResponse);

      await controller.listRevisions('rule-set-1', { ...mockUser, role: undefined });

      expect(mockProxyRuleSetsService.listRevisions).toHaveBeenCalledWith(
        'rule-set-1',
        'user-1',
        'user',
        'project-1',
      );
    });

    it('passes NotFoundException through from the service', async () => {
      mockProxyRuleSetsService.listRevisions.mockRejectedValue(
        new NotFoundException('Rule set missing not found'),
      );

      await expect(controller.listRevisions('missing', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is wired as GET :id/revisions', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller.listRevisions)).toBe(':id/revisions');
      expect(Reflect.getMetadata(METHOD_METADATA, controller.listRevisions)).toBe(
        RequestMethod.GET,
      );
    });

    it('is declared before GET :id so the static segment is never shadowed', () => {
      const methodNames = Object.getOwnPropertyNames(ProxyRuleSetsController.prototype);
      expect(methodNames.indexOf('listRevisions')).toBeGreaterThan(-1);
      expect(methodNames.indexOf('listRevisions')).toBeLessThan(methodNames.indexOf('getById'));
    });

    it('inherits the class-level ApiKeyGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, ProxyRuleSetsController) as unknown[];
      expect(guards).toContain(ApiKeyGuard);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller.listRevisions)).toBeUndefined();
    });
  });

  describe('getRevision', () => {
    const revisionDetail: RevisionDetailResponseDto = {
      id: 'revision-1',
      createdAt: '2026-02-01T00:00:00.000Z',
      trigger: 'sync',
      contentHash: 'hash-1',
      ruleCount: 1,
      current: true,
      source: null,
      snapshot: mockEnvelope as unknown as RevisionDetailResponseDto['snapshot'],
    };

    it('delegates to the service with the full user context', async () => {
      mockProxyRuleSetsService.getRevision.mockResolvedValue(revisionDetail);

      const result = await controller.getRevision('rule-set-1', 'revision-1', mockUser);

      expect(result).toBe(revisionDetail);
      expect(mockProxyRuleSetsService.getRevision).toHaveBeenCalledWith(
        'rule-set-1',
        'revision-1',
        'user-1',
        'admin',
        'project-1',
      );
    });

    it("defaults the role to 'user' when the current user has none", async () => {
      mockProxyRuleSetsService.getRevision.mockResolvedValue(revisionDetail);

      await controller.getRevision('rule-set-1', 'revision-1', { ...mockUser, role: undefined });

      expect(mockProxyRuleSetsService.getRevision).toHaveBeenCalledWith(
        'rule-set-1',
        'revision-1',
        'user-1',
        'user',
        'project-1',
      );
    });

    it('passes NotFoundException through from the service (missing or foreign revision)', async () => {
      mockProxyRuleSetsService.getRevision.mockRejectedValue(
        new NotFoundException('Revision foreign-revision not found'),
      );

      await expect(
        controller.getRevision('rule-set-1', 'foreign-revision', mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('is wired as GET :id/revisions/:revisionId', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller.getRevision)).toBe(
        ':id/revisions/:revisionId',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, controller.getRevision)).toBe(
        RequestMethod.GET,
      );
    });

    it('is declared before GET :id so the static segment is never shadowed', () => {
      const methodNames = Object.getOwnPropertyNames(ProxyRuleSetsController.prototype);
      expect(methodNames.indexOf('getRevision')).toBeGreaterThan(-1);
      expect(methodNames.indexOf('getRevision')).toBeLessThan(methodNames.indexOf('getById'));
    });

    it('inherits the class-level ApiKeyGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, ProxyRuleSetsController) as unknown[];
      expect(guards).toContain(ApiKeyGuard);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller.getRevision)).toBeUndefined();
    });
  });

  describe('sync', () => {
    const syncDto = {
      ruleSet: { name: 'studio' },
      rules: [{ pathPattern: '/api/*', targetUrl: 'https://api.example.com' }],
      options: { dryRun: true },
    } as SyncProxyRuleSetDto;

    const syncResponse: SyncProxyRuleSetResponseDto = {
      ruleSetId: 'rule-set-1',
      created: [],
      updated: [],
      deleted: [],
      unchanged: [{ pathPattern: '/api/*', method: null }],
      pruneCandidates: [],
      schemaResolutions: [],
      missingSecrets: [],
      warnings: [],
      dryRun: true,
      setCreated: false,
    };

    it('delegates to the service with the full user context', async () => {
      mockProxyRuleSetsService.syncRuleSet.mockResolvedValue(syncResponse);

      const result = await controller.sync('project-1', syncDto, mockUser);

      expect(result).toBe(syncResponse);
      expect(mockProxyRuleSetsService.syncRuleSet).toHaveBeenCalledWith(
        'project-1',
        syncDto,
        'user-1',
        'admin',
        'project-1',
      );
    });

    it("defaults the role to 'user' when the current user has none", async () => {
      mockProxyRuleSetsService.syncRuleSet.mockResolvedValue(syncResponse);

      await controller.sync('project-1', syncDto, { ...mockUser, role: undefined });

      expect(mockProxyRuleSetsService.syncRuleSet).toHaveBeenCalledWith(
        'project-1',
        syncDto,
        'user-1',
        'user',
        'project-1',
      );
    });

    it('is wired as PUT project/:projectId/sync', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller.sync)).toBe('project/:projectId/sync');
      expect(Reflect.getMetadata(METHOD_METADATA, controller.sync)).toBe(RequestMethod.PUT);
    });

    it('inherits the class-level ApiKeyGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, ProxyRuleSetsController) as unknown[];
      expect(guards).toContain(ApiKeyGuard);
      // No method-level override that could weaken the class guard
      expect(Reflect.getMetadata(GUARDS_METADATA, controller.sync)).toBeUndefined();
    });

    it('passes validation-type errors (400) through from the service', async () => {
      mockProxyRuleSetsService.syncRuleSet.mockRejectedValue(
        new BadRequestException('Duplicate rule for path pattern "/api/*"'),
      );

      await expect(controller.sync('project-1', syncDto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('passes NotFoundException through when the project is missing', async () => {
      mockProxyRuleSetsService.syncRuleSet.mockRejectedValue(
        new NotFoundException('Project project-1 not found'),
      );

      await expect(controller.sync('project-1', syncDto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
