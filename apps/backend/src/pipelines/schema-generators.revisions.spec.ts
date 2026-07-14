import { Test, TestingModule } from '@nestjs/testing';
import { StateSchemaGeneratorService } from './state-schema-generator.service';
import { ChatSchemaGeneratorService } from './chat-schema-generator.service';
import { UploadSchemaGeneratorService } from './upload-schema-generator.service';
import { SchemaGeneratorRevisionsService } from './schema-generator-revisions.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ProjectAISettingsService } from '../projects/project-ai-settings.service';

// Mock the db client - sequenced results, consumed by .limit() / .returning()
jest.mock('../db/client', () => {
  const mockResults: unknown[][] = [];
  let callIdx = 0;

  const chainable = {
    select: jest.fn(() => chainable),
    from: jest.fn(() => chainable),
    where: jest.fn(() => chainable),
    limit: jest.fn(() => Promise.resolve(mockResults[callIdx++] ?? [])),
    insert: jest.fn(() => chainable),
    values: jest.fn(() => chainable),
    returning: jest.fn(() => Promise.resolve(mockResults[callIdx++] ?? [{ id: 'test-id' }])),
    __setResults: (results: unknown[][]) => {
      mockResults.length = 0;
      results.forEach((r) => mockResults.push(r));
      callIdx = 0;
    },
  };

  return { db: chainable };
});

import { db } from '../db/client';
import { proxyRules } from '../db/schema';

const mockDb = db as unknown as {
  __setResults: (results: unknown[][]) => void;
  insert: jest.Mock;
};

/**
 * The generators write rule sets + rules straight through `db`, so these tests
 * assert the CALL SITES: a pre-write backfill (before any rule insert) and a
 * post-write capture (after every rule insert), with the trigger that matches
 * whether the set was created here ('create') or already existed ('rule_edit').
 * Capture internals live in proxy-rule-set-revisions.service.spec.ts.
 */
