import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/services/proxyRulesApi', () => ({
  useGetRuleSetRulesQuery: () => ({ data: undefined, isLoading: false }),
}));

const { McpToolList } = await import('./McpToolList');
const { emptyTool, normalize } = await import('./model');
const workflow = (await import('./__fixtures__/workflow.json')).default;
type McpTool = ReturnType<typeof emptyTool>;

/** Holds the tools in state so sequential edits accumulate, as they do under the real parent. */
function Harness({
  initial,
  spy,
  uris = [],
}: {
  initial: McpTool[];
  spy: (t: McpTool[]) => void;
  uris?: string[];
}) {
  const [tools, setTools] = useState(initial);
  return (
    <McpToolList
      tools={tools}
      staticResourceUris={uris}
      problems={[]}
      onChange={(t) => {
        setTools(t);
        spy(t);
      }}
    />
  );
}

const twoTools = normalize({
  serverInfo: { name: 's', version: '1' },
  tools: [
    {
      name: 'workflow.list',
      description: 'List',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      rule: { path: '/api/list', method: 'POST' },
    },
    {
      name: 'workflow.submitStep',
      description: 'Submit',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      visibility: ['app'],
      _meta: { ui: { resourceUri: 'ui://x/step.html' } },
      rule: { path: '/api/submit', method: 'POST' },
    },
  ],
}).tools;

describe('McpToolList', () => {
  it('shows one collapsed card per tool with its method, path and badges', () => {
    render(
      <McpToolList tools={twoTools} staticResourceUris={[]} onChange={() => {}} problems={[]} />,
    );
    const first = screen.getByTestId('mcp-tool-0');
    expect(within(first).getByText('workflow.list')).toBeInTheDocument();
    expect(within(first).getByText('POST /api/list')).toBeInTheDocument();
    expect(within(first).getByText('read-only')).toBeInTheDocument();
    const second = screen.getByTestId('mcp-tool-1');
    expect(within(second).getByText('app-only')).toBeInTheDocument();
    expect(within(second).getByText('UI')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tool name')).not.toBeInTheDocument();
  });

  it('adds a tool expanded with the empty defaults', () => {
    const onChange = vi.fn();
    render(
      <McpToolList tools={twoTools} staticResourceUris={[]} onChange={onChange} problems={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add tool/i }));
    expect(onChange).toHaveBeenCalledWith([...twoTools, emptyTool()]);
  });

  it('expands a card and edits the tool name, description, path and hints', () => {
    const onChange = vi.fn();
    render(<Harness initial={twoTools} spy={onChange} uris={['ui://x/step.html']} />);
    fireEvent.click(
      within(screen.getByTestId('mcp-tool-0')).getByRole('button', {
        name: /^expand workflow\.list/i,
      }),
    );
    fireEvent.change(screen.getByLabelText('Tool name'), { target: { value: 'workflow.ls' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: 'workflow.ls' }),
      twoTools[1],
    ]);
    fireEvent.click(screen.getByRole('switch', { name: /destructive/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        name: 'workflow.ls',
        annotations: { readOnlyHint: true, destructiveHint: true },
      }),
      twoTools[1],
    ]);
    fireEvent.click(screen.getByRole('switch', { name: /read-only/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ annotations: { destructiveHint: true } }),
      twoTools[1],
    ]);
    fireEvent.change(screen.getByLabelText('UI resource'), {
      target: { value: 'ui://x/step.html' },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ _meta: { ui: { resourceUri: 'ui://x/step.html' } } }),
      twoTools[1],
    ]);
    fireEvent.change(screen.getByLabelText('UI resource'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ _meta: {} }),
      twoTools[1],
    ]);
  });

  it('duplicates, reorders and deletes tools', () => {
    const onChange = vi.fn();
    render(
      <McpToolList tools={twoTools} staticResourceUris={[]} onChange={onChange} problems={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate workflow.list' }));
    expect(onChange).toHaveBeenLastCalledWith([
      twoTools[0],
      { ...twoTools[0], name: 'workflow.list-copy' },
      twoTools[1],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Move workflow.submitStep up' }));
    expect(onChange).toHaveBeenLastCalledWith([twoTools[1], twoTools[0]]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete workflow.list' }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onChange).toHaveBeenLastCalledWith([twoTools[1]]);
  });

  it('flags a card that has a problem', () => {
    render(
      <McpToolList
        tools={twoTools}
        staticResourceUris={[]}
        onChange={() => {}}
        problems={[
          {
            path: ['tools', 1, 'rule', 'path'],
            message: 'tool workflow.submitStep: rule.path must start with /',
          },
        ]}
      />,
    );
    expect(
      within(screen.getByTestId('mcp-tool-1')).getByLabelText(/1 problem/),
    ).toBeInTheDocument();
  });

  it('renders the shipped workflow server without blowing up', () => {
    render(
      <McpToolList
        tools={normalize(workflow).tools}
        staticResourceUris={[]}
        onChange={() => {}}
        problems={[]}
      />,
    );
    expect(screen.getAllByTestId(/mcp-tool-\d+/)).toHaveLength(15);
  });
});
