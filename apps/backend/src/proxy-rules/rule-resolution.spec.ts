import {
  findMatchingRule,
  matchesPattern,
  resolveEffectiveRuleSetIds,
  resolveProjectDefaultRuleSetIds,
  resolveRuleSetIdsForAlias,
} from './rule-resolution';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn(),
  },
}));
const mockDb = jest.requireMock('../db/client').db;

const rule = (over: Record<string, unknown> = {}) =>
  ({
    id: 'r',
    pathPattern: '/api/*',
    method: null,
    methods: null,
    isEnabled: true,
    ...over,
  }) as never;

describe('rule-resolution', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('matchesPattern (lifted verbatim from the middleware)', () => {
    it('matches exact, trailing, leading and middle wildcards', () => {
      expect(matchesPattern('/api/users', '/api/users')).toBe(true);
      expect(matchesPattern('/api/*', '/api/users')).toBe(true);
      expect(matchesPattern('/api/*', '/api/')).toBe(true);
      expect(matchesPattern('/api/*', '/api')).toBe(false);
      expect(matchesPattern('*.json', '/data/x.json')).toBe(true);
      expect(matchesPattern('/api/*/users', '/api/v2/users')).toBe(true);
      expect(matchesPattern('/api/x', '/api/y')).toBe(false);
      expect(matchesPattern('/api/a.b', '/api/aXb')).toBe(false);
    });
  });

  describe('findMatchingRule', () => {
    it('skips disabled rules, honours methods[] then method, first match wins', () => {
      const rules = [
        rule({ id: 'off', isEnabled: false }),
        rule({ id: 'post-only', method: 'POST' }),
        rule({ id: 'get-head', methods: ['GET', 'HEAD'] }),
        rule({ id: 'any' }),
      ];
      expect(findMatchingRule(rules, '/api/x', 'GET')).toMatchObject({ id: 'get-head' });
      expect(findMatchingRule(rules, '/api/x', 'post')).toMatchObject({ id: 'post-only' });
      expect(findMatchingRule(rules, '/api/x', 'DELETE')).toMatchObject({ id: 'any' });
      expect(findMatchingRule(rules, '/other', 'GET')).toBeNull();
    });
  });

  describe('resolveRuleSetIdsForAlias / resolveProjectDefaultRuleSetIds / resolveEffectiveRuleSetIds', () => {
    it('prefers join rows in order, then the legacy column, then nothing', async () => {
      mockDb.orderBy.mockResolvedValueOnce([{ proxyRuleSetId: 'b' }, { proxyRuleSetId: 'a' }]);
      expect(await resolveRuleSetIdsForAlias('alias-1', 'legacy')).toEqual(['b', 'a']);
      mockDb.orderBy.mockResolvedValueOnce([]);
      expect(await resolveRuleSetIdsForAlias('alias-1', 'legacy')).toEqual(['legacy']);
      mockDb.orderBy.mockResolvedValueOnce([]);
      expect(await resolveProjectDefaultRuleSetIds('p', null)).toEqual([]);
    });

    it('falls back from the alias to the project defaults exactly as the middleware does', async () => {
      mockDb.orderBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ proxyRuleSetId: 'default' }]);
      expect(
        await resolveEffectiveRuleSetIds(
          { id: 'p', defaultProxyRuleSetId: null },
          { id: 'alias-1', proxyRuleSetId: null },
        ),
      ).toEqual(['default']);
      mockDb.orderBy.mockResolvedValueOnce([{ proxyRuleSetId: 'mine' }]);
      expect(
        await resolveEffectiveRuleSetIds(
          { id: 'p', defaultProxyRuleSetId: 'x' },
          { id: 'alias-1', proxyRuleSetId: null },
        ),
      ).toEqual(['mine']);
      mockDb.orderBy.mockResolvedValueOnce([]);
      expect(
        await resolveEffectiveRuleSetIds(
          { id: 'p', defaultProxyRuleSetId: 'legacy-default' },
          null,
        ),
      ).toEqual(['legacy-default']);
    });
  });
});
