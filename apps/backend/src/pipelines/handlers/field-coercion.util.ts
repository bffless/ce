import { SchemaField } from '../../db/schema/pipeline-schemas.schema';

/**
 * Coerce evaluated field values to their schema-declared types before writing.
 *
 * Data records live in JSONB, so nothing at the storage layer enforces the
 * schema's field types — an expression like `now()` (an ISO string) written
 * into a `number` column would otherwise be stored verbatim and break epoch-ms
 * consumers. Only `number` and `boolean` fields are coerced; a value that
 * cannot be coerced is reported as an error rather than written. Date-parsable
 * strings destined for `number` fields become epoch milliseconds. Fields not
 * declared in the schema, and null/undefined values, pass through untouched
 * (required-ness is validated separately by each handler).
 */
export function coerceFieldsToSchema(
  data: Record<string, unknown>,
  fields: SchemaField[] | undefined | null,
): { data: Record<string, unknown>; errors: Record<string, string> } {
  const result: Record<string, unknown> = { ...data };
  const errors: Record<string, string> = {};
  if (!fields) {
    return { data: result, errors };
  }

  for (const field of fields) {
    if (!(field.name in result)) continue;
    const value = result[field.name];
    if (value === null || value === undefined) continue;

    switch (field.type) {
      case 'number': {
        if (typeof value === 'number' && Number.isFinite(value)) break;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
            result[field.name] = Number(trimmed);
            break;
          }
          const parsedMs = Date.parse(trimmed);
          if (!Number.isNaN(parsedMs)) {
            result[field.name] = parsedMs;
            break;
          }
        }
        errors[field.name] = `${field.name} must be a number, got ${JSON.stringify(value)}`;
        break;
      }
      case 'boolean': {
        if (typeof value === 'boolean') break;
        if (value === 'true') {
          result[field.name] = true;
          break;
        }
        if (value === 'false') {
          result[field.name] = false;
          break;
        }
        errors[field.name] = `${field.name} must be a boolean, got ${JSON.stringify(value)}`;
        break;
      }
      default:
        break;
    }
  }

  return { data: result, errors };
}
