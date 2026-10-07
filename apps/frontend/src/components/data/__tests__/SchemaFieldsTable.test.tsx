import { render, screen } from '@testing-library/react';
import { SchemaFieldsTable } from '../SchemaFieldsTable';
import type { SchemaField } from '@/services/pipelineSchemasApi';
import { isIndexableFieldType } from '@/services/pipelineSchemasApi';

/** The schema's field list shows which fields are indexed (bffless/ce#821). */
describe('SchemaFieldsTable', () => {
  const fields: SchemaField[] = [
    { name: 'runId', type: 'string', required: true, indexed: true },
    { name: 'status', type: 'string', required: false },
    { name: 'notes', type: 'text', required: false },
  ];

  it('marks an indexed field and leaves the others blank', () => {
    render(<SchemaFieldsTable fields={fields} />);
    expect(screen.getByRole('columnheader', { name: 'Indexed' })).toBeInTheDocument();
    expect(screen.getAllByText('Indexed')).toHaveLength(2); // the header and runId's badge
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('runId');
    expect(rows[0]).toHaveTextContent('Indexed');
    expect(rows[1]).not.toHaveTextContent('Indexed');
  });

  it('text and json are the types an index does not apply to', () => {
    expect(
      ['string', 'number', 'boolean', 'email', 'datetime'].every((t) =>
        isIndexableFieldType(t as SchemaField['type']),
      ),
    ).toBe(true);
    expect(isIndexableFieldType('text')).toBe(false);
    expect(isIndexableFieldType('json')).toBe(false);
  });
});
