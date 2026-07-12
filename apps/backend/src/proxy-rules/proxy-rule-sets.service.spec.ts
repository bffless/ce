import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRulesService } from './proxy-rules.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import { ENVELOPE_KEY_ORDER, RULE_KEY_ORDER } from './export-format.util';

// Mock the db client - using factory function for hoisting
jest.mock('../db/client', () => {
  const mockResults: { data: unknown[] }[] = [];
  let callIdx = 0;

  const chainable = {
    select: jest.fn(() => chainable),
    from: jest.fn(() => chainable),
    where: jest.fn(() => chainable),
    orderBy: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [];
      callIdx++;
      return Promise.resolve(result);
    }),
    limit: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [];
      callIdx++;
      return Promise.resolve(result);
    }),
    insert: jest.fn(() => chainable),
    values: jest.fn(() => chainable),
    returning: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [{ id: 'test-id' }];
      callIdx++;
      return Promise.resolve(result);
    }),
    update: jest.fn(() => chainable),
    set: jest.fn(() => chainable),
    delete: jest.fn(() => chainable),
    // Transaction mock: invokes the callback with the SAME chainable as the tx
    // handle, so writes inside a transaction register on the shared jest.fns
    // and the mockResults slot accounting continues seamlessly. A throw inside
    // the callback propagates out (real drizzle rolls the transaction back on
    // throw — the rollback test asserts the error escapes un-swallowed and no
    // post-commit effect runs).
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chainable)),
    __setResults: (results: unknown[][]) => {
      mockResults.length = 0;
      results.forEach((r) => mockResults.push({ data: r }));
      callIdx = 0;
    },
    __reset: () => {
      mockResults.length = 0;
      callIdx = 0;
    },
  };

  return { db: chainable };
});

import { db } from '../db/client';
const mockDb = db as unknown as {
  __setResults: (results: unknown[][]) => void;
  __reset: () => void;
  insert: jest.Mock;
  values: jest.Mock;
  returning: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;
  delete: jest.Mock;
  where: jest.Mock;
  transaction: jest.Mock;
};