describe('schema generators — revision capture', () => {
  const userId = 'user-1';
  const projectId = 'project-1';
  const existingRuleSet = { id: 'set-existing', name: 'existing_set', projectId };
  const newRuleSet = { id: 'set-new', name: 'generated_pipelines', projectId };

  const schemaRow = (id: string, name: string) => ({
    id,
    name,
    projectId,
    fields: [{ name: 'key', type: 'string', required: true }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Number of rules inserted so far — lets us pin backfill/capture either side
  // of the rule writes.
  const ruleInsertCount = () =>
    mockDb.insert.mock.calls.filter(([table]) => table === proxyRules).length;

  let ruleInsertsAtBackfill: number;
  let ruleInsertsAtCapture: number;

  const mockRevisions = {
    backfill: jest.fn(),
    capture: jest.fn(),
  };

  const mockPermissionsService = {
    requireProjectAccess: jest.fn().mockResolvedValue(undefined),
  };

  const mockProjectAISettingsService = {
    getProviderConfig: jest
      .fn()
      .mockResolvedValue({ provider: 'openai', defaultModel: 'gpt-4o', apiKey: 'sk-test' }),
  };

  let stateGenerator: StateSchemaGeneratorService;
  let chatGenerator: ChatSchemaGeneratorService;
  let uploadGenerator: UploadSchemaGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateSchemaGeneratorService,
        ChatSchemaGeneratorService,
        UploadSchemaGeneratorService,
        { provide: SchemaGeneratorRevisionsService, useValue: mockRevisions },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: ProjectAISettingsService, useValue: mockProjectAISettingsService },
      ],
    }).compile();

    stateGenerator = module.get(StateSchemaGeneratorService);
    chatGenerator = module.get(ChatSchemaGeneratorService);
    uploadGenerator = module.get(UploadSchemaGeneratorService);

    jest.clearAllMocks();
    ruleInsertsAtBackfill = -1;
    ruleInsertsAtCapture = -1;
    mockRevisions.backfill.mockImplementation(async () => {
      ruleInsertsAtBackfill = ruleInsertCount();
    });
    mockRevisions.capture.mockImplementation(async () => {
      ruleInsertsAtCapture = ruleInsertCount();
    });
  });

  describe('StateSchemaGeneratorService', () => {
    it('backfills before the rule writes and captures a "rule_edit" revision after them, for an existing set', async () => {
      mockDb.__setResults([
        [], // no schema with this name yet
        [schemaRow('schema-1', 'counter')], // insert schema
        [existingRuleSet], // lookup dto.ruleSetId
        [{ id: 'rule-get' }],
        [{ id: 'rule-post' }],
      ]);

      await stateGenerator.generateStateSchema(
        { projectId, name: 'counter', scope: 'global', ruleSetId: existingRuleSet.id },
        userId,
        'admin',
      );

      expect(mockRevisions.backfill).toHaveBeenCalledWith(existingRuleSet, userId);
      expect(ruleInsertsAtBackfill).toBe(0);

      expect(mockRevisions.capture).toHaveBeenCalledWith(existingRuleSet, 'rule_edit', userId);
      expect(ruleInsertsAtCapture).toBe(2);
    });

    it('captures a "create" revision when it creates the rule set itself', async () => {
      mockDb.__setResults([
        [],
        [schemaRow('schema-1', 'counter')],
        [newRuleSet], // insert rule set
        [{ id: 'rule-get' }],
        [{ id: 'rule-post' }],
      ]);

      await stateGenerator.generateStateSchema(
        { projectId, name: 'counter', scope: 'global' },
        userId,
        'admin',
      );

      expect(mockRevisions.capture).toHaveBeenCalledWith(newRuleSet, 'create', userId);
      expect(ruleInsertsAtCapture).toBe(2);
    });
  });

  describe('UploadSchemaGeneratorService', () => {
    it('backfills before the rule writes and captures a "rule_edit" revision after them, for an existing set', async () => {
      mockDb.__setResults([
        [],
        [schemaRow('schema-2', 'docs')],
        [existingRuleSet],
        [{ id: 'rule-post' }],
        [{ id: 'rule-get' }],
      ]);

      await uploadGenerator.generateUploadSchema(
        { projectId, name: 'docs', subDir: 'docs', ruleSetId: existingRuleSet.id },
        userId,
        'admin',
      );

      expect(mockRevisions.backfill).toHaveBeenCalledWith(existingRuleSet, userId);
      expect(ruleInsertsAtBackfill).toBe(0);

      expect(mockRevisions.capture).toHaveBeenCalledWith(existingRuleSet, 'rule_edit', userId);
      expect(ruleInsertsAtCapture).toBe(2);
    });

    it('captures a "create" revision when it creates the rule set itself', async () => {
      mockDb.__setResults([
        [],
        [schemaRow('schema-2', 'docs')],
        [newRuleSet],
        [{ id: 'rule-post' }],
        [{ id: 'rule-get' }],
      ]);

      await uploadGenerator.generateUploadSchema(
        { projectId, name: 'docs', subDir: 'docs' },
        userId,
        'admin',
      );

      expect(mockRevisions.capture).toHaveBeenCalledWith(newRuleSet, 'create', userId);
      expect(ruleInsertsAtCapture).toBe(2);
    });
  });

  describe('ChatSchemaGeneratorService', () => {
    it('backfills before the rule writes and captures a "rule_edit" revision after them, for an existing set', async () => {
      mockDb.__setResults([
        [], // no conversations schema
        [], // no messages schema
        [schemaRow('schema-conv', 'support_conversations')],
        [schemaRow('schema-msg', 'support_messages')],
        [existingRuleSet],
        [{ id: 'rule-get' }],
        [{ id: 'rule-post' }],
      ]);

      await chatGenerator.generateChatSchema(
        { projectId, name: 'support', scope: 'user', ruleSetId: existingRuleSet.id },
        userId,
        'admin',
      );

      expect(mockRevisions.backfill).toHaveBeenCalledWith(existingRuleSet, userId);
      expect(ruleInsertsAtBackfill).toBe(0);

      expect(mockRevisions.capture).toHaveBeenCalledWith(existingRuleSet, 'rule_edit', userId);
      expect(ruleInsertsAtCapture).toBe(2);
    });

    it('captures a "create" revision when it creates the rule set itself', async () => {
      mockDb.__setResults([
        [],
        [],
        [schemaRow('schema-conv', 'support_conversations')],
        [schemaRow('schema-msg', 'support_messages')],
        [newRuleSet],
        [{ id: 'rule-get' }],
        [{ id: 'rule-post' }],
      ]);

      await chatGenerator.generateChatSchema(
        { projectId, name: 'support', scope: 'user' },
        userId,
        'admin',
      );

      expect(mockRevisions.capture).toHaveBeenCalledWith(newRuleSet, 'create', userId);
      expect(ruleInsertsAtCapture).toBe(2);
    });
  });
});
