import {
  compareSchemaFields,
  planFieldAdoption,
  type ComparableSchemaField,
} from './schema-sync.util';
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
  /** bffless/ce#721 — the only shape the sync will ever write onto a live schema. */
  describe('planFieldAdoption', () => {
    const live: SchemaField[] = [
      { name: 'id', type: 'string', required: true },
      { name: 'status', type: 'string', required: false, default: 'queued' },
    ];

    it('is additive for new optional fields: live fields kept as-is, new ones appended', () => {
      const plan = planFieldAdoption(
        [
          { name: 'unattended', type: 'boolean', required: false },
          { name: 'status', type: 'string' }, // absent required == false, order irrelevant
          { name: 'id', type: 'string', required: true },
          { name: 'note', type: 'text', default: '' },
        ],
        live,
      );
      expect(plan.additive).toBe(true);
      expect(plan.added).toEqual(['unattended', 'note']);
      expect(plan.merged).toEqual([
        ...live,
        { name: 'unattended', type: 'boolean', required: false },
        { name: 'note', type: 'text', required: false, default: '' },
      ]);
    });

    it('is not additive when the lists already match (nothing to adopt)', () => {
      expect(planFieldAdoption(live, live)).toEqual({ additive: false, added: [], merged: [] });
    });

    it.each([
      [
        'a live field is missing from the payload',
        [{ name: 'id', type: 'string', required: true }],
      ],
      [
        'a field is retyped',
        [...live.map((f) => (f.name === 'status' ? { ...f, type: 'text' as const } : f))],
      ],
      [
        'an optional field becomes required',
        [...live.map((f) => (f.name === 'status' ? { ...f, required: true } : f))],
      ],
      [
        'a required field becomes optional',
        [...live.map((f) => (f.name === 'id' ? { ...f, required: false } : f))],
      ],
      [
        'a NEW field is required',
        [...live, { name: 'unattended', type: 'boolean' as const, required: true }],
      ],
      [
        'a mix of an additive and a destructive change',
        [
          { name: 'id', type: 'string' as const, required: true },
          { name: 'unattended', type: 'boolean' as const },
        ],
      ],
    ])('is not additive when %s', (_label, incoming) => {
      expect(planFieldAdoption(incoming as ComparableSchemaField[], live)).toEqual({
        additive: false,
        added: [],
        merged: [],
      });
    });

    it('ignores `default` differences on existing fields (not part of schema identity)', () => {
      const plan = planFieldAdoption(
        [
          { name: 'id', type: 'string', required: true },
          { name: 'status', type: 'string', required: false, default: 'other' },
          { name: 'unattended', type: 'boolean' },
        ],
        live,
      );
      expect(plan.additive).toBe(true);
      // The live entry (with ITS default) is what survives.
      expect(plan.merged[1]).toEqual(live[1]);
    });
  });
});
