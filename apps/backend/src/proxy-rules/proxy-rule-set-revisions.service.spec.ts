import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

// Mock the db client with a thenable chainable: every builder method returns
// the chain itself, and awaiting the chain consumes the next queued result (in
// the order the service awaits its queries). A queued entry that is an Error
// instance causes that await to reject instead of resolve — this is how the
// "capture swallows DB errors" case is exercised.
//
// This generalizes the `__setResults` chainable-mock pattern from
// `proxy-rule-sets.service.spec.ts` to support arbitrary chain shapes
// (e.g. `.orderBy(...).limit(...)`), matching the thenable style already used
// in `traffic/blocklist.service.spec.ts`.
jest.mock('../db/client', () => {
  const mockResults: unknown[] = [];
  let callIdx = 0;
  const methods = [
    'select',
    'from',
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
  chainable.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
    const result = mockResults[callIdx];
    callIdx++;
    if (result instanceof Error) {
      return Promise.reject(result).then(resolve, reject);
    }
    return Promise.resolve(result ?? []).then(resolve, reject);
  };
  chainable.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chainable));
  chainable.__setResults = (results: unknown[]) => {
    mockResults.length = 0;
    results.forEach((r) => mockResults.push(r));
    callIdx = 0;
  };
  chainable.__reset = () => {
    mockResults.length = 0;
    callIdx = 0;
  };
  return { db: chainable };
});

import { db } from '../db/client';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import { buildExportEnvelope, serializeRuleForExport } from './export-format.util';
import {
  ProxyRuleSetRevisionsService,
  REVISION_CAP,
  computeRevisionHash,
} from './proxy-rule-set-revisions.service';
import type { ProxyRuleSet } from '../db/schema/proxy-rule-sets.schema';
import type { ProxyRule } from '../db/schema/proxy-rules.schema';

const mockDb = db as unknown as {
  __setResults: (results: unknown[]) => void;
  __reset: () => void;
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  insert: jest.Mock;
  values: jest.Mock;
  delete: jest.Mock;
};

const createRuleSet = (overrides: Partial<ProxyRuleSet> = {}): ProxyRuleSet =>
  ({
    id: 'rule-set-1',
    projectId: 'project-1',
    name: 'api-backend',
    description: 'API proxy rules',
    environment: 'production',
    source: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  }) as ProxyRuleSet;

const createRule = (overrides: Partial<ProxyRule> = {}): ProxyRule =>
  ({
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
    proxyType: 'external_proxy',
    emailHandlerConfig: null,
    pipelineConfig: null,
    isEnabled: true,
    debugEnabled: false,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  }) as unknown as ProxyRule;

// Mirrors the assembly `capture()` performs, for computing an expected hash
// independently of the service's internals (no bundled schemas in these fixtures).
const expectedHashFor = (ruleSet: ProxyRuleSet, rules: ProxyRule[]): string => {
  const serialized = rules.map((rule) => serializeRuleForExport(rule));
  const envelope = buildExportEnvelope({
    ruleSet: {
      name: ruleSet.name,
      description: ruleSet.description,
      environment: ruleSet.environment,
    },
    rules: serialized,
    schemas: [],
    exportedAt: new Date().toISOString(),
  });
  return computeRevisionHash(envelope);
};

describe('computeRevisionHash', () => {
  it('is stable across exportedAt changes', () => {
    const rule = serializeRuleForExport(createRule());
    const envelopeA = buildExportEnvelope({
      ruleSet: { name: 'api-backend' },
      rules: [rule],
      exportedAt: '2026-01-01T00:00:00Z',
    });
    const envelopeB = buildExportEnvelope({
      ruleSet: { name: 'api-backend' },
      rules: [rule],
      exportedAt: '2026-06-15T12:34:56Z',
    });

    expect(computeRevisionHash(envelopeA)).toBe(computeRevisionHash(envelopeB));
  });

  it('differs when a rule changes', () => {
    const envelopeA = buildExportEnvelope({
      ruleSet: { name: 'api-backend' },
      rules: [serializeRuleForExport(createRule())],
      exportedAt: '2026-01-01T00:00:00Z',
    });
    const envelopeB = buildExportEnvelope({
      ruleSet: { name: 'api-backend' },
      rules: [serializeRuleForExport(createRule({ targetUrl: 'https://changed.example.com' }))],
      exportedAt: '2026-01-01T00:00:00Z',
    });

    expect(computeRevisionHash(envelopeA)).not.toBe(computeRevisionHash(envelopeB));
  });
});