describe('ProxyRuleSetsService', () => {
  let service: ProxyRuleSetsService;

  const mockPermissionsService = {
    requireProjectAccess: jest.fn().mockResolvedValue(undefined),
    enforceApiKeyProjectScope: jest.fn(),
  };

  const mockProxyRulesService = {
    getRulesByRuleSetId: jest.fn(),
    encryptHeaderConfigForStorage: jest.fn((hc: unknown) => hc),
  };

  const mockNginxRegenerationService = {
    regenerateForRuleSet: jest.fn().mockResolvedValue(undefined),
    regenerateForAlias: jest.fn().mockResolvedValue(undefined),
  };

  const mockPipelineSchemasService = {
    getById: jest.fn(),
    getByProjectId: jest.fn(),
    create: jest.fn(),
  };

  const createMockRuleSet = (overrides: Record<string, unknown> = {}) => ({
    id: 'rule-set-1',
    projectId: 'project-1',
    name: 'api-backend',
    description: 'API proxy rules',
    environment: 'production',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  });

  // DB-shaped rule row as getRulesByRuleSetId returns it (headerConfig decrypted)
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    mockDb.__reset();
    jest.clearAllMocks();
    mockPermissionsService.requireProjectAccess.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyRuleSetsService,
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: ProxyRulesService, useValue: mockProxyRulesService },
        { provide: NginxRegenerationService, useValue: mockNginxRegenerationService },
        { provide: PipelineSchemasService, useValue: mockPipelineSchemasService },
      ],
    }).compile();

    service = module.get<ProxyRuleSetsService>(ProxyRuleSetsService);
  });

  describe('exportRuleSet', () => {
    it('returns the canonical v2 envelope with keys in ENVELOPE_KEY_ORDER', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([createMockRule()]);

      const before = Date.now();
      const result = await service.exportRuleSet('rule-set-1');
      const after = Date.now();

      expect(result.version).toBe(2);
      expect(result.kind).toBe('bffless-proxy-rule-set');
      expect(result.ruleSet).toEqual({
        name: 'api-backend',
        description: 'API proxy rules',
        environment: 'production',
      });
      // No schemas referenced → schemas key omitted entirely
      expect(Object.keys(result)).toEqual(
        ENVELOPE_KEY_ORDER.filter((k) => k !== 'schemas'),
      );
      // Fresh exportedAt: valid ISO timestamp within this test's window
      const exportedAt = Date.parse(result.exportedAt);
      expect(exportedAt).toBeGreaterThanOrEqual(before);
      expect(exportedAt).toBeLessThanOrEqual(after);
    });

    it('serializes rules with all populated RULE_KEY_ORDER keys, including methods (#448)', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({
          method: 'GET',
          methods: ['GET', 'POST'],
          headerConfig: { forward: ['accept'] },
          authTransform: { type: 'cookie-to-bearer' },
          emailHandlerConfig: { destinationEmail: 'a@b.c' },
          pipelineConfig: { name: 'p', steps: [{ name: 's', handlerType: 'data_query', config: {} }] },
          description: 'a rule',
        }),
      ]);

      const result = await service.exportRuleSet('rule-set-1');

      expect(result.rules).toHaveLength(1);
      const rule = result.rules[0];
      // Every RULE_KEY_ORDER key populated → all 18 present, in canonical order
      expect(Object.keys(rule)).toEqual([...RULE_KEY_ORDER]);
      expect(rule.methods).toEqual(['GET', 'POST']);
      // Server-managed fields never appear
      expect(rule).not.toHaveProperty('id');
      expect(rule).not.toHaveProperty('ruleSetId');
      expect(rule).not.toHaveProperty('createdAt');
      expect(rule).not.toHaveProperty('updatedAt');
    });

    it('drops null-valued keys at the rule top level', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([createMockRule()]);

      const result = await service.exportRuleSet('rule-set-1');

      const rule = result.rules[0];
      expect(rule).not.toHaveProperty('method');
      expect(rule).not.toHaveProperty('methods');
      expect(rule).not.toHaveProperty('headerConfig');
      expect(rule).not.toHaveProperty('description');
    });

    it('blanks header add secret values to empty strings', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({
          headerConfig: {
            forward: ['accept'],
            strip: ['cookie'],
            add: { 'X-API-Key': 'sk_live_secret', Authorization: 'Bearer token' },
          },
        }),
      ]);

      const result = await service.exportRuleSet('rule-set-1');

      expect(result.rules[0].headerConfig).toEqual({
        forward: ['accept'],
        strip: ['cookie'],
        add: { 'X-API-Key': '', Authorization: '' },
      });
      expect(JSON.stringify(result)).not.toContain('sk_live_secret');
      expect(JSON.stringify(result)).not.toContain('Bearer token');
    });

    it('bundles referenced schemas as {id, name, fields}', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({
          proxyType: 'pipeline',
          targetUrl: 'http://internal/pipeline',
          pipelineConfig: {
            name: 'comments',
            steps: [{ name: 'query', handlerType: 'data_query', config: { schemaId: 'schema-1' } }],
          },
        }),
      ]);
      mockPipelineSchemasService.getById.mockResolvedValue({
        id: 'schema-1',
        projectId: 'project-1',
        name: 'comments',
        fields: [{ name: 'body', type: 'string', required: true }],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.exportRuleSet('rule-set-1');

      expect(mockPipelineSchemasService.getById).toHaveBeenCalledWith('schema-1');
      expect(result.schemas).toEqual([
        {
          id: 'schema-1',
          name: 'comments',
          fields: [{ name: 'body', type: 'string', required: true }],
        },
      ]);
      // schemas is the last envelope key
      expect(Object.keys(result)).toEqual([...ENVELOPE_KEY_ORDER]);
    });

    it('skips missing schemas silently (frontend export parity)', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({
          proxyType: 'pipeline',
          targetUrl: 'http://internal/pipeline',
          pipelineConfig: {
            name: 'comments',
            steps: [{ name: 'query', handlerType: 'data_query', config: { schemaId: 'schema-gone' } }],
          },
        }),
      ]);
      mockPipelineSchemasService.getById.mockResolvedValue(null);

      const result = await service.exportRuleSet('rule-set-1');

      // Left as an unbundled reference; schemas key omitted entirely
      expect(result).not.toHaveProperty('schemas');
      expect(result.rules[0].pipelineConfig).toEqual({
        name: 'comments',
        steps: [{ name: 'query', handlerType: 'data_query', config: { schemaId: 'schema-gone' } }],
      });
    });

    it('skips schemas belonging to another project', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({
          proxyType: 'pipeline',
          targetUrl: 'http://internal/pipeline',
          pipelineConfig: {
            name: 'comments',
            steps: [{ name: 'query', handlerType: 'data_query', config: { schemaId: 'schema-other' } }],
          },
        }),
      ]);
      mockPipelineSchemasService.getById.mockResolvedValue({
        id: 'schema-other',
        projectId: 'project-OTHER',
        name: 'foreign',
        fields: [{ name: 'x', type: 'string' }],
      });

      const result = await service.exportRuleSet('rule-set-1');

      expect(result).not.toHaveProperty('schemas');
    });

    it('throws NotFoundException when the rule set does not exist', async () => {
      mockDb.__setResults([[]]);

      await expect(service.exportRuleSet('missing-set')).rejects.toThrow(NotFoundException);
      expect(mockProxyRulesService.getRulesByRuleSetId).not.toHaveBeenCalled();
    });

    it('enforces API key project scope against the rule set project (getById parity)', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([]);

      await service.exportRuleSet('rule-set-1', 'project-1');

      expect(mockPermissionsService.enforceApiKeyProjectScope).toHaveBeenCalledWith(
        'project-1',
        'project-1',
      );
    });

    it('propagates scope-enforcement failures before loading rules', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);
      mockPermissionsService.enforceApiKeyProjectScope.mockImplementationOnce(() => {
        throw new ForbiddenException('API key is scoped to a different project');
      });

      await expect(service.exportRuleSet('rule-set-1', 'other-project')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockProxyRulesService.getRulesByRuleSetId).not.toHaveBeenCalled();
    });

    it('omits null description/environment from ruleSet metadata', async () => {
      mockDb.__setResults([[createMockRuleSet({ description: null, environment: null })]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([]);

      const result = await service.exportRuleSet('rule-set-1');

      expect(result.ruleSet).toEqual({ name: 'api-backend' });
    });
  });

  describe('resolveSchemasByName', () => {
    // The helper is private (only the sync path calls it); tests reach it via
    // a structural cast rather than widening its visibility.
    type IncomingSchema = {
      id: string;
      name: string;
      fields: { name: string; type: string; required?: boolean }[];
    };
    type Resolution = {
      name: string;
      action: 'reuse' | 'create';
      targetSchemaId: string | null;
      fieldMismatch: boolean;
    };
    const resolve = (
      schemas: IncomingSchema[] | undefined,
      options: { strictSchemas: boolean; dryRun: boolean } = {
        strictSchemas: false,
        dryRun: false,
      },
    ) =>
      (
        service as unknown as {
          resolveSchemasByName: (
            projectId: string,
            schemas: IncomingSchema[] | undefined,
            options: { strictSchemas: boolean; dryRun: boolean },
            userId: string,
            userRole: string,
            apiKeyProjectId?: string | null,
          ) => Promise<{
            idMap: Map<string, string>;
            resolutions: Resolution[];
            warnings: string[];
          }>;
        }
      ).resolveSchemasByName('project-1', schemas, options, 'user-1', 'admin', 'project-1');

    const existingComments = {
      id: 'existing-comments-id',
      projectId: 'project-1',
      name: 'comments',
      fields: [{ name: 'body', type: 'text', required: true }],
      version: 1,
      recordCount: 0,
    };

    beforeEach(() => {
      mockPipelineSchemasService.getByProjectId.mockResolvedValue([existingComments]);
      mockPipelineSchemasService.create.mockImplementation(
        (dto: { name: string }) => Promise.resolve({ id: `created-${dto.name}`, ...dto }),
      );
    });

    it('reuses a name match with identical fields: mapped id, no warning, no mismatch', async () => {
      const result = await resolve([
        {
          id: 'src-1',
          name: 'comments',
          fields: [{ name: 'body', type: 'text', required: true }],
        },
      ]);

      expect(mockPipelineSchemasService.getByProjectId).toHaveBeenCalledWith(
        'project-1',
        'project-1',
      );
      expect(result.idMap.get('src-1')).toBe('existing-comments-id');
      expect(result.resolutions).toEqual([
        {
          name: 'comments',
          action: 'reuse',
          targetSchemaId: 'existing-comments-id',
          fieldMismatch: false,
        },
      ]);
      expect(result.warnings).toEqual([]);
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('reuses a name match despite field mismatch: warning + fieldMismatch, no throw when not strict', async () => {
      const result = await resolve([
        {
          id: 'src-1',
          name: 'comments',
          fields: [{ name: 'body', type: 'string', required: false }],
        },
      ]);

      expect(result.idMap.get('src-1')).toBe('existing-comments-id');
      expect(result.resolutions[0]).toEqual({
        name: 'comments',
        action: 'reuse',
        targetSchemaId: 'existing-comments-id',
        fieldMismatch: true,
      });
      expect(result.warnings).toEqual([
        'Schema "comments": field "body": type string (incoming) vs text (existing)',
        'Schema "comments": field "body": required false (incoming) vs true (existing)',
      ]);
    });

    it('strictSchemas: throws 400 listing every mismatch, before any creation side effect', async () => {
      mockPipelineSchemasService.getByProjectId.mockResolvedValue([
        existingComments,
        {
          ...existingComments,
          id: 'existing-votes-id',
          name: 'votes',
          fields: [{ name: 'score', type: 'number', required: true }],
        },
      ]);

      const schemas: IncomingSchema[] = [
        { id: 'src-1', name: 'comments', fields: [{ name: 'body', type: 'json', required: true }] },
        // A pending create sandwiched between two mismatched reuses — it must
        // NOT be created when strict fails
        { id: 'src-2', name: 'brand-new', fields: [{ name: 'x', type: 'string' }] },
        { id: 'src-3', name: 'votes', fields: [{ name: 'score', type: 'string', required: true }] },
      ];

      await expect(resolve(schemas, { strictSchemas: true, dryRun: false })).rejects.toThrow(
        BadRequestException,
      );
      await expect(resolve(schemas, { strictSchemas: true, dryRun: false })).rejects.toThrow(
        /comments.*type json \(incoming\) vs text \(existing\).*votes.*type string \(incoming\) vs number \(existing\)/s,
      );
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('creates a missing schema live with the EXACT name (no auto-suffixing)', async () => {
      const result = await resolve([
        { id: 'src-1', name: 'brand-new', fields: [{ name: 'x', type: 'string' }] },
      ]);

      expect(mockPipelineSchemasService.create).toHaveBeenCalledTimes(1);
      expect(mockPipelineSchemasService.create).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          name: 'brand-new',
          fields: [{ name: 'x', type: 'string' }],
        },
        'user-1',
        'admin',
        'project-1',
      );
      expect(result.idMap.get('src-1')).toBe('created-brand-new');
      expect(result.resolutions).toEqual([
        {
          name: 'brand-new',
          action: 'create',
          targetSchemaId: 'created-brand-new',
          fieldMismatch: false,
        },
      ]);
      expect(result.warnings).toEqual([]);
    });

    it('dryRun: plans the create with targetSchemaId null and never calls create', async () => {
      const result = await resolve(
        [{ id: 'src-1', name: 'brand-new', fields: [{ name: 'x', type: 'string' }] }],
        { strictSchemas: false, dryRun: true },
      );

      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
      expect(result.resolutions).toEqual([
        { name: 'brand-new', action: 'create', targetSchemaId: null, fieldMismatch: false },
      ]);
      expect(result.idMap.has('src-1')).toBe(false);
    });

    it('handles a mixed batch: clean reuse + mismatched reuse + create, in payload order', async () => {
      mockPipelineSchemasService.getByProjectId.mockResolvedValue([
        existingComments,
        {
          ...existingComments,
          id: 'existing-votes-id',
          name: 'votes',
          fields: [{ name: 'score', type: 'number', required: false }],
        },
      ]);

      const result = await resolve([
        { id: 'src-1', name: 'comments', fields: [{ name: 'body', type: 'text', required: true }] },
        { id: 'src-2', name: 'votes', fields: [{ name: 'score', type: 'string' }] },
        { id: 'src-3', name: 'brand-new', fields: [{ name: 'x', type: 'string' }] },
      ]);

      expect(result.resolutions).toEqual([
        {
          name: 'comments',
          action: 'reuse',
          targetSchemaId: 'existing-comments-id',
          fieldMismatch: false,
        },
        { name: 'votes', action: 'reuse', targetSchemaId: 'existing-votes-id', fieldMismatch: true },
        {
          name: 'brand-new',
          action: 'create',
          targetSchemaId: 'created-brand-new',
          fieldMismatch: false,
        },
      ]);
      expect(result.warnings).toEqual([
        'Schema "votes": field "score": type string (incoming) vs number (existing)',
      ]);
      expect(result.idMap).toEqual(
        new Map([
          ['src-1', 'existing-comments-id'],
          ['src-2', 'existing-votes-id'],
          ['src-3', 'created-brand-new'],
        ]),
      );
      expect(mockPipelineSchemasService.create).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate schema names within the payload before touching the DB', async () => {
      await expect(
        resolve([
          { id: 'src-1', name: 'comments', fields: [] },
          { id: 'src-2', name: 'comments', fields: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(mockPipelineSchemasService.getByProjectId).not.toHaveBeenCalled();
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('returns an empty result for empty or undefined schemas with no DB access', async () => {
      for (const schemas of [[], undefined] as (IncomingSchema[] | undefined)[]) {
        const result = await resolve(schemas);
        expect(result.idMap.size).toBe(0);
        expect(result.resolutions).toEqual([]);
        expect(result.warnings).toEqual([]);
      }
      expect(mockPipelineSchemasService.getByProjectId).not.toHaveBeenCalled();
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate source ids within the payload (refs remap by id)', async () => {
      await expect(
        resolve([
          { id: 'src-1', name: 'comments', fields: [] },
          { id: 'src-1', name: 'messages', fields: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(mockPipelineSchemasService.getByProjectId).not.toHaveBeenCalled();
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('dryRun reuse still resolves the real target id and populates the idMap', async () => {
      const result = await resolve(
        [{ id: 'src-1', name: 'comments', fields: [{ name: 'body', type: 'text', required: true }] }],
        { strictSchemas: false, dryRun: true },
      );
      expect(result.resolutions).toEqual([
        { name: 'comments', action: 'reuse', targetSchemaId: 'existing-comments-id', fieldMismatch: false },
      ]);
      expect(result.idMap.get('src-1')).toBe('existing-comments-id');
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('strictSchemas mismatch throws 400 even under dryRun (CI must fail loudly)', async () => {
      await expect(
        resolve(
          [{ id: 'src-1', name: 'comments', fields: [{ name: 'body', type: 'number' }] }],
          { strictSchemas: true, dryRun: true },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });
  });

  describe('syncRuleSet', () => {
    const mockProject = { id: 'project-1', name: 'Project One' };

    /** Minimal incoming rule matching createMockRule() once defaults apply. */
    const baseRule = () => ({
      pathPattern: '/api/*',
      targetUrl: 'https://api.example.com',
    });

    const syncDto = (overrides: Record<string, unknown> = {}) => ({
      ruleSet: { name: 'api-backend', description: 'API proxy rules', environment: 'production' },
      rules: [baseRule()],
      ...overrides,
    });

    const sync = (dto: Record<string, unknown>) =>
      service.syncRuleSet(
        'project-1',
        dto as unknown as Parameters<typeof service.syncRuleSet>[1],
        'user-1',
        'admin',
        'project-1',
      );

    beforeEach(() => {
      // Tag encrypted values so specs can assert the exact encrypted form
      // (in particular: blank-secret preservation encrypts the LIVE value).
      mockProxyRulesService.encryptHeaderConfigForStorage.mockImplementation(
        (hc: { add?: Record<string, string> } | null) => {
          if (!hc) return null;
          if (!hc.add) return { ...hc };
          return {
            ...hc,
            add: Object.fromEntries(
              Object.entries(hc.add).map(([k, v]) => [k, `enc(${v})`]),
            ),
          };
        },
      );
      mockPipelineSchemasService.getByProjectId.mockResolvedValue([]);
    });

    it('throws NotFoundException when the project does not exist', async () => {
      mockDb.__setResults([[]]);

      await expect(sync(syncDto())).rejects.toThrow(NotFoundException);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('is idempotent: re-syncing a payload whose live rules already match writes no rules but re-stamps source', async () => {
      // Live rules mocked as the DB result of having synced this very payload
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([createMockRule()]);

      const result = await sync(syncDto());

      expect(mockPermissionsService.requireProjectAccess).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'admin',
        'contributor',
        'project-1',
      );
      expect(result).toMatchObject({
        ruleSetId: 'rule-set-1',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [{ pathPattern: '/api/*', method: null }],
        pruneCandidates: [],
        missingSecrets: [],
        warnings: [],
        dryRun: false,
        setCreated: false,
      });

      // NO rule writes …
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
      // … but ONE transaction whose only write re-stamps source on the set row
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      const stamped = mockDb.set.mock.calls[0][0];
      expect(stamped.source.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(stamped.source.syncedAt)).not.toBeNaN();
      // Unchanged metadata is not rewritten
      expect(stamped.description).toBeUndefined();
      expect(stamped.environment).toBeUndefined();
      // Nothing changed → no nginx regeneration
      expect(mockNginxRegenerationService.regenerateForRuleSet).not.toHaveBeenCalled();
    });

    it('stamps the same contentHash for the same payload on consecutive syncs', async () => {
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([createMockRule()]);

      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      await sync(syncDto());
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      await sync(syncDto());

      const calls = mockDb.set.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].source.contentHash).toBe(calls[1][0].source.contentHash);
    });

    it('creates the set and all rules from scratch, stamping source and regenerating nginx once', async () => {
      mockDb.__setResults([
        [mockProject],
        [], // findByName: no existing set
        [createMockRuleSet({ id: 'new-set-id', name: 'api-backend' })], // insert … returning
      ]);

      const result = await sync(
        syncDto({
          rules: [{ ...baseRule(), headerConfig: { add: { 'X-Api-Key': 'secretv' } } }],
          source: { repo: 'bffless/apps', path: 'apps/studio/.bffless/proxy-rules/studio', gitSha: 'abc123' },
        }),
      );

      expect(result).toMatchObject({
        ruleSetId: 'new-set-id',
        created: [{ pathPattern: '/api/*', method: null }],
        updated: [],
        deleted: [],
        unchanged: [],
        dryRun: false,
        setCreated: true,
      });

      // First values() call: the set row, with caller source + server stamp merged
      const setValues = mockDb.values.mock.calls[0][0];
      expect(setValues).toMatchObject({
        projectId: 'project-1',
        name: 'api-backend',
        description: 'API proxy rules',
        environment: 'production',
      });
      expect(setValues.source).toMatchObject({
        repo: 'bffless/apps',
        path: 'apps/studio/.bffless/proxy-rules/studio',
        gitSha: 'abc123',
      });
      expect(setValues.source.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(setValues.source.syncedAt)).not.toBeNaN();

      // Second values() call: the rule row, defaults applied, header add encrypted
      const ruleValues = mockDb.values.mock.calls[1][0];
      expect(ruleValues).toMatchObject({
        ruleSetId: 'new-set-id',
        pathPattern: '/api/*',
        method: null,
        targetUrl: 'https://api.example.com',
        stripPrefix: true,
        order: 0,
        timeout: 30000,
        proxyType: 'external_proxy',
        isEnabled: true,
      });
      expect(ruleValues.headerConfig.add).toEqual({ 'X-Api-Key': 'enc(secretv)' });

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockNginxRegenerationService.regenerateForRuleSet).toHaveBeenCalledTimes(1);
      expect(mockNginxRegenerationService.regenerateForRuleSet).toHaveBeenCalledWith('new-set-id');
    });

    it('preserves live secret values for blank incoming header adds on update, without mutating the DTO', async () => {
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({ headerConfig: { add: { 'X-K': 'livesecret' } } }),
      ]);

      const incomingRule = {
        ...baseRule(),
        forwardCookies: true, // a real field change
        headerConfig: { add: { 'X-K': '', 'X-N': 'newval' } },
      };
      const result = await sync(syncDto({ rules: [incomingRule] }));

      expect(result.updated).toEqual([{ pathPattern: '/api/*', method: null }]);
      // Blank on an UPDATED rule is preserved from live, not reported missing
      expect(result.missingSecrets).toEqual([]);

      // The rule update (the set() call carrying pathPattern) holds the LIVE
      // value for X-K — in encrypted form — and the new value for X-N
      const ruleUpdate = mockDb.set.mock.calls.find((call) => call[0].pathPattern)?.[0];
      expect(ruleUpdate).toBeDefined();
      expect(ruleUpdate.headerConfig.add).toEqual({
        'X-K': 'enc(livesecret)',
        'X-N': 'enc(newval)',
      });
      expect(ruleUpdate.forwardCookies).toBe(true);

      // The request DTO objects were never mutated
      expect(incomingRule.headerConfig.add['X-K']).toBe('');
      expect(incomingRule.headerConfig.add['X-N']).toBe('newval');
    });

    it('reports live-only rules as pruneCandidates (no delete, no nginx) when prune is off', async () => {
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule(),
        createMockRule({ id: 'rule-2', pathPattern: '/old/*' }),
      ]);

      const result = await sync(syncDto());

      expect(result.pruneCandidates).toEqual([{ pathPattern: '/old/*', method: null }]);
      expect(result.deleted).toEqual([]);
      expect(mockDb.delete).not.toHaveBeenCalled();
      // Unchanged + pruneCandidates only → nothing changed → no nginx
      expect(mockNginxRegenerationService.regenerateForRuleSet).not.toHaveBeenCalled();
    });

    it('deletes live-only rules when prune is on', async () => {
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule(),
        createMockRule({ id: 'rule-2', pathPattern: '/old/*' }),
      ]);

      const result = await sync(syncDto({ options: { prune: true } }));

      expect(result.deleted).toEqual([{ pathPattern: '/old/*', method: null }]);
      expect(result.pruneCandidates).toEqual([]);
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(mockNginxRegenerationService.regenerateForRuleSet).toHaveBeenCalledTimes(1);
    });

    it('dryRun of a nonexistent set: full plan, ruleSetId null, ZERO writes, no nginx', async () => {
      mockDb.__setResults([[mockProject], []]);

      const result = await sync(syncDto({ options: { dryRun: true } }));

      expect(result).toMatchObject({
        ruleSetId: null,
        created: [{ pathPattern: '/api/*', method: null }],
        dryRun: true,
        setCreated: true,
      });
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockNginxRegenerationService.regenerateForRuleSet).not.toHaveBeenCalled();
    });

    it('dryRun of an existing set returns its id and writes nothing (no source re-stamp)', async () => {
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([createMockRule()]);

      const result = await sync(syncDto({ options: { dryRun: true, prune: true } }));

      expect(result.ruleSetId).toBe('rule-set-1');
      expect(result.unchanged).toEqual([{ pathPattern: '/api/*', method: null }]);
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('reports missing {{secrets.NAME}} references and new-rule blank header names, deduped and sorted', async () => {
      mockDb.__setResults([
        [mockProject],
        [], // findByName
        [{ name: 'BAR' }], // project_secrets names
      ]);

      const result = await sync(
        syncDto({
          rules: [
            {
              pathPattern: '/api/ai',
              method: 'POST',
              pipelineConfig: {
                name: 'ai',
                steps: [
                  {
                    handlerType: 'ai',
                    config: { apiKey: '{{secrets.FOO}}', other: '{{ secrets.BAR }}' },
                  },
                ],
              },
            },
            {
              pathPattern: '/api/h',
              targetUrl: 'https://x.example.com',
              headerConfig: { add: { 'X-New-Key': '' } },
            },
          ],
          options: { dryRun: true },
        }),
      );

      // FOO has no project secret; BAR exists; the new rule's blank header
      // add name is reported (nothing live to preserve — decision 1)
      expect(result.missingSecrets).toEqual(['FOO', 'X-New-Key']);
    });

    it('reports blank headers on UPDATED rules only when no live value exists to preserve', async () => {
      mockDb.__setResults([
        [mockProject],
        [createMockRuleSet()], // findByName → existing set
      ]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({
          headerConfig: { add: { 'X-Kept': 'livesecret' } },
        }),
      ]);

      const result = await sync(
        syncDto({
          rules: [
            {
              pathPattern: '/api/*',
              targetUrl: 'https://api.example.com',
              forwardCookies: true, // real change → toUpdate
              headerConfig: { add: { 'X-Kept': '', 'X-Fresh': '' } },
            },
          ],
          options: { dryRun: true },
        }),
      );

      // X-Kept has a live value that will be preserved; X-Fresh is a brand-new
      // blank header on an updated rule and would be stored as '' — report it.
      expect(result.missingSecrets).toEqual(['X-Fresh']);
    });

    it('strictSchemas mismatch → 400 before any write', async () => {
      mockDb.__setResults([[mockProject]]);
      mockPipelineSchemasService.getByProjectId.mockResolvedValue([
        {
          id: 'existing-comments-id',
          projectId: 'project-1',
          name: 'comments',
          fields: [{ name: 'body', type: 'text', required: true }],
        },
      ]);

      await expect(
        sync(
          syncDto({
            schemas: [{ id: 'src-1', name: 'comments', fields: [{ name: 'body', type: 'string' }] }],
            options: { strictSchemas: true },
          }),
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockPipelineSchemasService.create).not.toHaveBeenCalled();
    });

    it('surfaces the computeSyncPlan duplicate-key error as a 400, before schema resolution', async () => {
      mockDb.__setResults([[mockProject]]);

      await expect(
        sync(
          syncDto({
            rules: [baseRule(), { ...baseRule() }],
            // Schemas present to prove the early duplicate check precedes
            // resolution (which would otherwise create schemas outside the
            // rule transaction before the 400)
            schemas: [{ id: 'src-1', name: 'brand-new', fields: [] }],
          }),
        ),
      ).rejects.toThrow(/Duplicate rule for path pattern "\/api\/\*"/);

      expect(mockPipelineSchemasService.getByProjectId).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rolls back on a mid-transaction write failure: error propagates, no nginx', async () => {
      mockDb.__setResults([[mockProject], [createMockRuleSet()]]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([
        createMockRule({ pathPattern: '/old/*' }),
      ]);
      // The last write of this sync is the prune delete — make it fail. The
      // transaction mock lets the throw escape the callback, which is exactly
      // what real drizzle does before rolling back every statement issued on tx.
      mockDb.delete.mockImplementationOnce(() => {
        throw new Error('write failed');
      });

      await expect(sync(syncDto({ rules: [], options: { prune: true } }))).rejects.toThrow(
        'write failed',
      );

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockNginxRegenerationService.regenerateForRuleSet).not.toHaveBeenCalled();
    });

    it('appends a warning (not a 500) when nginx regeneration fails after commit', async () => {
      mockDb.__setResults([
        [mockProject],
        [],
        [createMockRuleSet({ id: 'new-set-id', name: 'api-backend' })],
      ]);
      mockNginxRegenerationService.regenerateForRuleSet.mockRejectedValueOnce(
        new Error('nginx down'),
      );

      const result = await sync(syncDto());

      expect(result.ruleSetId).toBe('new-set-id');
      expect(result.created).toHaveLength(1);
      expect(result.warnings).toEqual([
        expect.stringMatching(/nginx regeneration failed after sync: nginx down/),
      ]);
    });

    it('returns response arrays sorted by (pathPattern, method) for byte-stable CI output', async () => {
      mockDb.__setResults([[mockProject], []]);

      const result = await sync(
        syncDto({
          rules: [
            { pathPattern: '/b', targetUrl: 'https://api.example.com' },
            { pathPattern: '/a', method: 'GET', targetUrl: 'https://api.example.com' },
            { pathPattern: '/a', targetUrl: 'https://api.example.com' },
          ],
          options: { dryRun: true },
        }),
      );

      expect(result.created).toEqual([
        { pathPattern: '/a', method: null },
        { pathPattern: '/a', method: 'GET' },
        { pathPattern: '/b', method: null },
      ]);
    });

    it('updates description/environment on the existing set when they actually changed', async () => {
      mockDb.__setResults([
        [mockProject],
        [createMockRuleSet({ description: 'old desc', environment: 'staging' })],
      ]);
      mockProxyRulesService.getRulesByRuleSetId.mockResolvedValue([createMockRule()]);

      await sync(syncDto());

      const stamped = mockDb.set.mock.calls[0][0];
      expect(stamped.description).toBe('API proxy rules');
      expect(stamped.environment).toBe('production');
      // Metadata-only change: rule sets' description/environment don't reach
      // nginx configs, so no regeneration
      expect(mockNginxRegenerationService.regenerateForRuleSet).not.toHaveBeenCalled();
    });

    it('rejects an empty (whitespace-only) ruleSet.name with a 400', async () => {
      mockDb.__setResults([[mockProject]]);

      await expect(sync(syncDto({ ruleSet: { name: '   ' } }))).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('resolves schemas by name and remaps rule schema refs before planning', async () => {
      mockDb.__setResults([[mockProject], []]);
      mockPipelineSchemasService.getByProjectId.mockResolvedValue([
        {
          id: 'target-comments-id',
          projectId: 'project-1',
          name: 'comments',
          fields: [{ name: 'body', type: 'text', required: true }],
        },
      ]);

      const result = await sync(
        syncDto({
          rules: [
            {
              pathPattern: '/api/comments',
              method: 'GET',
              pipelineConfig: {
                name: 'q',
                steps: [{ handlerType: 'data_query', config: { schemaId: 'src-schema-id' } }],
              },
            },
          ],
          schemas: [
            {
              id: 'src-schema-id',
              name: ' comments ', // trimmed before resolution
              fields: [{ name: 'body', type: 'text', required: true }],
            },
          ],
          options: { dryRun: true },
        }),
      );

      expect(result.schemaResolutions).toEqual([
        {
          name: 'comments',
          action: 'reuse',
          targetSchemaId: 'target-comments-id',
          fieldMismatch: false,
        },
      ]);
      expect(result.created).toEqual([{ pathPattern: '/api/comments', method: 'GET' }]);
    });
  });
});
