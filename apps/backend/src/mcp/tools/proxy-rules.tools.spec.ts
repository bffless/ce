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
    const tools = new ProxyRulesTools({ listByProject } as any, {} as any, {} as any, {} as any);

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
    const tools = new ProxyRulesTools({ getById } as any, {} as any, {} as any, {} as any);

    const raw = await tools.getRuleSet({ id: 'rs-1' }, {} as any, request);
    const parsed = JSON.parse(raw);

    expect(getById).toHaveBeenCalledWith('rs-1', null);
    expect(parsed.source).toEqual(source);
  });
});

/**
 * An agent authoring an upload pipeline never sees the admin UI, so the tool
 * result is the only channel that can tell it the schema it just wired up
 * doesn't declare what upload handlers write (bffless/ce#630).
 */
describe('proxy-rule MCP tools upload-schema warnings', () => {
  const request = { user: { id: 'u1', apiKeyProjectId: null } } as any;
  const authService = { getUserById: jest.fn().mockResolvedValue({ id: 'u1', role: 'admin' }) };
  const pipelineConfig = {
    steps: [{ name: 'upload', handlerType: 'register_upload', config: { schemaId: 's1' } }],
  };

  const toolsWith = (warnings: string[], create = jest.fn()) => {
    const rulesService = {
      create: create.mockResolvedValue({ id: 'r1', pipelineConfig }),
      update: jest.fn().mockResolvedValue({ id: 'r1', pipelineConfig }),
    };
    const lint = { lintPipelineConfig: jest.fn().mockResolvedValue(warnings) };
    return {
      tools: new ProxyRulesTools({} as any, rulesService as any, authService as any, lint as any),
      lint,
    };
  };

  it('attaches warnings to create_proxy_rule', async () => {
    const { tools, lint } = toolsWith(['Upload schema "uploads": does not declare storage_path.']);

    const parsed = JSON.parse(await tools.createRule({ ruleSetId: 'rs-1' }, {} as any, request));

    expect(lint.lintPipelineConfig).toHaveBeenCalledWith(pipelineConfig);
    expect(parsed.uploadSchemaWarnings).toEqual([
      'Upload schema "uploads": does not declare storage_path.',
    ]);
    expect(parsed.id).toBe('r1');
  });

  it('attaches warnings to update_proxy_rule', async () => {
    const { tools } = toolsWith(['Upload schema "uploads": does not declare size.']);

    const parsed = JSON.parse(
      await tools.updateRule({ id: 'r1', description: 'x' }, {} as any, request),
    );

    expect(parsed.uploadSchemaWarnings).toHaveLength(1);
  });

  it('omits the key entirely when the schema matches', async () => {
    const { tools } = toolsWith([]);

    const parsed = JSON.parse(await tools.createRule({ ruleSetId: 'rs-1' }, {} as any, request));

    expect(parsed).not.toHaveProperty('uploadSchemaWarnings');
  });
});
