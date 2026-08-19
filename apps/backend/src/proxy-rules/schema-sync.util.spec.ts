import { compareSchemaFields, type ComparableSchemaField } from './schema-sync.util';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';

describe('schema-sync.util', () => {
  describe('compareSchemaFields', () => {
    const existing: SchemaField[] = [
      { name: 'body', type: 'text', required: true },
      { name: 'score', type: 'string', required: false },
    ];

    it('matches identical field lists', () => {
      expect(compareSchemaFields(existing, existing)).toEqual({ match: true, mismatches: [] });
    });

    it('matches identical fields regardless of order', () => {
      const reordered: SchemaField[] = [
        { name: 'score', type: 'string', required: false },
        { name: 'body', type: 'text', required: true },
      ];
      expect(compareSchemaFields(reordered, existing)).toEqual({ match: true, mismatches: [] });
    });

    it('treats an absent required as false (bundled exports may omit it)', () => {
      const incoming: ComparableSchemaField[] = [
        { name: 'body', type: 'text', required: true },
        { name: 'score', type: 'string' }, // required omitted ≡ false
      ];
      expect(compareSchemaFields(incoming, existing)).toEqual({ match: true, mismatches: [] });
    });

    it('reports a field only present in the incoming definition', () => {
      const incoming: SchemaField[] = [
        ...existing,
        { name: 'extra', type: 'number', required: false },
      ];
      const result = compareSchemaFields(incoming, existing);
      expect(result.match).toBe(false);
      expect(result.mismatches).toEqual(['field "extra" is only in the incoming definition']);
    });

    it('reports a field only present in the existing schema', () => {
      const incoming: SchemaField[] = [{ name: 'body', type: 'text', required: true }];
      const result = compareSchemaFields(incoming, existing);
      expect(result.match).toBe(false);
      expect(result.mismatches).toEqual(['field "score" is only in the existing schema']);
    });

    it('reports a type difference on a common field', () => {
      const incoming: SchemaField[] = [
        { name: 'body', type: 'text', required: true },
        { name: 'score', type: 'number', required: false },
      ];
      const result = compareSchemaFields(incoming, existing);
      expect(result.match).toBe(false);
      expect(result.mismatches).toEqual([
        'field "score": type number (incoming) vs string (existing)',
      ]);
    });

    it('reports a required difference on a common field', () => {
      const incoming: SchemaField[] = [
        { name: 'body', type: 'text', required: false },
        { name: 'score', type: 'string', required: false },
      ];
      const result = compareSchemaFields(incoming, existing);
      expect(result.match).toBe(false);
      expect(result.mismatches).toEqual([
        'field "body": required false (incoming) vs true (existing)',
      ]);
    });

    it('reports both type and required differences on the same field', () => {
      const incoming: SchemaField[] = [
        { name: 'body', type: 'string', required: false },
        { name: 'score', type: 'string', required: false },
      ];
      const result = compareSchemaFields(incoming, existing);
      expect(result.match).toBe(false);
      expect(result.mismatches).toEqual([
        'field "body": type string (incoming) vs text (existing)',
        'field "body": required false (incoming) vs true (existing)',
      ]);
    });

    it('collects every mismatch across a batch of differences', () => {
      const incoming: SchemaField[] = [
        { name: 'body', type: 'json', required: true },
        { name: 'added', type: 'boolean', required: false },
      ];
      const result = compareSchemaFields(incoming, existing);
      expect(result.match).toBe(false);
      expect(result.mismatches).toEqual([
        'field "body": type json (incoming) vs text (existing)',
        'field "added" is only in the incoming definition',
        'field "score" is only in the existing schema',
      ]);
    });

    it('matches two empty field lists', () => {
      expect(compareSchemaFields([], [])).toEqual({ match: true, mismatches: [] });
    });
  });
});
