import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ProxyRuleSetsController } from './proxy-rule-sets.controller';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRulesService } from './proxy-rules.service';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';
import type { RuleSetExport } from './export-format.util';

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
});
