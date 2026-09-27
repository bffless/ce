import { ProxyMiddleware } from './proxy.middleware';
import { ProxyRulesService, mergeRuleSetRules } from './proxy-rules.service';
import { ProxyRule } from '../db/schema/proxy-rules.schema';

jest.mock('../db/client', () => ({ db: {} }));

/**
 * The edge's rule cache (#813): single-flight reloads, expired-entry pruning,
 * and multi-set results composed from the single-set entries instead of held
 * as a second copy.
 */
describe('ProxyMiddleware rule cache (#813)', () => {
  const TTL = 10000;
  let now: number;
  let getEffectiveRulesForRuleSet: jest.Mock;
  let getEffectiveRulesForMultipleRuleSets: jest.Mock;
  let middleware: ProxyMiddleware;
  let cache: Map<string, { rules: ProxyRule[]; expiry: number }>;

  const rule = (ruleSetId: string, id: string, overrides: Partial<ProxyRule> = {}): ProxyRule =>
    ({
      id,
      ruleSetId,
      pathPattern: `/api/${id}`,
      method: null,
      methods: null,
      order: 0,
      isEnabled: true,
      ...overrides,
    }) as ProxyRule;

  const rulesBySet: Record<string, ProxyRule[]> = {
    a: [rule('a', 'a1', { order: 0 }), rule('a', 'shared', { order: 1, pathPattern: '/api/x' })],
    b: [rule('b', 'b-shared', { order: 0, pathPattern: '/api/x' }), rule('b', 'b2', { order: 1 })],
    c: [rule('c', 'c1')],
  };

  const getMulti = (ids: string[]): Promise<ProxyRule[]> =>
    (middleware as any).getCachedRulesMulti(ids);

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    getEffectiveRulesForRuleSet = jest.fn(async (id: string) => rulesBySet[id] ?? []);
    getEffectiveRulesForMultipleRuleSets = jest.fn();

    middleware = new ProxyMiddleware(
      {
        getEffectiveRulesForRuleSet,
        getEffectiveRulesForMultipleRuleSets,
      } as unknown as ProxyRulesService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    cache = (middleware as any).ruleCache;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('single-flight', () => {
    it('N concurrent misses for one rule set make one getEffectiveRulesForRuleSet call', async () => {
      let resolveLoad!: (rules: ProxyRule[]) => void;
      getEffectiveRulesForRuleSet.mockImplementationOnce(
        () => new Promise<ProxyRule[]>((resolve) => (resolveLoad = resolve)),
      );

      const results = Array.from({ length: 10 }, () => getMulti(['a']));
      resolveLoad(rulesBySet.a);
      const settled = await Promise.all(results);

      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(1);
      for (const rules of settled) {
        expect(rules).toBe(settled[0]);
      }
    });

    it('concurrent multi-set misses share the per-set reloads', async () => {
      await Promise.all(Array.from({ length: 5 }, () => getMulti(['a', 'b'])));

      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(2);
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledWith('a');
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledWith('b');
      expect(getEffectiveRulesForMultipleRuleSets).not.toHaveBeenCalled();
    });

    it('a failed reload reaches every waiter, is not cached, and the next miss retries', async () => {
      getEffectiveRulesForRuleSet.mockRejectedValueOnce(new Error('db down'));

      const results = await Promise.allSettled([getMulti(['a']), getMulti(['a'])]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(1);
      expect(cache.has('ruleset:a')).toBe(false);

      await expect(getMulti(['a'])).resolves.toBe(rulesBySet.a);
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(2);
    });

    it('keeps the TTL: a hit within 10 s does not reload, a request after it does', async () => {
      await getMulti(['a']);
      now += TTL - 1;
      await getMulti(['a']);
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(1);

      now += 1;
      await getMulti(['a']);
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(2);
    });
  });

  describe('expiry pruning', () => {
    it('drops expired entries for other keys when a new entry is written', async () => {
      await getMulti(['a']);
      await getMulti(['a', 'b']);
      expect([...cache.keys()].sort()).toEqual(['ruleset:a', 'ruleset:b', 'rulesets:a,b']);

      now += TTL;
      await getMulti(['c']);

      expect([...cache.keys()]).toEqual(['ruleset:c']);
    });

    it('keeps entries that have not expired', async () => {
      await getMulti(['a']);
      now += TTL / 2;
      await getMulti(['c']);

      expect([...cache.keys()].sort()).toEqual(['ruleset:a', 'ruleset:c']);
    });
  });

  describe('multi-set', () => {
    it('matches getEffectiveRulesForMultipleRuleSets ordering and dedupe (higher-priority set wins)', async () => {
      const rules = await getMulti(['b', 'a']);

      expect(rules.map((r) => r.id)).toEqual(['b-shared', 'b2', 'a1']);
      expect(rules).toEqual(mergeRuleSetRules(['b', 'a'], [...rulesBySet.a, ...rulesBySet.b]));
    });

    it('holds the same rule objects as the single-set entries, not copies', async () => {
      const multi = await getMulti(['a', 'b']);
      const single = await getMulti(['a']);

      expect(multi[0]).toBe(single[0]);
      expect(getEffectiveRulesForRuleSet).toHaveBeenCalledTimes(2);
    });

    it('expires with the earliest of its parts, so it never outlives a single-set entry', async () => {
      await getMulti(['a']);
      now += 4000;
      await getMulti(['a', 'b']);

      expect(cache.get('rulesets:a,b')!.expiry).toBe(cache.get('ruleset:a')!.expiry);

      now += TTL - 4000;
      const updated = [rule('a', 'a-new')];
      getEffectiveRulesForRuleSet.mockImplementation(async (id: string) =>
        id === 'a' ? updated : (rulesBySet[id] ?? []),
      );

      const rules = await getMulti(['a', 'b']);
      expect(rules[0]).toBe(updated[0]);
    });
  });
});
