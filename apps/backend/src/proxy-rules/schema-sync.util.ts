import type { SchemaField } from '../db/schema/pipeline-schemas.schema';

/**
 * A schema field as it arrives in a sync/export payload. Identical to the DB
 * `SchemaField` except `required` is optional — bundled export entries (and
 * `SchemaFieldDto`) may omit it, and the backend treats an absent `required`
 * as `false` (`PipelineSchemasService.create` normalizes `required ?? false`
 * before insert). DB rows (`required: boolean`) are assignable as-is.
 */
export interface ComparableSchemaField {
  name: string;
  type: SchemaField['type'];
  required?: boolean;
  default?: unknown;
}

/**
 * One entry of the sync response's `schemaResolutions[]` (Phase 1 plan,
 * cross-cutting definitions): how a bundled schema was resolved against the
 * target project, by name.
 *
 * - `action: 'reuse'` — a project schema with the same name exists;
 *   `targetSchemaId` is its id and `fieldMismatch` reports whether its field
 *   definitions diverge from the incoming ones (see compareSchemaFields).
 * - `action: 'create'` — no name match; `targetSchemaId` is the freshly
 *   created schema's id, or `null` under dryRun (nothing was created).
 */
export interface SchemaResolution {
  name: string;
  action: 'reuse' | 'create';
  targetSchemaId: string | null;
  fieldMismatch: boolean;
}

/**
 * Compare two schema field lists by field NAME as identity, order-insensitively.
 *
 * Reports, as precise human-readable strings (schema-agnostic — the caller
 * prefixes the schema name):
 * - fields only in `incoming` / only in `existing`;
 * - per common field, a `type` difference and/or a `required` difference.
 *
 * `required` is normalized with `?? false` on BOTH sides before comparing —
 * bundled export entries may omit it and the backend treats absent as `false`
 * (matching `PipelineSchemasService.create`). `default` is deliberately NOT
 * compared: it does not participate in the DB schema identity and exports may
 * carry or drop it freely.
 *
 * Mismatch order is deterministic: common-field diffs and incoming-only fields
 * in `incoming` order, then existing-only fields in `existing` order. Duplicate
 * names within a list are not expected (DB uniqueness / payload validation);
 * if present, the last occurrence wins.
 */
export function compareSchemaFields(
  incoming: ComparableSchemaField[],
  existing: ComparableSchemaField[],
): { match: boolean; mismatches: string[] } {
  const existingByName = new Map(existing.map((f) => [f.name, f]));
  const incomingNames = new Set(incoming.map((f) => f.name));
  const mismatches: string[] = [];

  for (const field of incoming) {
    const match = existingByName.get(field.name);
    if (!match) {
      mismatches.push(`field "${field.name}" is only in the incoming definition`);
      continue;
    }
    if (field.type !== match.type) {
      mismatches.push(
        `field "${field.name}": type ${field.type} (incoming) vs ${match.type} (existing)`,
      );
    }
    const incomingRequired = field.required ?? false;
    const existingRequired = match.required ?? false;
    if (incomingRequired !== existingRequired) {
      mismatches.push(
        `field "${field.name}": required ${incomingRequired} (incoming) vs ${existingRequired} (existing)`,
      );
    }
  }

  for (const field of existing) {
    if (!incomingNames.has(field.name)) {
      mismatches.push(`field "${field.name}" is only in the existing schema`);
    }
  }

  return { match: mismatches.length === 0, mismatches };
}
