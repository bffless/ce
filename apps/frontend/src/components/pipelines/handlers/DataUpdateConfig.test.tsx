import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataUpdateConfig } from './DataUpdateConfig';

vi.mock('./SchemaPicker', () => ({ SchemaPicker: () => null }));
vi.mock('./SchemaFieldPicker', () => ({
  SchemaFieldPicker: ({ value }: { value: string }) => <div data-testid="field">{value}</div>,
}));

describe('DataUpdateConfig in operator', () => {
  it('hydrates an array in-filter as comma-joined text and round-trips to an array', () => {
    const onChange = vi.fn();
    render(
      <DataUpdateConfig
        projectId="p1"
        config={{
          schemaId: 's1',
          filters: { feedId: { op: 'in', value: ['a', 'b'] } },
          fields: { read: 'true' },
        }}
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
      <DataUpdateConfig
        projectId="p1"
        config={{
          schemaId: 's1',
          filters: { feedId: { op: 'in', value: 'steps.prep.urls' } },
          fields: { read: 'true' },
        }}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { feedId: { op: 'in', value: 'steps.prep.urls' } } }),
    );
  });

  it('uses the plain Expression placeholder for non-in operators', () => {
    render(
      <DataUpdateConfig
        projectId="p1"
        config={{
          schemaId: 's1',
          filters: { title: { op: 'eq', value: 'hi' } },
          fields: { read: 'true' },
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText('Expression')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Expression, or comma-separated list'),
    ).not.toBeInTheDocument();
  });
});
