import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpHandlerConfig } from './McpHandlerConfig';
import { summarizeMcpConfig } from './mcp-config-summary';

const config = {
  serverInfo: { name: 'bffless-workflow', version: '1.0.0' },
  tools: [
    { name: 'workflow.list', rule: { path: '/api/workflow/mcp-tools/list', method: 'POST' } },
    { name: 'workflow.status', rule: { path: '/api/workflow/mcp-tools/status', method: 'POST' } },
  ],
  resources: {
    static: [
      {
        uri: 'ui://bffless/workflow/step.html',
        rule: { path: '/api/workflow/mcp-resources/step-view' },
      },
    ],
    templates: [
      { uriTemplate: 'ui://bffless/{impl}/{path+}', rule: { path: '/w/{impl}/{path+}' } },
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

  it('applies a parsed edit on blur and reports one that does not parse without sending it', () => {
    const onChange = vi.fn();
    render(<McpHandlerConfig config={config} onChange={onChange} />);
    const editor = screen.getByLabelText('Configuration (JSON)') as HTMLTextAreaElement;
    expect(editor.value).toContain('"workflow.list"');

    fireEvent.change(editor, { target: { value: '{"serverInfo":{"name":"x"},"tools":[]}' } });
    fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith({ serverInfo: { name: 'x' }, tools: [] });

    fireEvent.change(editor, { target: { value: '{"tools": [' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/);
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: '[1,2]' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert').textContent).toMatch(/must be a JSON object/);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders an empty config without blowing up', () => {
    render(<McpHandlerConfig config={{}} onChange={() => {}} />);
    expect(screen.getByTestId('mcp-summary').textContent).toContain('0 tools');
  });
});
