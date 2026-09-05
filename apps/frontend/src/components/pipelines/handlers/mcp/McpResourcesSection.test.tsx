import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/services/proxyRulesApi', () => ({
  useGetRuleSetRulesQuery: () => ({ data: undefined, isLoading: false }),
}));

const { McpResourcesSection } = await import('./McpResourcesSection');
const { normalize } = await import('./model');
const workflow = (await import('./__fixtures__/workflow.json')).default;
type Resources = ReturnType<typeof normalize>['resources'];

function Harness({ initial, spy }: { initial: Resources; spy: (r: Resources) => void }) {
  const [resources, setResources] = useState(initial);
  return (
    <McpResourcesSection
      resources={resources}
      problems={[]}
      onChange={(r) => {
        setResources(r);
        spy(r);
      }}
    />
  );
}

describe('McpResourcesSection', () => {
  it('shows the shipped static resource, template, list rule and csp', () => {
    render(<Harness initial={normalize(workflow).resources} spy={() => {}} />);
    expect(
      screen.getByDisplayValue('ui://bffless/workflow/step-view.e2235b30.html'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('ui://bffless/{impl}/{path+}')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enumerate resources/i })).toBeChecked();
    expect(screen.getByDisplayValue('/api/workflow/mcp-resources')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove $storage' })).toHaveLength(2);
  });

  it('adds a static resource and edits it', () => {
    const spy = vi.fn();
    render(<Harness initial={normalize({}).resources} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /add static resource/i }));
    const card = screen.getByTestId('mcp-static-0');
    fireEvent.change(within(card).getByLabelText('URI'), { target: { value: 'ui://a/b.html' } });
    fireEvent.change(within(card).getByLabelText('Name'), { target: { value: 'B' } });
    fireEvent.change(within(card).getByLabelText('Answered by rule'), {
      target: { value: '/api/b' },
    });
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        static: [{ uri: 'ui://a/b.html', name: 'B', rule: { path: '/api/b' } }],
      }),
    );
  });

  it('adds a template and lists the variables it declares', () => {
    const spy = vi.fn();
    render(<Harness initial={normalize({}).resources} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /add template/i }));
    const card = screen.getByTestId('mcp-template-0');
    fireEvent.change(within(card).getByLabelText('URI template'), {
      target: { value: 'ui://x/{impl}/{path+}' },
    });
    fireEvent.change(within(card).getByLabelText('Answered by rule'), {
      target: { value: '/w/{impl}/{other}' },
    });
    expect(within(card).getByText(/variables: impl, path/i)).toBeInTheDocument();
    expect(within(card).getByText(/other.*not declared/i)).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        templates: [
          { uriTemplate: 'ui://x/{impl}/{path+}', name: '', rule: { path: '/w/{impl}/{other}' } },
        ],
      }),
    );
  });

  it('toggles the list rule and edits csp chips', () => {
    const spy = vi.fn();
    render(<Harness initial={normalize({}).resources} spy={spy} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /enumerate resources/i }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ list: { rule: { path: '', method: 'GET' } } }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /enumerate resources/i }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ list: undefined }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add $app' })[0]);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ csp: { connectDomains: ['$app'], resourceDomains: [] } }),
    );
  });

  it('removes a resource', () => {
    const spy = vi.fn();
    render(<Harness initial={normalize(workflow).resources} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Workflow step view' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ static: [] }));
  });
});
