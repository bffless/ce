/**
 * CLI-equivalence drift guard for the server export endpoint (Task 2, #448).
 *
 * Imports the CLI canonicalizer (`packages/cli/src/format/canonical.ts`) — the
 * export-format ground truth — DIRECTLY from source and asserts that
 * `ProxyRuleSetsService.exportRuleSet()` output is accepted byte-identically by
 * it. No golden fixture to regenerate: if either side drifts (a key dropped
 * from the server serializer, a key added to the CLI's RULE_KEY_ORDER, changed
 * null-stripping semantics, …) this suite fails immediately.
 *
 * The cross-package TS import works because backend Jest maps relative
 * `./x.js` ESM specifiers back to their TS sources (`moduleNameMapper` in
 * apps/backend/package.json) and ts-jest transforms everything outside
 * node_modules. This is a test-only import — the backend has NO runtime
 * dependency on packages/cli (see export-format.util.ts, which duplicates the
 * constants for runtime use).
 *
 * The fixture below is a kitchen-sink rule set covering every RULE_KEY_ORDER
 * key (asserted below, so a 19th key can't be added without extending it):
 * `methods` (the field #448 dropped), pipeline rules with schema refs in step
 * configs, header `add` secrets, falsy-but-present values (false/0/''), and
 * nested nulls inside a step config (which must survive verbatim).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRulesService } from './proxy-rules.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import {
  RULE_KEY_ORDER as BACKEND_RULE_KEY_ORDER,
  ENVELOPE_KEY_ORDER as BACKEND_ENVELOPE_KEY_ORDER,
} from './export-format.util';
import {
  canonicalizeExport,
  exportsEquivalent,
  stringifyExport,
} from '../../../../packages/cli/src/format/canonical';
import {
  RULE_KEY_ORDER as CLI_RULE_KEY_ORDER,
  ENVELOPE_KEY_ORDER as CLI_ENVELOPE_KEY_ORDER,
} from '../../../../packages/cli/src/format/types';
import type { RuleSetExport as CliRuleSetExport } from '../../../../packages/cli/src/format/types';

// Mock the db client - using factory function for hoisting
jest.mock('../db/client', () => {
  const mockResults: { data: unknown[] }[] = [];
  let callIdx = 0;

  const chainable = {
    select: jest.fn(() => chainable),
    from: jest.fn(() => chainable),
    where: jest.fn(() => chainable),
    limit: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [];
      callIdx++;
      return Promise.resolve(result);
    }),
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
};

// ==================== Kitchen-sink fixture ====================

const ruleSetRow = {
  id: 'rule-set-1',
  projectId: 'project-1',
  name: 'kitchen-sink',
  description: 'Covers every exportable rule field',
  environment: 'production',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const serverManaged = {
  ruleSetId: 'rule-set-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

/** DB rows as getRulesByRuleSetId returns them (decrypted headerConfig). */
const dbRules = [
  {
    ...serverManaged,
    id: 'rule-1',
    pathPattern: '/api/external/*',
    method: null,
    methods: ['GET', 'POST'], // ← the field #448 dropped
    targetUrl: 'https://api.example.com/v1',
    stripPrefix: false, // non-default false
    order: 0,
    timeout: 5000,
    preserveHost: true,
    forwardCookies: true,
    headerConfig: {
      forward: ['authorization', 'accept'],
      strip: ['cookie'],
      add: { 'X-Api-Key': 'sk_live_super_secret', Authorization: 'Bearer live-token' },
    },
    authTransform: { type: 'cookie-to-bearer', cookieName: 'sAccessToken' },
    internalRewrite: false,
    proxyType: 'external_proxy',
    emailHandlerConfig: null,
    pipelineConfig: null,
    isEnabled: true,
    debugEnabled: true,
    description: 'external proxy with everything set',
  },
  {
    ...serverManaged,
    id: 'rule-2',
    pathPattern: '/api/comments',
    method: 'GET',
    methods: null,
    targetUrl: 'http://internal/pipeline',
    stripPrefix: true,
    order: 1,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: false,
    proxyType: 'pipeline',
    emailHandlerConfig: null,
    pipelineConfig: {
      name: 'list-comments',
      description: 'query the comments table',
      steps: [
        {
          id: 'step-1',
          name: 'query',
          handlerType: 'data_query',
          config: {
            schemaId: 'schema-comments', // schema ref → bundled
            limit: 0, // falsy 0 survives
            includeDeleted: false, // falsy false survives
            cursor: '', // falsy '' survives
            nested: { value: null }, // nested null inside step config survives verbatim
          },
          isEnabled: true,
        },
      ],
      postSteps: [
        {
          name: 'persist',
          handlerType: 'ai',
          config: { persistMessagesSchemaId: 'schema-messages' }, // second ref key flavor
        },
      ],
      validators: [{ type: 'auth_required' }],
    },
    isEnabled: true,
    debugEnabled: false,
    description: null,
  },
  {
    ...serverManaged,
    id: 'rule-3',
    pathPattern: '/legacy/*',
    method: 'POST',
    methods: null,
    targetUrl: '/public/myorg/myrepo/alias/production',
    stripPrefix: true,
    order: 2,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: true,
    proxyType: 'internal_rewrite',
    emailHandlerConfig: null,
    pipelineConfig: null,
    isEnabled: false, // non-default false
    debugEnabled: false,
    description: '', // empty string is a value, not an absence
  },
  {
    ...serverManaged,
    id: 'rule-4',
    pathPattern: '/api/contact',
    method: 'POST',
    methods: null,
    targetUrl: 'http://internal/email',
    stripPrefix: true,
    order: 3,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: false,
    proxyType: 'email_form_handler',
    emailHandlerConfig: {
      destinationEmail: 'ops@example.com',
      subjectTemplate: 'New contact: {{name}}',
      rateLimitPerHour: 0,
    },
    pipelineConfig: null,
    isEnabled: true,
    debugEnabled: false,
    description: 'contact form',
  },
];

