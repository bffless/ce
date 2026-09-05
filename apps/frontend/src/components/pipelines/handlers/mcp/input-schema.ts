/**
 * A tool's `inputSchema` as the property table edits it: a flat JSON-Schema
 * object whose properties are scalars, or opaque objects/arrays. Anything
 * richer (nested properties, `oneOf`, `$ref`, `pattern`, ...) fails
 * `isFlatObjectSchema` and is edited as JSON instead.
 */

export const PROP_TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array'] as const;
export type PropType = (typeof PROP_TYPES)[number];

export interface ItemsSpec {
  type: PropType;
  additionalProperties?: boolean;
}

export interface PropertyRow {
  name: string;
  type: PropType;
  required: boolean;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  additionalProperties?: boolean;
  items?: ItemsSpec;
}

export interface FlatSchema {
  rows: PropertyRow[];
  additionalProperties: boolean;
}

const TOP_KEYS = new Set(['type', 'required', 'properties', 'additionalProperties']);
const PROP_KEYS = new Set([
  'type',
  'description',
  'enum',
  'minimum',
  'maximum',
  'default',
  'additionalProperties',
  'items',
]);
const ITEMS_KEYS = new Set(['type', 'additionalProperties']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isPropType = (v: unknown): v is PropType => PROP_TYPES.includes(v as PropType);
const keysWithin = (obj: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(obj).every((k) => allowed.has(k));

function isFlatProperty(p: unknown): boolean {
  if (!isRecord(p) || !keysWithin(p, PROP_KEYS) || !isPropType(p.type)) return false;
  if (p.description !== undefined && typeof p.description !== 'string') return false;
  if (
    p.enum !== undefined &&
    !(Array.isArray(p.enum) && p.enum.every((e) => typeof e === 'string'))
  )
    return false;
  if (p.minimum !== undefined && typeof p.minimum !== 'number') return false;
  if (p.maximum !== undefined && typeof p.maximum !== 'number') return false;
  if (p.additionalProperties !== undefined && typeof p.additionalProperties !== 'boolean')
    return false;
  if (p.items !== undefined) {
    if (!isRecord(p.items) || !keysWithin(p.items, ITEMS_KEYS) || !isPropType(p.items.type))
      return false;
    if (
      p.items.additionalProperties !== undefined &&
      typeof p.items.additionalProperties !== 'boolean'
    )
      return false;
  }
  return true;
}

export function isFlatObjectSchema(schema: unknown): boolean {
  if (!isRecord(schema) || !keysWithin(schema, TOP_KEYS)) return false;
  if (schema.type !== undefined && schema.type !== 'object') return false;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean')
    return false;
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) return false;
  if (!Object.values(properties).every(isFlatProperty)) return false;
  const required = schema.required ?? [];
  if (!Array.isArray(required)) return false;
  return required.every((r) => typeof r === 'string' && r in properties);
}

export function emptyFlatSchema(): FlatSchema {
  return { rows: [], additionalProperties: false };
}

export function emptyRow(): PropertyRow {
  return { name: '', type: 'string', required: false };
}

/** Assumes `isFlatObjectSchema(schema)`. */
export function schemaToRows(schema: Record<string, unknown>): FlatSchema {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const rows: PropertyRow[] = Object.entries(properties).map(([name, raw]) => {
    const p = raw as Record<string, unknown>;
    const row: PropertyRow = { name, type: p.type as PropType, required: required.has(name) };
    if (p.description !== undefined) row.description = p.description as string;
    if (p.enum !== undefined) row.enum = p.enum as string[];
    if (p.minimum !== undefined) row.minimum = p.minimum as number;
    if (p.maximum !== undefined) row.maximum = p.maximum as number;
    if (p.default !== undefined) row.default = p.default;
    if (p.additionalProperties !== undefined)
      row.additionalProperties = p.additionalProperties as boolean;
    if (p.items !== undefined) row.items = { ...(p.items as ItemsSpec) };
    return row;
  });
  return {
    rows,
    additionalProperties:
      typeof schema.additionalProperties === 'boolean' ? schema.additionalProperties : false,
  };
}

/** Writes the key layout the shipped servers use: `type, required, properties, additionalProperties`. */
export function rowsToSchema(flat: FlatSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const row of flat.rows) {
    const name = row.name.trim();
    if (!name) continue;
    const p: Record<string, unknown> = { type: row.type };
    if (row.description) p.description = row.description;
    if (row.enum && row.enum.length) p.enum = row.enum;
    if (row.minimum !== undefined) p.minimum = row.minimum;
    if (row.maximum !== undefined) p.maximum = row.maximum;
    if (row.default !== undefined) p.default = row.default;
    if (row.additionalProperties !== undefined) p.additionalProperties = row.additionalProperties;
    if (row.items) p.items = { ...row.items };
    properties[name] = p;
    if (row.required) required.push(name);
  }
  return { type: 'object', required, properties, additionalProperties: flat.additionalProperties };
}
