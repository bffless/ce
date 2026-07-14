import { Test, TestingModule } from '@nestjs/testing';
import { SchemaGeneratorRevisionsService } from './schema-generator-revisions.service';
import { ProxyRulesService } from '../proxy-rules/proxy-rules.service';
import { ProxyRuleSetRevisionsService } from '../proxy-rules/proxy-rule-set-revisions.service';
import type { ProxyRuleSet } from '../db/schema/proxy-rule-sets.schema';
import type { ProxyRule } from '../db/schema/proxy-rules.schema';

describe('SchemaGeneratorRevisionsService', () => {
  let service: SchemaGeneratorRevisionsService;

  const ruleSet = { id: 'set-1', name: 'chat_pipelines' } as ProxyRuleSet;
  const rules = [{ id: 'rule-1', ruleSetId: 'set-1' }] as ProxyRule[];

  const mockProxyRulesService = {
    getRulesByRuleSetId: jest.fn().mockResolvedValue(rules),
  };

  const mockRevisionsService = {
    capture: jest.fn().mockResolvedValue(undefined),
    captureIfUnrevisioned: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaGeneratorRevisionsService,
        { provide: ProxyRulesService, useValue: mockProxyRulesService },
        { provide: ProxyRuleSetRevisionsService, useValue: mockRevisionsService },
      ],
    }).compile();

    service = module.get(SchemaGeneratorRevisionsService);
    jest.clearAllMocks();
    mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue(rules);
  });

  describe('backfill', () => {
    it('passes the set and its decrypted rules to captureIfUnrevisioned', async () => {
      await service.backfill(ruleSet, 'user-1');

      expect(mockProxyRulesService.getRulesByRuleSetId).toHaveBeenCalledWith('set-1');
      expect(mockRevisionsService.captureIfUnrevisioned).toHaveBeenCalledWith({
        ruleSet,
        rules,
        userId: 'user-1',
      });
    });

    it('swallows a failure so a revision problem never fails generation', async () => {
      mockProxyRulesService.getRulesByRuleSetId.mockRejectedValueOnce(new Error('boom'));

      await expect(service.backfill(ruleSet, 'user-1')).resolves.toBeUndefined();
      expect(mockRevisionsService.captureIfUnrevisioned).not.toHaveBeenCalled();
    });
  });

  describe('capture', () => {
    it('captures the post-write state under the given trigger', async () => {
      await service.capture(ruleSet, 'create', 'user-1');

      expect(mockRevisionsService.capture).toHaveBeenCalledWith({
        ruleSet,
        rules,
        trigger: 'create',
        userId: 'user-1',
      });
    });

    it('swallows a failure so a revision problem never fails generation', async () => {
      mockProxyRulesService.getRulesByRuleSetId.mockRejectedValueOnce(new Error('boom'));

      await expect(service.capture(ruleSet, 'rule_edit', 'user-1')).resolves.toBeUndefined();
      expect(mockRevisionsService.capture).not.toHaveBeenCalled();
    });
  });
});