describe('ProxyRuleSetRevisionsService', () => {
  let service: ProxyRuleSetRevisionsService;

  const mockPipelineSchemasService = {
    getById: jest.fn(),
  };

  beforeEach(async () => {
    mockDb.__reset();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyRuleSetRevisionsService,
        { provide: PipelineSchemasService, useValue: mockPipelineSchemasService },
      ],
    }).compile();

    service = module.get<ProxyRuleSetRevisionsService>(ProxyRuleSetRevisionsService);
  });

  describe('capture', () => {
    it('dedupes when the newest revision has the same content hash', async () => {
      const ruleSet = createRuleSet();
      const rules = [createRule()];
      const hash = expectedHashFor(ruleSet, rules);

      // Only slot consumed: the "newest revision" lookup.
      mockDb.__setResults([[{ id: 'rev-existing', contentHash: hash }]]);

      await service.capture({ ruleSet, rules, trigger: 'rule_edit' });

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('inserts a new revision when the content differs from the newest', async () => {
      const ruleSet = createRuleSet();
      const rules = [createRule()];

      mockDb.__setResults([
        [], // newest lookup: none yet
        [{ id: 'rev-new' }], // insert
        [{ id: 'rev-new' }], // prune candidates (only 1 row, no pruning)
      ]);

      await service.capture({ ruleSet, rules, trigger: 'rule_edit', userId: 'user-1' });

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      const [insertedValues] = mockDb.values.mock.calls[0];
      expect(insertedValues).toMatchObject({
        ruleSetId: 'rule-set-1',
        trigger: 'rule_edit',
        createdBy: 'user-1',
      });
      expect(typeof insertedValues.contentHash).toBe('string');
      expect(insertedValues.contentHash).toHaveLength(64);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('prunes revisions beyond REVISION_CAP after inserting', async () => {
      const ruleSet = createRuleSet();
      const rules = [createRule()];

      const pruneRows = Array.from({ length: REVISION_CAP + 1 }, (_, i) => ({ id: `rev-${i}` }));

      mockDb.__setResults([
        [], // newest lookup: none yet
        [{ id: 'rev-new' }], // insert
        pruneRows, // prune candidates: 21 rows, newest first
      ]);

      await service.capture({ ruleSet, rules, trigger: 'sync' });

      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });

    it('does not prune when revision count is at or under the cap', async () => {
      const ruleSet = createRuleSet();
      const rules = [createRule()];

      const pruneRows = Array.from({ length: REVISION_CAP }, (_, i) => ({ id: `rev-${i}` }));

      mockDb.__setResults([[], [{ id: 'rev-new' }], pruneRows]);

      await service.capture({ ruleSet, rules, trigger: 'sync' });

      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('swallows DB errors: logs a warning and does not throw', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const ruleSet = createRuleSet();
      const rules = [createRule()];

      mockDb.__setResults([new Error('connection reset')]);

      await expect(
        service.capture({ ruleSet, rules, trigger: 'rule_edit' }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('captureIfUnrevisioned', () => {
    it('no-ops when the rule set already has a revision', async () => {
      const ruleSet = createRuleSet();
      const rules = [createRule()];
      const captureSpy = jest.spyOn(service, 'capture');

      mockDb.__setResults([[{ id: 'rev-existing' }]]);

      await service.captureIfUnrevisioned({ ruleSet, rules });

      expect(captureSpy).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('no-ops when there are no rules, without querying the DB', async () => {
      const ruleSet = createRuleSet();
      const captureSpy = jest.spyOn(service, 'capture');

      await service.captureIfUnrevisioned({ ruleSet, rules: [] });

      expect(captureSpy).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('captures with trigger "backfill" when the set has rules and zero revisions', async () => {
      const ruleSet = createRuleSet();
      const rules = [createRule()];
      const captureSpy = jest.spyOn(service, 'capture');

      mockDb.__setResults([
        [], // existence check: none
        [], // capture's own newest lookup: none
        [{ id: 'rev-new' }], // insert
        [{ id: 'rev-new' }], // prune candidates
      ]);

      await service.captureIfUnrevisioned({ ruleSet, rules });

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ruleSet, rules, trigger: 'backfill' }),
      );
    });
  });

  describe('listRevisions', () => {
    it('returns revisions newest first', async () => {
      const newer = {
        id: 'rev-2',
        ruleSetId: 'rule-set-1',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      };
      const older = {
        id: 'rev-1',
        ruleSetId: 'rule-set-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      // The DB layer is responsible for the actual sort (orderBy desc); the
      // mock simply returns rows in the order the service should hand back.
      mockDb.__setResults([[newer, older]]);

      const result = await service.listRevisions('rule-set-1');

      expect(result.map((r) => r.id)).toEqual(['rev-2', 'rev-1']);
    });
  });

  describe('getRevision', () => {
    it('returns null for a revision belonging to another rule set', async () => {
      // where(ruleSetId = X AND id = Y) matches nothing when the revision
      // belongs to a different rule set.
      mockDb.__setResults([[]]);

      const result = await service.getRevision('rule-set-other', 'rev-1');

      expect(result).toBeNull();
    });

    it('returns the revision when it belongs to the given rule set', async () => {
      const row = { id: 'rev-1', ruleSetId: 'rule-set-1' };
      mockDb.__setResults([[row]]);

      const result = await service.getRevision('rule-set-1', 'rev-1');

      expect(result).toEqual(row);
    });
  });
});
