import { createCacheRuleParameters, CacheRulesTools } from './cache-rules.tools';

describe('create_cache_rule MCP tool', () => {
  describe('parameters schema', () => {
    it('accepts and preserves a cacheability override (the field the MCP framework forwards)', () => {
      const parsed = createCacheRuleParameters.parse({
        projectId: 'p1',
        pathPattern: 'api/uploads/content/**',
        cacheability: 'private',
        browserMaxAge: 0,
      });
      // The framework strips any field not declared in the schema before it
      // reaches the service, so this must round-trip for `private` to take effect.
      expect(parsed.cacheability).toBe('private');
    });

    it('allows public and null, and omitting it', () => {
      expect(
        createCacheRuleParameters.parse({
          projectId: 'p1',
          pathPattern: '*.js',
          cacheability: 'public',
        }).cacheability,
      ).toBe('public');
      expect(
        createCacheRuleParameters.parse({
          projectId: 'p1',
          pathPattern: '*.js',
          cacheability: null,
        }).cacheability,
      ).toBeNull();
      expect(
        createCacheRuleParameters.parse({ projectId: 'p1', pathPattern: '*.js' }).cacheability,
      ).toBeUndefined();
    });

    it('rejects an invalid cacheability value', () => {
      expect(() =>
        createCacheRuleParameters.parse({
          projectId: 'p1',
          pathPattern: '*.js',
          cacheability: 'sometimes',
        }),
      ).toThrow();
    });
  });

  describe('createRule', () => {
    it('forwards cacheability through to the cache-rules service', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'r1', cacheability: 'private' });
      const tools = new CacheRulesTools({ create } as any, {} as any);
      // getUserContext reads auth from the request; stub a resolved user.
      const request = { user: { id: 'u1', role: 'admin', apiKeyProjectId: null } } as any;
      jest
        .spyOn(
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('../helpers/user-context.helper'),
          'getUserContext',
        )
        .mockResolvedValue({ id: 'u1', role: 'admin', apiKeyProjectId: null });

      await tools.createRule(
        {
          projectId: 'p1',
          pathPattern: 'api/uploads/content/**',
          cacheability: 'private',
          browserMaxAge: 0,
        } as any,
        {} as any,
        request,
      );

      expect(create).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ cacheability: 'private', browserMaxAge: 0 }),
        'u1',
        'admin',
        null,
      );
    });
  });
});
