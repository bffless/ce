import { coerceFieldsToSchema } from './field-coercion.util';
import { SchemaField } from '../../db/schema/pipeline-schemas.schema';

const fields: SchemaField[] = [
  { name: 'createdMs', type: 'number', required: false },
  { name: 'read', type: 'boolean', required: false },
  { name: 'title', type: 'string', required: false },
  { name: 'meta', type: 'json', required: false },
];

describe('coerceFieldsToSchema', () => {
  describe('number fields', () => {
    it('passes numbers through unchanged', () => {
      const { data, errors } = coerceFieldsToSchema({ createdMs: 1704067200000 }, fields);
      expect(errors).toEqual({});
      expect(data.createdMs).toBe(1704067200000);
    });

    it('coerces numeric strings to numbers', () => {
      const { data, errors } = coerceFieldsToSchema({ createdMs: '42.5' }, fields);
      expect(errors).toEqual({});
      expect(data.createdMs).toBe(42.5);
    });

    it('coerces ISO date strings to epoch milliseconds (the now() case)', () => {
      const { data, errors } = coerceFieldsToSchema(
        { createdMs: '2024-01-01T00:00:00.000Z' },
        fields,
      );
      expect(errors).toEqual({});
      expect(data.createdMs).toBe(1704067200000);
    });

    it('rejects non-numeric, non-date strings', () => {
      const { errors } = coerceFieldsToSchema({ createdMs: 'not-a-number' }, fields);
      expect(errors.createdMs).toContain('number');
    });

    it('rejects booleans', () => {
      const { errors } = coerceFieldsToSchema({ createdMs: true }, fields);
      expect(errors.createdMs).toContain('number');
    });
  });

  describe('boolean fields', () => {
    it('passes booleans through unchanged', () => {
      const { data, errors } = coerceFieldsToSchema({ read: false }, fields);
      expect(errors).toEqual({});
      expect(data.read).toBe(false);
    });

    it('coerces "true"/"false" strings', () => {
      expect(coerceFieldsToSchema({ read: 'true' }, fields).data.read).toBe(true);
      expect(coerceFieldsToSchema({ read: 'false' }, fields).data.read).toBe(false);
    });

    it('rejects other values', () => {
      const { errors } = coerceFieldsToSchema({ read: 'yes' }, fields);
      expect(errors.read).toContain('boolean');
    });
  });

  it('leaves null and undefined values alone (required checks live elsewhere)', () => {
    const { data, errors } = coerceFieldsToSchema({ createdMs: null, read: undefined }, fields);
    expect(errors).toEqual({});
    expect(data.createdMs).toBeNull();
    expect(data.read).toBeUndefined();
  });

  it('leaves string/json fields and undeclared fields untouched', () => {
    const input = { title: '2024-01-01', meta: { a: 1 }, extra: '42' };
    const { data, errors } = coerceFieldsToSchema(input, fields);
    expect(errors).toEqual({});
    expect(data).toEqual(input);
  });

  it('no-ops when the schema has no field list', () => {
    const { data, errors } = coerceFieldsToSchema({ createdMs: 'junk' }, undefined);
    expect(errors).toEqual({});
    expect(data.createdMs).toBe('junk');
  });

  it('does not mutate the input object', () => {
    const input = { createdMs: '2024-01-01T00:00:00.000Z' };
    coerceFieldsToSchema(input, fields);
    expect(input.createdMs).toBe('2024-01-01T00:00:00.000Z');
  });
});