const schemaRows: Record<string, unknown> = {
  'schema-comments': {
    id: 'schema-comments',
    projectId: 'project-1',
    name: 'comments',
    fields: [
      { name: 'body', type: 'string', required: true },
      { name: 'score', type: 'number', required: false },
    ],
  },
  'schema-messages': {
    id: 'schema-messages',
    projectId: 'project-1',
    name: 'messages',
    fields: [{ name: 'content', type: 'string', required: true }],
  },
};

/**
 * The EXPECTED envelope, written out by hand as the independent statement of
 * what those DB rows mean on the wire. If the server serializer drops or
 * renames any field, the comparison against this literal fails.
 */
const expectedEnvelope: CliRuleSetExport = {
  version: 2,
  exportedAt: 'REPLACED_PER_TEST',
  kind: 'bffless-proxy-rule-set',
  ruleSet: {
    name: 'kitchen-sink',
    description: 'Covers every exportable rule field',
    environment: 'production',
  },
  rules: [
    {
      pathPattern: '/api/external/*',
      methods: ['GET', 'POST'],
      targetUrl: 'https://api.example.com/v1',
      stripPrefix: false,
      order: 0,
      timeout: 5000,
      preserveHost: true,
      forwardCookies: true,
      headerConfig: {
        forward: ['authorization', 'accept'],
        strip: ['cookie'],
        add: { 'X-Api-Key': '', Authorization: '' }, // secrets blanked
      },
      authTransform: { type: 'cookie-to-bearer', cookieName: 'sAccessToken' },
      internalRewrite: false,
      proxyType: 'external_proxy',
      isEnabled: true,
      debugEnabled: true,
      description: 'external proxy with everything set',
    },
    {
      pathPattern: '/api/comments',
      method: 'GET',
      targetUrl: 'http://internal/pipeline',
      stripPrefix: true,
      order: 1,
      timeout: 30000,
      preserveHost: false,
      forwardCookies: false,
      internalRewrite: false,
      proxyType: 'pipeline',
      pipelineConfig: {
        name: 'list-comments',
        description: 'query the comments table',
        steps: [
          {
            id: 'step-1',
            name: 'query',
            handlerType: 'data_query',
            config: {
              schemaId: 'schema-comments',
              limit: 0,
              includeDeleted: false,
              cursor: '',
              nested: { value: null },
            },
            isEnabled: true,
          },
        ],
        postSteps: [
          {
            name: 'persist',
            handlerType: 'ai',
            config: { persistMessagesSchemaId: 'schema-messages' },
          },
        ],
        validators: [{ type: 'auth_required' }],
      },
      isEnabled: true,
      debugEnabled: false,
    },
    {
      pathPattern: '/legacy/*',
      method: 'POST',
      targetUrl: '/public/myorg/myrepo/alias/production',
      stripPrefix: true,
      order: 2,
      timeout: 30000,
      preserveHost: false,
      forwardCookies: false,
      internalRewrite: true,
      proxyType: 'internal_rewrite',
      isEnabled: false,
      debugEnabled: false,
      description: '',
    },
    {
      pathPattern: '/api/contact',
      method: 'POST',
      targetUrl: 'http://internal/email',
      stripPrefix: true,
      order: 3,
      timeout: 30000,
      preserveHost: false,
      forwardCookies: false,
      internalRewrite: false,
      proxyType: 'email_form_handler',
      emailHandlerConfig: {
        destinationEmail: 'ops@example.com',
        subjectTemplate: 'New contact: {{name}}',
        rateLimitPerHour: 0,
      },
      isEnabled: true,
      debugEnabled: false,
      description: 'contact form',
    },
  ],
  schemas: [
    {
      id: 'schema-comments',
      name: 'comments',
      fields: [
        { name: 'body', type: 'string', required: true },
        { name: 'score', type: 'number', required: false },
      ],
    },
    {
      id: 'schema-messages',
      name: 'messages',
      fields: [{ name: 'content', type: 'string', required: true }],
    },
  ],
};

