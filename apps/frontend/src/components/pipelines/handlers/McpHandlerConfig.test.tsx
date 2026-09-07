import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ ruleSetId: 'set-1', ruleId: 'rule-1' }),
}));
const rulesQuery = vi.fn();
let rulesData: { rules: unknown[] } = { rules: [] };
vi.mock('@/services/proxyRulesApi', () => ({
  useGetRuleSetRulesQuery: (id: string, opts?: { skip?: boolean }) => {
    rulesQuery(id, opts);
    return { data: rulesData, isLoading: false };
  },
}));

const { McpHandlerConfig } = await import('./McpHandlerConfig');
const { summarizeMcpConfig } = await import('./mcp-config-summary');
const workflow = (await import('./mcp/__fixtures__/workflow.json')).default;

const config = {
  serverInfo: { name: 'bffless-workflow', version: '1.0.0' },
  tools: [
    {
      name: 'workflow.list',
      description: 'List',
      inputSchema: { type: 'object' },
      rule: { path: '/api/workflow/mcp-tools/list', method: 'POST' },
    },
    {
      name: 'workflow.status',
      description: 'Status',
      inputSchema: { type: 'object' },
      rule: { path: '/api/workflow/mcp-tools/status', method: 'POST' },
    },
  ],
  resources: {
    static: [
      {
        uri: 'ui://bffless/workflow/step.html',
        name: 'Step',
        rule: { path: '/api/workflow/mcp-resources/step-view' },
      },
    ],
    templates: [
      {
        uriTemplate: 'ui://bffless/{impl}/{path+}',
        name: 'island',
        rule: { path: '/w/{impl}/{path+}' },
      },
    ],
  },
};

describe('McpHandlerConfig', () => {
  it('summarizes what the config declares', () => {
    expect(summarizeMcpConfig(config)).toEqual({
      server: 'bffless-workflow',
      tools: ['workflow.list', 'workflow.status'],
      staticResources: 1,
      templates: 1,
    });
    render(<McpHandlerConfig config={config} onChange={() => {}} />);
    expect(screen.getByText(/MCP server: bffless-workflow/)).toBeInTheDocument();
    expect(screen.getByTestId('mcp-summary').textContent).toContain(
      '2 tools (workflow.list, workflow.status)',
    );
    expect(screen.getByTestId('mcp-summary').textContent).toContain('1 static resource');
  });

  it('edits the server name through the form and emits the serialized config', () => {
    const onChange = vi.fn();
    render(<McpHandlerConfig config={config} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'renamed' } });
    expect(onChange).toHaveBeenCalledWith({
      ...config,
      serverInfo: { name: 'renamed', version: '1.0.0' },
    });
  });

  it('opens the Tools tab with one card per tool and passes the rule set to the pickers', async () => {
    render(<McpHandlerConfig config={config} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('tab', { name: /tools/i }));
    expect(screen.getAllByTestId(/mcp-tool-\d+/)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /expand workflow\.list/i }));
    expect(rulesQuery).toHaveBeenCalledWith('set-1', { skip: false });
  });

  it('applies a parsed JSON edit on blur and reports one that does not parse without sending it', async () => {
    const onChange = vi.fn();
    render(<McpHandlerConfig config={config} onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: /json/i }));
    const editor = screen.getByLabelText('Configuration (JSON)') as HTMLTextAreaElement;
    expect(editor.value).toContain('"workflow.list"');

    fireEvent.change(editor, {
      target: { value: '{"serverInfo":{"name":"x","version":"2"},"tools":[]}' },
    });
    fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith({ serverInfo: { name: 'x', version: '2' }, tools: [] });

    fireEvent.change(editor, { target: { value: '{"tools": [' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lists what the run would refuse, whichever tab is open', () => {
    render(
      <McpHandlerConfig
        config={{
          tools: [
            { name: 'a', rule: { path: 'relative' } },
            { name: 'a', rule: { path: '/ok' } },
          ],
        }}
        onChange={() => {}}
      />,
    );
    const summary = screen.getByTestId('mcp-problems');
    expect(summary.textContent).toContain(
      'serverInfo.name and serverInfo.version are required strings',
    );
    expect(summary.textContent).toContain('tool a: rule.path must start with /');
    expect(summary.textContent).toContain('duplicate tool name: a');
  });

  describe('Server tab: where OAuth discovery comes from (#760)', () => {
    const prmRule = (config: Record<string, unknown>) => ({
      id: 'prm',
      pathPattern: '/.well-known/oauth-protected-resource*',
      method: 'GET',
      methods: null,
      isEnabled: true,
      pipelineConfig: { steps: [{ handlerType: 'oauth_protected_resource', config }] },
    });
    const self = {
      id: 'rule-1',
      pathPattern: '/api/workflow/mcp',
      method: null,
      methods: ['GET', 'POST'],
      isEnabled: true,
      pipelineConfig: null,
    };
    const list = {
      id: 'list',
      pathPattern: '/api/workflow/mcp-tools/list',
      method: 'POST',
      methods: null,
      isEnabled: true,
      pipelineConfig: {
        validators: [{ type: 'auth_required', config: { requiredScopes: ['workflow:read'] } }],
        steps: [],
      },
    };

    it('says nothing serves it when the set has no well-known rule', () => {
      rulesData = { rules: [self, list] };
      render(<McpHandlerConfig config={config} onChange={() => {}} />);
      expect(screen.getByTestId('mcp-discovery').textContent).toMatch(
        /No \/\.well-known\/oauth-protected-resource rule in this set/,
      );
    });

    it('shows the derived scopes_supported from the tools’ sibling rules', () => {
      rulesData = { rules: [self, list, prmRule({ resource: '/api/workflow/mcp' })] };
      render(<McpHandlerConfig config={config} onChange={() => {}} />);
      const note = screen.getByTestId('mcp-discovery').textContent ?? '';
      expect(note).toContain('Served by the oauth_protected_resource step');
      expect(note).toContain('scopes_supported — derived: workflow:read');
    });

    it('shows a declared list verbatim', () => {
      rulesData = {
        rules: [self, prmRule({ resource: '/api/workflow/mcp', scopes: ['workflow:run'] })],
      };
      render(<McpHandlerConfig config={config} onChange={() => {}} />);
      expect(screen.getByTestId('mcp-discovery').textContent).toContain(
        'scopes_supported — declared: workflow:run',
      );
    });

    it('names an app-shipped custom rule', () => {
      rulesData = {
        rules: [
          self,
          {
            ...prmRule({}),
            pipelineConfig: { steps: [{ handlerType: 'function_handler', config: {} }] },
          },
        ],
      };
      render(<McpHandlerConfig config={config} onChange={() => {}} />);
      expect(screen.getByTestId('mcp-discovery').textContent).toContain('Served by a custom rule');
      rulesData = { rules: [] };
    });
  });

  it('renders an empty config without blowing up', () => {
    render(<McpHandlerConfig config={{}} onChange={() => {}} />);
    expect(screen.getByTestId('mcp-summary').textContent).toContain('0 tools');
  });

  it('renders the shipped workflow server', () => {
    render(<McpHandlerConfig config={workflow} onChange={() => {}} />);
    expect(screen.getByTestId('mcp-summary').textContent).toContain('15 tools');
    expect(screen.queryByTestId('mcp-problems')).not.toBeInTheDocument();
  });
});
