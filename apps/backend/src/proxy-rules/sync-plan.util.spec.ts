import { computeSyncPlan, normalizeSyncRules, LiveSyncRule, SyncRuleInput } from './sync-plan.util';

describe('sync-plan.util', () => {
  /**
   * A live DB row (decrypted) whose portable fields sit exactly on the DB
   * import defaults, plus the server-managed fields the plan must ignore.
   */
  const liveBase: LiveSyncRule = {
    id: 'rule-live-1',
    ruleSetId: 'rs-1',
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
  };

  /** Minimal incoming rule equivalent to liveBase once DB defaults are applied. */
  const incomingBase: SyncRuleInput = {
    pathPattern: '/api/*',
    targetUrl: 'https://api.example.com',
  };

  const live = (overrides: Partial<LiveSyncRule> = {}): LiveSyncRule => ({
    ...liveBase,
    ...overrides,
  });
  const incoming = (overrides: Partial<SyncRuleInput> = {}): SyncRuleInput => ({
    ...incomingBase,
    ...overrides,
  });

  describe('bucketing', () => {
    it('creates every incoming rule when there are no live rules', () => {
      const plan = computeSyncPlan(
        [],
        [incoming(), incoming({ pathPattern: '/other', method: 'POST', timeout: 5000 })],
        { prune: false },
      );

      expect(plan.toCreate).toHaveLength(2);
      expect(plan.toUpdate).toEqual([]);
      expect(plan.unchanged).toEqual([]);
      expect(plan.toDelete).toEqual([]);
      expect(plan.pruneCandidates).toEqual([]);

      expect(plan.toCreate[0]).toMatchObject({ pathPattern: '/api/*', method: null });
      expect(plan.toCreate[1]).toMatchObject({ pathPattern: '/other', method: 'POST' });
    });

    it('applies the DB import defaults to created rules (absent-means-default)', () => {
      const plan = computeSyncPlan([], [{ pathPattern: '/api/*' }], { prune: false });

      expect(plan.toCreate[0].rule).toEqual({
        pathPattern: '/api/*',
        method: null,
        methods: null,
        targetUrl: '',
        stripPrefix: true,
        order: 0, // fallback: index in evaluation order
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
      });
    });

    it('marks live-only rules toDelete when prune is on', () => {
      const plan = computeSyncPlan(
        [live(), live({ pathPattern: '/legacy', method: 'GET' })],
        [],
        { prune: true },
      );

      expect(plan.toDelete).toEqual([
        { pathPattern: '/api/*', method: null },
        { pathPattern: '/legacy', method: 'GET' },
      ]);
      expect(plan.pruneCandidates).toEqual([]);
    });

    it('marks live-only rules pruneCandidates when prune is off', () => {
      const plan = computeSyncPlan(
        [live(), live({ pathPattern: '/legacy', method: 'GET' })],
        [],
        { prune: false },
      );

      expect(plan.pruneCandidates).toEqual([
        { pathPattern: '/api/*', method: null },
        { pathPattern: '/legacy', method: 'GET' },
      ]);
      expect(plan.toDelete).toEqual([]);
    });

    it('reports an identical rule as unchanged', () => {
      const plan = computeSyncPlan([live()], [incoming()], { prune: true });

      expect(plan.unchanged).toEqual([{ pathPattern: '/api/*', method: null }]);
      expect(plan.toCreate).toEqual([]);
      expect(plan.toUpdate).toEqual([]);
      expect(plan.toDelete).toEqual([]);
    });

    it('handles a mixed create/update/unchanged/prune-candidate batch', () => {
      const liveRules = [
        live(), // will be unchanged
        live({ id: 'rule-live-2', pathPattern: '/changed', order: 1 }), // will be updated
        live({ id: 'rule-live-3', pathPattern: '/gone', order: 2 }), // live-only
      ];
      const incomingRules = [
        incoming({ order: 0 }),
        incoming({ pathPattern: '/changed', order: 1, timeout: 60000 }),
        incoming({ pathPattern: '/new', order: 2 }),
      ];

      const plan = computeSyncPlan(liveRules, incomingRules, { prune: false });

      expect(plan.unchanged).toEqual([{ pathPattern: '/api/*', method: null }]);
      expect(plan.toUpdate).toMatchObject([{ pathPattern: '/changed', method: null }]);
      expect(plan.toCreate).toMatchObject([{ pathPattern: '/new', method: null }]);
      expect(plan.pruneCandidates).toEqual([{ pathPattern: '/gone', method: null }]);
      expect(plan.toDelete).toEqual([]);
    });
  });

  describe('match key (pathPattern, method ?? null)', () => {
    it('treats method null and method "GET" on the same path as distinct rules', () => {
      const plan = computeSyncPlan(
        [live({ method: null })],
        [incoming({ method: 'GET' })],
        { prune: false },
      );

      expect(plan.toCreate).toMatchObject([{ pathPattern: '/api/*', method: 'GET' }]);
      expect(plan.pruneCandidates).toEqual([{ pathPattern: '/api/*', method: null }]);
    });

    it('matches same-path rules with different methods independently', () => {
      const plan = computeSyncPlan(
        [live({ method: 'GET' }), live({ id: 'rule-live-2', method: 'POST', order: 1 })],
        [
          incoming({ method: 'GET' }),
          incoming({ method: 'POST', order: 1, timeout: 60000 }),
        ],
        { prune: true },
      );

      expect(plan.unchanged).toEqual([{ pathPattern: '/api/*', method: 'GET' }]);
      expect(plan.toUpdate).toMatchObject([{ pathPattern: '/api/*', method: 'POST' }]);
      expect(plan.toDelete).toEqual([]);
    });
  });

  describe('defaults normalization', () => {
    it.each([
      ['targetUrl empty string', { targetUrl: '' }, { targetUrl: undefined }],
      ['stripPrefix true', { stripPrefix: true }, { stripPrefix: true }],
      ['timeout 30000', { timeout: 30000 }, { timeout: 30000 }],
      ['preserveHost false', { preserveHost: false }, { preserveHost: false }],
      ['forwardCookies false', { forwardCookies: false }, { forwardCookies: false }],
      ['internalRewrite false', { internalRewrite: false }, { internalRewrite: false }],
      ['proxyType external_proxy', { proxyType: 'external_proxy' }, { proxyType: 'external_proxy' }],
      ['isEnabled true', { isEnabled: true }, { isEnabled: true }],
      ['debugEnabled false', { debugEnabled: false }, { debugEnabled: false }],
    ] as Array<[string, Partial<LiveSyncRule>, Partial<SyncRuleInput>]>)(
      'explicit incoming default equals live default: %s',
      (_label, liveOverride, incomingExplicit) => {
        // Explicit default value in the payload...
        const explicit = computeSyncPlan([live(liveOverride)], [incoming(incomingExplicit)], {
          prune: false,
        });
        expect(explicit.unchanged).toHaveLength(1);
        expect(explicit.toUpdate).toEqual([]);

        // ...and the field absent entirely both compare unchanged.
        const absentIncoming = { ...incoming() };
        for (const key of Object.keys(incomingExplicit)) {
          delete (absentIncoming as Record<string, unknown>)[key];
        }
        if ('targetUrl' in incomingExplicit) absentIncoming.targetUrl = undefined;
        const absent = computeSyncPlan([live(liveOverride)], [absentIncoming], { prune: false });
        expect(absent.unchanged).toHaveLength(1);
        expect(absent.toUpdate).toEqual([]);
      },
    );

    it('treats a legacy live row with proxyType null as external_proxy', () => {
      const plan = computeSyncPlan([live({ proxyType: null })], [incoming()], { prune: false });
      expect(plan.unchanged).toHaveLength(1);
    });

    it('treats absent incoming description as equal to live null description', () => {
      const plan = computeSyncPlan([live({ description: null })], [incoming()], { prune: false });
      expect(plan.unchanged).toHaveLength(1);
    });

    it('ignores server-managed fields (id, ruleSetId, timestamps) in the comparison', () => {
      const plan = computeSyncPlan(
        [
          live({
            id: 'totally-different-id',
            ruleSetId: 'another-set',
            createdAt: new Date('1999-12-31T23:59:59Z'),
            updatedAt: new Date('2026-06-06T06:06:06Z'),
          }),
        ],
        [incoming()],
        { prune: false },
      );
      expect(plan.unchanged).toHaveLength(1);
    });

    it('assigns fallback order by import-parity sorted index, not payload position', () => {
      // Import sorts by (order ?? 0) then falls back to the sorted index:
      // B has order 5, A has none -> sorted [A, B] -> A gets order 0.
      const liveRules = [
        live({ order: 0 }),
        live({ id: 'rule-live-2', pathPattern: '/b', order: 5 }),
      ];
      const incomingRules = [
        incoming({ pathPattern: '/b', order: 5 }),
        incoming(), // no order -> fallback 0 -> matches live order 0
      ];

      const plan = computeSyncPlan(liveRules, incomingRules, { prune: false });
      expect(plan.unchanged).toHaveLength(2);
      expect(plan.toUpdate).toEqual([]);
    });
  });

  describe('field changes', () => {
    it.each([
      ['targetUrl', { targetUrl: 'https://other.example.com' }],
      ['order only', { order: 7 }],
      ['methods array', { methods: ['GET', 'HEAD'] }],
      ['timeout', { timeout: 60000 }],
      ['isEnabled', { isEnabled: false }],
      ['authTransform', { authTransform: { type: 'cookie-to-bearer' as const, cookieName: 'sAccessToken' } }],
    ] as Array<[string, Partial<SyncRuleInput>]>)('%s change lands in toUpdate', (_label, override) => {
      const plan = computeSyncPlan([live()], [incoming(override)], { prune: false });
      expect(plan.toUpdate).toHaveLength(1);
      expect(plan.unchanged).toEqual([]);
    });

    it('treats removing a live description as a change', () => {
      const plan = computeSyncPlan(
        [live({ description: 'kept for docs' })],
        [incoming()], // description absent -> null
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('treats a methods change from an array to absent as a change', () => {
      const plan = computeSyncPlan([live({ methods: ['GET'] })], [incoming()], { prune: false });
      expect(plan.toUpdate).toHaveLength(1);
    });
  });

  describe('headerConfig comparison and blank-secret semantics', () => {
    const liveWithSecret = () =>
      live({ headerConfig: { add: { 'X-API-Key': 'sk_live_secret' } } });

    it('blank incoming value compares equal to any live value for that header (decision 1)', () => {
      const plan = computeSyncPlan(
        [liveWithSecret()],
        [incoming({ headerConfig: { add: { 'X-API-Key': '' } } })],
        { prune: false },
      );
      expect(plan.unchanged).toHaveLength(1);
      expect(plan.toUpdate).toEqual([]);
    });

    it('blank incoming value for a header the live rule lacks is a change (header added)', () => {
      const plan = computeSyncPlan(
        [liveWithSecret()],
        [incoming({ headerConfig: { add: { 'X-API-Key': '', 'X-New': '' } } })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('a live header name absent from the incoming add map is a change (removal)', () => {
      const plan = computeSyncPlan(
        [live({ headerConfig: { add: { 'X-API-Key': 'sk_live_secret', 'X-Extra': 'v' } } })],
        [incoming({ headerConfig: { add: { 'X-API-Key': '' } } })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('non-empty incoming values compare normally (equal -> unchanged, different -> update)', () => {
      const equal = computeSyncPlan(
        [liveWithSecret()],
        [incoming({ headerConfig: { add: { 'X-API-Key': 'sk_live_secret' } } })],
        { prune: false },
      );
      expect(equal.unchanged).toHaveLength(1);

      const different = computeSyncPlan(
        [liveWithSecret()],
        [incoming({ headerConfig: { add: { 'X-API-Key': 'sk_live_other' } } })],
        { prune: false },
      );
      expect(different.toUpdate).toHaveLength(1);
    });

    it('forward arrays compare order-sensitively', () => {
      const plan = computeSyncPlan(
        [live({ headerConfig: { forward: ['accept', 'content-type'] } })],
        [incoming({ headerConfig: { forward: ['content-type', 'accept'] } })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('identical forward/strip arrays compare equal', () => {
      const hc = { forward: ['accept'], strip: ['cookie'], add: { 'X-K': 'v' } };
      const plan = computeSyncPlan(
        [live({ headerConfig: hc })],
        [incoming({ headerConfig: { ...hc, add: { 'X-K': '' } } })],
        { prune: false },
      );
      expect(plan.unchanged).toHaveLength(1);
    });

    it('a strip change is a change', () => {
      const plan = computeSyncPlan(
        [live({ headerConfig: { strip: ['cookie'] } })],
        [incoming({ headerConfig: { strip: ['cookie', 'authorization'] } })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('headerConfig null vs an object is a change', () => {
      const plan = computeSyncPlan(
        [live({ headerConfig: null })],
        [incoming({ headerConfig: { add: { 'X-K': 'v' } } })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('tolerates add: null on either side without crashing (null ≡ empty map)', () => {
      // add: null passes DTO validation and is stored verbatim, so live rows can carry it.
      const nullAdd = { add: null } as unknown as { add: Record<string, string> };

      const liveNull = computeSyncPlan(
        [live({ headerConfig: nullAdd })],
        [incoming({ headerConfig: { add: { 'X-K': 'v' } } })],
        { prune: false },
      );
      expect(liveNull.toUpdate).toHaveLength(1);

      const incomingNull = computeSyncPlan(
        [live({ headerConfig: { add: { 'X-K': 'v' } } })],
        [incoming({ headerConfig: nullAdd })],
        { prune: false },
      );
      expect(incomingNull.toUpdate).toHaveLength(1);

      const bothNull = computeSyncPlan(
        [live({ headerConfig: nullAdd })],
        [incoming({ headerConfig: { add: null } as never })],
        { prune: false },
      );
      expect(bothNull.unchanged).toHaveLength(1);
    });

    it('same-size add maps with different header names are a change even when the incoming value is blank', () => {
      const plan = computeSyncPlan(
        [live({ headerConfig: { add: { 'X-Old': 'x' } } })],
        [incoming({ headerConfig: { add: { 'X-New': '' } } })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });
  });

  describe('proxyType/targetUrl inference (CLI parity for elided canonical payloads)', () => {
    const pipelineConfig = () => ({
      name: 'p',
      steps: [{ name: 'q', handlerType: 'data_query', config: { schemaId: 'A' } }],
    });

    it('an elided pipeline rule (no proxyType, no targetUrl) is unchanged against its live form', () => {
      const plan = computeSyncPlan(
        [
          live({
            proxyType: 'pipeline',
            targetUrl: 'http://internal/pipeline',
            pipelineConfig: pipelineConfig(),
          }),
        ],
        [{ pathPattern: '/api/*', pipelineConfig: pipelineConfig() as never }],
        { prune: false },
      );
      expect(plan.unchanged).toHaveLength(1);
      expect(plan.toUpdate).toEqual([]);
    });

    it('toCreate infers pipeline proxyType and the internal pipeline targetUrl', () => {
      const plan = computeSyncPlan(
        [],
        [{ pathPattern: '/api/x', pipelineConfig: pipelineConfig() as never }],
        { prune: false },
      );
      expect(plan.toCreate[0].rule.proxyType).toBe('pipeline');
      expect(plan.toCreate[0].rule.targetUrl).toBe('http://internal/pipeline');
    });

    it('infers email_form_handler from emailHandlerConfig presence', () => {
      const plan = computeSyncPlan(
        [],
        [{ pathPattern: '/api/contact', emailHandlerConfig: { destinationEmail: 'a@b.c' } as never }],
        { prune: false },
      );
      expect(plan.toCreate[0].rule.proxyType).toBe('email_form_handler');
      expect(plan.toCreate[0].rule.targetUrl).toBe('');
    });

    it('an explicit proxyType always wins over inference', () => {
      const plan = computeSyncPlan(
        [],
        [
          {
            pathPattern: '/api/x',
            proxyType: 'external_proxy',
            targetUrl: 'https://api.example.com',
            pipelineConfig: pipelineConfig() as never,
          },
        ],
        { prune: false },
      );
      expect(plan.toCreate[0].rule.proxyType).toBe('external_proxy');
    });
  });

  describe('methods [] ≡ null normalization', () => {
    it('live methods [] compares unchanged against an absent incoming methods', () => {
      const plan = computeSyncPlan([live({ methods: [] })], [incoming()], { prune: false });
      expect(plan.unchanged).toHaveLength(1);
    });

    it('incoming methods [] normalizes to null on created rules', () => {
      const plan = computeSyncPlan([], [incoming({ methods: [] })], { prune: false });
      expect(plan.toCreate[0].rule.methods).toBeNull();
    });
  });

  describe('deep equality of nested config', () => {
    const pipeline = () => ({
      name: 'p',
      steps: [
        {
          name: 'q',
          handlerType: 'data_query',
          config: { schemaId: 'A', pageSize: 10, filter: null },
        },
      ],
    });

    it('is key-order-insensitive for nested objects', () => {
      const reordered = {
        steps: [
          {
            config: { filter: null, pageSize: 10, schemaId: 'A' },
            handlerType: 'data_query',
            name: 'q',
          },
        ],
        name: 'p',
      };
      const plan = computeSyncPlan(
        [live({ proxyType: 'pipeline', pipelineConfig: pipeline() })],
        [incoming({ proxyType: 'pipeline', pipelineConfig: reordered as never })],
        { prune: false },
      );
      expect(plan.unchanged).toHaveLength(1);
    });

    it('is value-exact: a nested null is not the same as an absent key', () => {
      const withoutNull = pipeline();
      delete (withoutNull.steps[0].config as Record<string, unknown>).filter;
      const plan = computeSyncPlan(
        [live({ proxyType: 'pipeline', pipelineConfig: pipeline() })],
        [incoming({ proxyType: 'pipeline', pipelineConfig: withoutNull as never })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });

    it('detects a nested value change inside pipelineConfig', () => {
      const changed = pipeline();
      changed.steps[0].config.pageSize = 25;
      const plan = computeSyncPlan(
        [live({ proxyType: 'pipeline', pipelineConfig: pipeline() })],
        [incoming({ proxyType: 'pipeline', pipelineConfig: changed as never })],
        { prune: false },
      );
      expect(plan.toUpdate).toHaveLength(1);
    });
  });

  describe('duplicate incoming match keys', () => {
    it('throws a clear error naming the duplicate (pathPattern, method)', () => {
      expect(() =>
        computeSyncPlan([], [incoming({ method: 'GET' }), incoming({ method: 'GET' })], {
          prune: false,
        }),
      ).toThrow('Duplicate rule for path pattern "/api/*" and method "GET"');
    });

    it('treats an absent method and an explicit null method as the same key', () => {
      expect(() =>
        computeSyncPlan([], [incoming(), incoming({ method: null })], { prune: false }),
      ).toThrow('Duplicate rule for path pattern "/api/*" and method (any)');
    });

    it('does not throw for the same path with distinct methods', () => {
      expect(() =>
        computeSyncPlan([], [incoming({ method: 'GET' }), incoming({ method: 'POST' })], {
          prune: false,
        }),
      ).not.toThrow();
    });
  });

  describe('plan entry payloads', () => {
    it('toUpdate carries the live rule id and the normalized incoming rule (blanks intact)', () => {
      const plan = computeSyncPlan(
        [live({ headerConfig: { add: { 'X-API-Key': 'sk_live_secret' } } })],
        [incoming({ timeout: 60000, headerConfig: { add: { 'X-API-Key': '' } } })],
        { prune: false },
      );

      expect(plan.toUpdate).toHaveLength(1);
      const entry = plan.toUpdate[0];
      expect(entry.liveId).toBe('rule-live-1');
      expect(entry.rule.timeout).toBe(60000);
      // Blank secret stays blank in the plan; Task 7's executor preserves the live value.
      expect(entry.rule.headerConfig).toEqual({ add: { 'X-API-Key': '' } });
    });

    it('toCreate carries blank add values intact for missingSecrets reporting', () => {
      const plan = computeSyncPlan(
        [],
        [incoming({ headerConfig: { add: { 'X-API-Key': '' } } })],
        { prune: false },
      );
      expect(plan.toCreate[0].rule.headerConfig).toEqual({ add: { 'X-API-Key': '' } });
    });

    it('toUpdate omits liveId when the live row has no id', () => {
      const noId = live({ timeout: 1000 });
      delete (noId as Record<string, unknown>).id;
      const plan = computeSyncPlan([noId], [incoming()], { prune: false });
      expect(plan.toUpdate).toHaveLength(1);
      expect(plan.toUpdate[0].liveId).toBeUndefined();
    });

    it('does not mutate its inputs', () => {
      const liveRules = [live()];
      const incomingRules = [incoming({ order: 3 }), incoming({ pathPattern: '/z' })];
      const liveSnapshot = JSON.parse(JSON.stringify(liveRules));
      const incomingSnapshot = JSON.parse(JSON.stringify(incomingRules));

      computeSyncPlan(liveRules, incomingRules, { prune: true });

      expect(JSON.parse(JSON.stringify(liveRules))).toEqual(liveSnapshot);
      expect(JSON.parse(JSON.stringify(incomingRules))).toEqual(incomingSnapshot);
    });
  });

  describe('normalizeSyncRules', () => {
    it('applies the same defaults and fallback order as computeSyncPlan', () => {
      const rules = [
        incoming({ pathPattern: '/b', order: 5 }),
        incoming({ pathPattern: '/a' }), // no order → fallback index 0 in the (order ?? 0)-sorted list
        incoming({ pathPattern: '/pipe', targetUrl: undefined, pipelineConfig: { name: 'p', steps: [] } }),
      ];

      const normalized = normalizeSyncRules(rules);

      expect(normalized[0]).toMatchObject({ pathPattern: '/b', order: 5 });
      expect(normalized[1]).toMatchObject({
        pathPattern: '/a',
        order: 0,
        stripPrefix: true,
        timeout: 30000,
        proxyType: 'external_proxy',
      });
      // CLI-parity inference, exactly as the plan applies it
      expect(normalized[2]).toMatchObject({
        pathPattern: '/pipe',
        proxyType: 'pipeline',
        targetUrl: 'http://internal/pipeline',
      });
      // Positional: output order mirrors input order, not sorted order
      expect(normalized.map((r) => r.pathPattern)).toEqual(['/b', '/a', '/pipe']);
    });

    it('does not mutate its inputs', () => {
      const rules = [incoming({ pathPattern: '/x' })];
      const snapshot = JSON.parse(JSON.stringify(rules));
      normalizeSyncRules(rules);
      expect(JSON.parse(JSON.stringify(rules))).toEqual(snapshot);
    });
  });
});
