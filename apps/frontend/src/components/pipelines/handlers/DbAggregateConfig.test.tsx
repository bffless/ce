import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DbAggregateConfig } from './DbAggregateConfig';

vi.mock('./SchemaPicker', () => ({ SchemaPicker: () => null }));
vi.mock('./SchemaFieldPicker', () => ({
  SchemaFieldPicker: ({ value }: { value: string }) => <div data-testid="field">{value}</div>,
}));

describe('DbAggregateConfig in operator', () => {
  it('hydrates an array in-filter as comma-joined text and round-trips to an array', () => {
    const onChange = vi.fn();
    render(
      <DbAggregateConfig
        projectId="p1"
        config={{ schemaId: 's1', operation: 'count', filters: { feedId: { op: 'in', value: ['a', 'b'] } } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue('a, b')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Expression, or comma-separated list')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { feedId: { op: 'in', value: ['a', 'b'] } } }),
    );
  });

  it('keeps an expression in-value as a string', () => {
    const onChange = vi.fn();
    render(
      <DbAggregateConfig
        projectId="p1"
        config={{ schemaId: 's1', operation: 'count', filters: { feedId: { op: 'in', value: 'steps.prep.urls' } } }}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { feedId: { op: 'in', value: 'steps.prep.urls' } } }),
    );
  });

  it('uses the plain Expression placeholder for non-in operators', () => {
    render(
      <DbAggregateConfig
        projectId="p1"
        config={{ schemaId: 's1', operation: 'count', filters: { title: { op: 'eq', value: 'hi' } } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText('Expression')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Expression, or comma-separated list'),
    ).not.toBeInTheDocument();
  });
});
