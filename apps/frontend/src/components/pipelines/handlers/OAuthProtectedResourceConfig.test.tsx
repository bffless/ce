import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ ruleSetId: 'set-1', ruleId: 'prm' }),
}));
let rulesData: { rules: unknown[] } = { rules: [] };
vi.mock('@/services/proxyRulesApi', () => ({
  useGetRuleSetRulesQuery: () => ({ data: rulesData, isLoading: false }),
}));

const { OAuthProtectedResourceConfig } = await import('./OAuthProtectedResourceConfig');

const rules = [
  {
    id: 'prm',
    pathPattern: '/.well-known/oauth-protected-resource*',
    method: 'GET',
    methods: null,
    isEnabled: true,
    pipelineConfig: {
      steps: [{ handlerType: 'oauth_protected_resource', config: { resource: '/api/mcp' } }],
    },
  },
  {
    id: 'mcp',
    pathPattern: '/api/mcp',
    method: null,
    methods: ['GET', 'POST'],
    isEnabled: true,
    pipelineConfig: {
      steps: [
        {
          handlerType: 'mcp_handler',
          config: {
            serverInfo: { name: 'Workflow', version: '1' },
            tools: [{ name: 'list', rule: { path: '/api/tools/list' } }],
          },
        },
      ],
    },
  },
  {
    id: 'list',
    pathPattern: '/api/tools/list',
    method: 'POST',
    methods: null,
    isEnabled: true,
    pipelineConfig: {
      validators: [{ type: 'auth_required', config: { requiredScopes: ['workflow:read'] } }],
      steps: [],
    },
  },
];

describe('OAuthProtectedResourceConfig', () => {
  it('shows the MCP rule it found and the scopes it will derive, and emits a declared list on switch', () => {
    rulesData = { rules };
    const onChange = vi.fn();
    render(<OAuthProtectedResourceConfig config={{ resource: '/api/mcp' }} onChange={onChange} />);
    expect(screen.getByTestId('prm-mcp-hint').textContent).toContain(
      'Found in this set: /api/mcp (Workflow)',
    );
    expect(screen.getByTestId('prm-derived').textContent).toContain('derived: workflow:read');
    expect(screen.queryByTestId('prm-path-warning')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/resource name/i)).toHaveAttribute('placeholder', 'Workflow');

    fireEvent.click(screen.getByLabelText(/^declare$/i));
    expect(onChange).toHaveBeenCalledWith({ resource: '/api/mcp', scopes: ['workflow:read'] });
  });

  it('warns when no mcp_handler answers the resource, and drops `scopes` when switching back to derived', () => {
    rulesData = { rules: rules.filter((r) => r.id !== 'mcp') };
    const onChange = vi.fn();
    render(
      <OAuthProtectedResourceConfig
        config={{ resource: '/api/mcp', scopes: ['a:b'], resourceName: 'X' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('prm-mcp-hint').textContent).toContain('No mcp_handler rule');
    expect(screen.getByLabelText(/^scopes$/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/derive from the mcp server/i));
    expect(onChange).toHaveBeenCalledWith({ resource: '/api/mcp', resourceName: 'X' });
  });

  it('flags a rule whose own path is not the well-known one', () => {
    rulesData = {
      rules: [{ ...rules[0], pathPattern: '/api/discovery' }, ...rules.slice(1)],
    };
    render(<OAuthProtectedResourceConfig config={{ resource: '/api/mcp' }} onChange={() => {}} />);
    expect(screen.getByTestId('prm-path-warning').textContent).toContain('/api/discovery');
  });

  it('edits the resource path', () => {
    rulesData = { rules: [] };
    const onChange = vi.fn();
    render(<OAuthProtectedResourceConfig config={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/resource path/i), { target: { value: '/api/x' } });
    expect(onChange).toHaveBeenCalledWith({ resource: '/api/x' });
  });
});
