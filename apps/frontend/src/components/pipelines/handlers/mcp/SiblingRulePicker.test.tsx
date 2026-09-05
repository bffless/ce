import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const rulesQuery = vi.fn();
vi.mock('@/services/proxyRulesApi', () => ({
  useGetRuleSetRulesQuery: (id: string, opts?: { skip?: boolean }) => {
    rulesQuery(id, opts);
    if (opts?.skip) return { data: undefined, isLoading: false };
    return {
      data: {
        rules: [
          { id: 'self', pathPattern: '/api/mcp', method: null, methods: null, isEnabled: true },
          {
            id: 'r1',
            pathPattern: '/api/tools/list',
            method: null,
            methods: ['POST'],
            isEnabled: true,
          },
          { id: 'r2', pathPattern: '/w/*', method: 'GET', methods: null, isEnabled: true },
        ],
      },
      isLoading: false,
    };
  },
}));

const { SiblingRulePicker } = await import('./SiblingRulePicker');

describe('SiblingRulePicker', () => {
  it('says which sibling answers the path and method', () => {
    render(
      <SiblingRulePicker
        label="Rule path"
        value="/api/tools/list"
        method="POST"
        ruleSetId="set1"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/answered by/i)).toHaveTextContent('/api/tools/list');
  });

  it('warns when no sibling in the set matches', () => {
    render(
      <SiblingRulePicker
        label="Rule path"
        value="/api/tools/list"
        method="GET"
        ruleSetId="set1"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/no enabled rule in this set/i)).toBeInTheDocument();
  });

  it('lists the set’s rules except the one being edited, and picks one', () => {
    const onChange = vi.fn();
    render(
      <SiblingRulePicker
        label="Rule path"
        value=""
        method="POST"
        ruleSetId="set1"
        excludeRuleId="self"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: /rule path/i }));
    expect(screen.queryByText('/api/mcp')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('/w/*'));
    expect(onChange).toHaveBeenCalledWith('/w/*');
  });

  it('stays a plain text field without a rule set', () => {
    render(<SiblingRulePicker label="Rule path" value="/x" method="POST" onChange={() => {}} />);
    expect(rulesQuery).toHaveBeenLastCalledWith('', { skip: true });
    expect(screen.queryByText(/answered by|no enabled rule/i)).not.toBeInTheDocument();
  });
});
