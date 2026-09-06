import { describe, expect, it } from 'vitest';
import {
  PROTECTED_RESOURCE_PATH,
  deriveScopes,
  discoveryFor,
  findMcpRule,
  type DiscoveryRule,
} from './discovery';

const rule = (over: Partial<DiscoveryRule> & { id: string; pathPattern: string }): DiscoveryRule =>
  ({
    method: null,
    methods: null,
    isEnabled: true,
    pipelineConfig: null,
    ...over,
  }) as DiscoveryRule;

const authRequired = (requiredScopes: string[]) => ({
  type: 'auth_required',
  config: { requiredScopes },
});

const mcp = rule({
  id: 'mcp',
  pathPattern: '/api/mcp',
  methods: ['GET', 'POST'],
  pipelineConfig: {
    steps: [
      {
        handlerType: 'mcp_handler',
        config: {
          serverInfo: { name: 'Workflow', version: '1' },
          tools: [
            { name: 'list', rule: { path: '/api/tools/list', method: 'POST' } },
            { name: 'sign', rule: { path: '/api/tools/sign', method: 'GET' } },
            { name: 'lost', rule: { path: '/api/tools/nowhere' } },
          ],
        },
      },
    ],
  },
});
const list = rule({
  id: 'list',
  pathPattern: '/api/tools/list',
  method: 'POST',
  pipelineConfig: { validators: [authRequired(['workflow:read'])], steps: [] },
});
const sign = rule({
  id: 'sign',
  pathPattern: '/api/tools/*',
  method: 'GET',
  pipelineConfig: {
    validators: [authRequired(['workflow:files', 'workflow:read'])],
    steps: [],
  },
});
const prm = (config: Record<string, unknown>) =>
  rule({
    id: 'prm',
    pathPattern: `${PROTECTED_RESOURCE_PATH}*`,
    method: 'GET',
    pipelineConfig: { steps: [{ handlerType: 'oauth_protected_resource', config }] },
  });
const shipped = rule({
  id: 'shipped',
  pathPattern: `${PROTECTED_RESOURCE_PATH}*`,
  method: 'GET',
  pipelineConfig: {
    steps: [
      { handlerType: 'function_handler', config: {} },
      { handlerType: 'response_handler', config: {} },
    ],
  },
});
const tools = findMcpRule([mcp], '/api/mcp')!.tools;

describe('discovery', () => {
  it('finds the mcp_handler rule at a path and reads its server name and tool refs', () => {
    const found = findMcpRule([list, mcp], '/api/mcp');
    expect(found?.rule.id).toBe('mcp');
    expect(found?.serverName).toBe('Workflow');
    expect(found?.tools.map((t) => t.rule.path)).toEqual([
      '/api/tools/list',
      '/api/tools/sign',
      '/api/tools/nowhere',
    ]);
    expect(findMcpRule([list], '/api/mcp')).toBeUndefined();
    expect(findMcpRule([mcp], '')).toBeUndefined();
  });

  it('derives the union of sibling requiredScopes in first-appearance order, resolving each sibling with the tool method', () => {
    expect(deriveScopes([mcp, list, sign], tools)).toEqual(['workflow:read', 'workflow:files']);
    expect(deriveScopes([mcp], tools)).toEqual([]);
  });

  it('reports the handler rule that names this MCP rule, with declared or derived scopes', () => {
    expect(
      discoveryFor([mcp, list, sign, prm({ resource: '/api/mcp', scopes: ['workflow:read'] })], {
        ruleId: 'mcp',
        tools,
      }),
    ).toEqual({
      kind: 'handler',
      rulePath: `${PROTECTED_RESOURCE_PATH}*`,
      scopes: { mode: 'declared', values: ['workflow:read'] },
    });
    expect(
      discoveryFor([mcp, list, sign, prm({ resource: '/api/mcp' })], { ruleId: 'mcp', tools }),
    ).toEqual({
      kind: 'handler',
      rulePath: `${PROTECTED_RESOURCE_PATH}*`,
      scopes: { mode: 'derived', values: ['workflow:read', 'workflow:files'] },
    });
  });

  it('ignores a handler rule that names another resource, unless the edited rule is unsaved', () => {
    const other = prm({ resource: '/api/other' });
    expect(discoveryFor([mcp, other], { ruleId: 'mcp', tools })).toEqual({
      kind: 'custom',
      rulePath: `${PROTECTED_RESOURCE_PATH}*`,
    });
    expect(discoveryFor([mcp, other], { ruleId: undefined, tools })).toMatchObject({
      kind: 'handler',
    });
  });

  it('only counts a handler step that is the whole answer of a well-known rule', () => {
    const elsewhere = rule({
      id: 'elsewhere',
      pathPattern: '/api/reports*',
      pipelineConfig: {
        steps: [{ handlerType: 'oauth_protected_resource', config: { resource: '/api/mcp' } }],
      },
    });
    expect(discoveryFor([mcp, elsewhere], { ruleId: 'mcp', tools })).toEqual({ kind: 'none' });
    const preceded = rule({
      id: 'preceded',
      pathPattern: `${PROTECTED_RESOURCE_PATH}*`,
      pipelineConfig: {
        steps: [
          { handlerType: 'data_query', config: {} },
          { handlerType: 'oauth_protected_resource', config: { resource: '/api/mcp' } },
        ],
      },
    });
    expect(discoveryFor([mcp, preceded], { ruleId: 'mcp', tools })).toEqual({
      kind: 'custom',
      rulePath: `${PROTECTED_RESOURCE_PATH}*`,
    });
  });

  it('reports an app-shipped well-known rule as custom, and nothing as none', () => {
    expect(discoveryFor([mcp, shipped], { ruleId: 'mcp', tools })).toEqual({
      kind: 'custom',
      rulePath: `${PROTECTED_RESOURCE_PATH}*`,
    });
    expect(discoveryFor([mcp, list], { ruleId: 'mcp', tools })).toEqual({ kind: 'none' });
  });
});
