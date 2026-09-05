import { describe, it, expect } from 'vitest';
import workflow from './__fixtures__/workflow.json';
import { isFlatObjectSchema, schemaToRows, rowsToSchema, emptyFlatSchema } from './input-schema';

const tools = (workflow as { tools: { name: string; inputSchema: Record<string, unknown> }[] })
  .tools;

describe('isFlatObjectSchema', () => {
  it('accepts every tool schema the workflow server ships', () => {
    for (const t of tools) expect(isFlatObjectSchema(t.inputSchema), t.name).toBe(true);
  });

  it('accepts an empty schema', () => {
    expect(isFlatObjectSchema({})).toBe(true);
    expect(isFlatObjectSchema({ type: 'object' })).toBe(true);
  });

  it('refuses what the builder cannot show', () => {
    expect(isFlatObjectSchema({ type: 'string' })).toBe(false);
    expect(
      isFlatObjectSchema({
        type: 'object',
        properties: { a: { type: 'object', properties: { b: { type: 'string' } } } },
      }),
    ).toBe(false);
    expect(
      isFlatObjectSchema({ type: 'object', properties: { a: { oneOf: [{ type: 'string' }] } } }),
    ).toBe(false);
    expect(
      isFlatObjectSchema({ type: 'object', properties: { a: { type: ['string', 'null'] } } }),
    ).toBe(false);
    expect(
      isFlatObjectSchema({ type: 'object', properties: { a: { type: 'string', pattern: '^x' } } }),
    ).toBe(false);
    expect(
      isFlatObjectSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['b'],
      }),
    ).toBe(false);
    expect(
      isFlatObjectSchema({
        type: 'object',
        properties: { a: { type: 'array', items: { type: 'string', enum: ['x'] } } },
      }),
    ).toBe(false);
  });
});

describe('schemaToRows / rowsToSchema', () => {
  it('round-trips every shipped tool schema (required compared as a set)', () => {
    const sortRequired = (s: Record<string, unknown>) => ({
      ...s,
      required: [...((s.required as string[] | undefined) ?? [])].sort(),
    });
    for (const t of tools)
      expect(sortRequired(rowsToSchema(schemaToRows(t.inputSchema))), t.name).toEqual(
        sortRequired(t.inputSchema),
      );
  });

  it('keeps property order and marks required rows', () => {
    const flat = schemaToRows({
      type: 'object',
      required: ['b'],
      properties: {
        a: { type: 'integer', minimum: 1, maximum: 5, description: 'A' },
        b: { type: 'string', enum: ['x', 'y'] },
        c: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: false,
    });
    expect(flat.additionalProperties).toBe(false);
    expect(flat.rows.map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(flat.rows[0]).toEqual({
      name: 'a',
      type: 'integer',
      required: false,
      minimum: 1,
      maximum: 5,
      description: 'A',
    });
    expect(flat.rows[1]).toEqual({ name: 'b', type: 'string', required: true, enum: ['x', 'y'] });
    expect(flat.rows[2]).toEqual({
      name: 'c',
      type: 'array',
      required: false,
      items: { type: 'object', additionalProperties: true },
    });
  });

  it('writes required in row order and omits blank rows', () => {
    const schema = rowsToSchema({
      additionalProperties: true,
      rows: [
        { name: 'z', type: 'string', required: true },
        { name: '', type: 'string', required: true },
        { name: 'y', type: 'boolean', required: true, description: '' },
      ],
    });
    expect(schema).toEqual({
      type: 'object',
      required: ['z', 'y'],
      properties: { z: { type: 'string' }, y: { type: 'boolean' } },
      additionalProperties: true,
    });
  });

  it('emptyFlatSchema is a closed object with no rows', () => {
    expect(rowsToSchema(emptyFlatSchema())).toEqual({
      type: 'object',
      required: [],
      properties: {},
      additionalProperties: false,
    });
  });
});
