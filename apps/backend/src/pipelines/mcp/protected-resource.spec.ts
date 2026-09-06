import {
  PROTECTED_RESOURCE_PATH,
  findProtectedResourceConfig,
  protectedResourceSuffix,
  servesProtectedResourceDocument,
  suffixNamesResource,
} from './protected-resource';
import { ProxyRule } from '../../db/schema/proxy-rules.schema';

const rule = (over: Partial<ProxyRule>): ProxyRule =>
  ({
    id: 'r',
    ruleSetId: 's',
    pathPattern: '/x',
    method: null,
    methods: null,
    targetUrl: 'pipeline',
    proxyType: 'pipeline',
    pipelineConfig: null,
    isEnabled: true,
    order: 0,
    bypassVisibility: false,
    ...over,
  }) as ProxyRule;

const prmStep = (config: Record<string, unknown>, isEnabled?: boolean) => ({
  name: 'prm',
  handlerType: 'oauth_protected_resource',
  config,
  ...(isEnabled === undefined ? {} : { isEnabled }),
});

describe('protected-resource helpers', () => {
  describe('servesProtectedResourceDocument', () => {
    it('is true only for a pipeline rule with an enabled oauth_protected_resource step', () => {
      expect(servesProtectedResourceDocument(undefined)).toBe(false);
      expect(servesProtectedResourceDocument(rule({ proxyType: 'external_proxy' }))).toBe(false);
      expect(
        servesProtectedResourceDocument(
          rule({
            pipelineConfig: {
              name: 'app-shipped',
              steps: [
                { name: 'doc', handlerType: 'function_handler', config: {} },
                { name: 'respond', handlerType: 'response_handler', config: {} },
              ],
            },
          }),
        ),
      ).toBe(false);
      expect(
        servesProtectedResourceDocument(
          rule({ pipelineConfig: { name: 'p', steps: [prmStep({ resource: '/api/mcp' })] } }),
        ),
      ).toBe(true);
      expect(
        servesProtectedResourceDocument(
          rule({
            pipelineConfig: { name: 'p', steps: [prmStep({ resource: '/api/mcp' }, false)] },
          }),
        ),
      ).toBe(false);
    });
  });

  describe('findProtectedResourceConfig', () => {
    const a = rule({
      id: 'a',
      pathPattern: `${PROTECTED_RESOURCE_PATH}/api/a`,
      method: 'GET',
      pipelineConfig: { name: 'a', steps: [prmStep({ resource: '/api/a', scopes: ['a:read'] })] },
    });
    const bare = rule({
      id: 'bare',
      pathPattern: `${PROTECTED_RESOURCE_PATH}*`,
      method: 'GET',
      pipelineConfig: { name: 'b', steps: [prmStep({ resource: '/api/b' })] },
    });

    it('prefers the rule at the path-suffixed form, then the bare path', () => {
      expect(findProtectedResourceConfig([a, bare], '/api/a')).toMatchObject({
        resource: '/api/a',
      });
      expect(findProtectedResourceConfig([a, bare], '/api/b')).toMatchObject({
        resource: '/api/b',
      });
      expect(findProtectedResourceConfig([a, bare], '/api/zzz')).toMatchObject({
        resource: '/api/b',
      });
    });

    it('is undefined when the matched /.well-known rule is an app-shipped function, or absent', () => {
      const shipped = rule({
        pathPattern: `${PROTECTED_RESOURCE_PATH}*`,
        pipelineConfig: {
          name: 'shipped',
          steps: [{ name: 'doc', handlerType: 'function_handler', config: {} }],
        },
      });
      expect(findProtectedResourceConfig([shipped], '/api/mcp')).toBeUndefined();
      expect(findProtectedResourceConfig([], '/api/mcp')).toBeUndefined();
    });
  });

  describe('suffix', () => {
    it('reads what follows the well-known path, ignoring a query and a trailing slash', () => {
      expect(protectedResourceSuffix(PROTECTED_RESOURCE_PATH)).toBe('');
      expect(protectedResourceSuffix(`${PROTECTED_RESOURCE_PATH}/`)).toBe('');
      expect(protectedResourceSuffix(`${PROTECTED_RESOURCE_PATH}/api/mcp?x=1`)).toBe('/api/mcp');
      expect(
        protectedResourceSuffix(`/public/o/r/alias/a/dist${PROTECTED_RESOURCE_PATH}/api/mcp/`),
      ).toBe('/api/mcp');
      expect(protectedResourceSuffix('/api/mcp')).toBeUndefined();
    });

    it('accepts the bare path or an exact match of the resource', () => {
      expect(suffixNamesResource('', '/api/mcp')).toBe(true);
      expect(suffixNamesResource(undefined, '/api/mcp')).toBe(true);
      expect(suffixNamesResource('/api/mcp', '/api/mcp/')).toBe(true);
      expect(suffixNamesResource('/api/other', '/api/mcp')).toBe(false);
      expect(suffixNamesResource('/api/mcp/deeper', '/api/mcp')).toBe(false);
    });
  });
});
