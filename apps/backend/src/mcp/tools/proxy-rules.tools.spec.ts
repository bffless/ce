import { ProxyRulesTools } from './proxy-rules.tools';

/**
 * The rule-set MCP tools JSON.stringify the service DTOs verbatim, so the
 * git provenance `source` field (written by the rules-as-code sync endpoint)
 * must reach MCP clients on both list and get. These specs guard against a
 * future explicit field mapping silently dropping it (decision 3: expose the
 * field, no extra warning logic).
 */
describe('proxy-rule-set MCP tools source passthrough', () => {
  const source = {
    repo: 'bffless/apps',
    path: 'apps/studio/proxy-rules',
    gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    syncedAt: '2026-07-10T00:00:00.000Z',
    contentHash: 'sha256:deadbeef',
  };

  const request = { user: { apiKeyProjectId: null } } as any;

  it('list_proxy_rule_sets includes source on managed sets and null on unmanaged', async () => {
    const listByProject = jest.fn().mockResolvedValue([
      { id: 'rs-1', projectId: 'p1', name: 'managed', source },
      { id: 'rs-2', projectId: 'p1', name: 'manual', source: null },
    ]);
    const tools = new ProxyRulesTools({ listByProject } as any, {} as any, {} as any);

    const raw = await tools.listRuleSets({ projectId: 'p1' }, {} as any, request);
    const parsed = JSON.parse(raw);

    expect(listByProject).toHaveBeenCalledWith('p1', null);
    expect(parsed[0].source).toEqual(source);
    expect(parsed[1].source).toBeNull();
  });

  it('get_proxy_rule_set includes source', async () => {
    const getById = jest
      .fn()
      .mockResolvedValue({ id: 'rs-1', projectId: 'p1', name: 'managed', source, rules: [] });
    const tools = new ProxyRulesTools({ getById } as any, {} as any, {} as any);

    const raw = await tools.getRuleSet({ id: 'rs-1' }, {} as any, request);
    const parsed = JSON.parse(raw);

    expect(getById).toHaveBeenCalledWith('rs-1', null);
    expect(parsed.source).toEqual(source);
  });
});
