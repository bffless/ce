import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataQueryConfig } from './DataQueryConfig';

// SchemaPicker/SchemaFieldPicker hit data services; stub them to plain inputs so
// this test stays focused on filter value (de)serialization.
vi.mock('./SchemaPicker', () => ({ SchemaPicker: () => null }));
vi.mock('./SchemaFieldPicker', () => ({
  SchemaFieldPicker: ({ value }: { value: string }) => <div data-testid="field">{value}</div>,
}));

describe('DataQueryConfig in operator', () => {
  it('hydrates an array in-filter as a comma-joined value and round-trips it back to an array', () => {
    const onChange = vi.fn();
    render(
      <DataQueryConfig
        projectId="p1"
        config={{ schemaId: 's1', filters: { feedId: { op: 'in', value: ['https://a.com/feed', 'https://b.com/feed'] } } }}
        onChange={onChange}
      />,
    );

    // Displayed as comma-joined text in the value input.
    expect(screen.getByDisplayValue('https://a.com/feed, https://b.com/feed')).toBeInTheDocument();

    // The mount effect emits the config with the value re-serialized to an array.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { feedId: { op: 'in', value: ['https://a.com/feed', 'https://b.com/feed'] } },
      }),
    );
  });

  it('keeps an expression in-value (no comma) as a string', () => {
    const onChange = vi.fn();
    render(
      <DataQueryConfig
        projectId="p1"
        config={{ schemaId: 's1', filters: { feedId: { op: 'in', value: 'steps.prep.urls' } } }}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { feedId: { op: 'in', value: 'steps.prep.urls' } },
      }),
    );
  });
});