describe('server export ↔ CLI canonicalizer equivalence (#448 drift guard)', () => {
  let service: ProxyRuleSetsService;
  let rulesServiceMock: { getRulesByRuleSetId: jest.Mock };

  beforeEach(async () => {
    mockDb.__reset();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyRuleSetsService,
        {
          provide: PermissionsService,
          useValue: { enforceApiKeyProjectScope: jest.fn(), requireProjectAccess: jest.fn() },
        },
        {
          provide: ProxyRulesService,
          useValue: (rulesServiceMock = {
            getRulesByRuleSetId: jest.fn().mockResolvedValue(dbRules),
          }),
        },
        { provide: NginxRegenerationService, useValue: {} },
        {
          provide: PipelineSchemasService,
          useValue: {
            getById: jest.fn((id: string) => Promise.resolve(schemaRows[id] ?? null)),
          },
        },
      ],
    }).compile();

    service = module.get<ProxyRuleSetsService>(ProxyRuleSetsService);
    mockDb.__setResults([[ruleSetRow]]);
  });

  it('backend key-order constants are byte-identical to the CLI ground truth', () => {
    expect([...BACKEND_RULE_KEY_ORDER]).toEqual([...CLI_RULE_KEY_ORDER]);
    expect([...BACKEND_ENVELOPE_KEY_ORDER]).toEqual([...CLI_ENVELOPE_KEY_ORDER]);
  });

  it('the fixture exercises every RULE_KEY_ORDER key (extend it when a key is added)', () => {
    const covered = new Set(expectedEnvelope.rules.flatMap((r) => Object.keys(r)));
    for (const key of CLI_RULE_KEY_ORDER) {
      expect(covered).toContain(key);
    }
  });

  it('exportRuleSet output is accepted byte-identically by the CLI canonicalizer', async () => {
    const serverExport = (await service.exportRuleSet('rule-set-1')) as unknown as CliRuleSetExport;

    // canonicalizeExport throws on any key outside the CLI contract, so this
    // also proves the server emits no unknown keys.
    const expected = { ...expectedEnvelope, exportedAt: serverExport.exportedAt };
    expect(stringifyExport(serverExport)).toBe(stringifyExport(expected));

    // The server export is ALREADY canonical — the CLI canonicalizer is a
    // byte-level no-op on it (key order, null stripping, rule sort all match).
    // The RAW stringification must equal the canonicalized one (comparing two
    // canonicalizeExport calls would be a tautology).
    expect(JSON.stringify(serverExport, null, 2) + '\n').toBe(stringifyExport(serverExport));
  });

  it('stays byte-canonical when the DB hands back rules in non-canonical order', async () => {
    // Reversed rows simulate an insertion-order/tie-break-free DB read; the
    // envelope must still come out CLI-sorted ((order, pathPattern, method) for
    // rules, name for schemas) so raw stringification equals stringifyExport.
    rulesServiceMock.getRulesByRuleSetId.mockResolvedValue([...dbRules].reverse());
    const serverExport = (await service.exportRuleSet('rule-set-1')) as unknown as CliRuleSetExport;

    expect(JSON.stringify(serverExport, null, 2) + '\n').toBe(stringifyExport(serverExport));
    const expected = { ...expectedEnvelope, exportedAt: serverExport.exportedAt };
    expect(stringifyExport(serverExport)).toBe(stringifyExport(expected));
  });

  it('is semantically equivalent under the CLI diff contract (exportsEquivalent)', async () => {
    const serverExport = (await service.exportRuleSet('rule-set-1')) as unknown as CliRuleSetExport;

    const { equal, diffs } = exportsEquivalent(serverExport, expectedEnvelope);
    expect(diffs).toEqual([]);
    expect(equal).toBe(true);
  });

  it('would catch a dropped field (the #448 failure mode)', async () => {
    const serverExport = (await service.exportRuleSet('rule-set-1')) as unknown as CliRuleSetExport;

    // Simulate the #448 bug: an exporter that forgets `methods`
    const mutilated: CliRuleSetExport = {
      ...serverExport,
      rules: serverExport.rules.map((r) => {
        const clone: Record<string, unknown> = { ...r };
        delete clone.methods;
        return clone as unknown as (typeof serverExport.rules)[number];
      }),
    };

    const { equal, diffs } = exportsEquivalent(mutilated, expectedEnvelope);
    expect(equal).toBe(false);
    expect(diffs.join('\n')).toContain('methods');
  });
});
