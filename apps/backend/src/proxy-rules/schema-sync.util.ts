import type { SchemaField } from '../db/schema/pipeline-schemas.schema';

/** The field types an index applies to: mirrors `INDEXABLE_FIELD_TYPES` in pipeline-data-indexes.service (kept local so this module stays dependency-free). */
const INDEXABLE_TYPES = new Set(['string', 'number', 'boolean', 'email', 'datetime']);

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
  indexed?: boolean;
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
  /**
   * The payload declared a `kind` and the live schema had none, so the sync
   * filled it in (planned only, under dryRun). Never true for a conflict: a
   * schema that already declares a kind keeps it.
   */
  kindAdopted: boolean;
  /**
   * Names of payload fields the sync added to the live schema because the
   * caller opted in (`options.adoptFields`), the diff was purely additive,
   * and this rule set owns the schema — see planFieldAdoption. Under dryRun
   * the fields that WOULD be added. Empty for a create (the new schema
   * carries every payload field from birth) and whenever nothing was adopted.
   */
  fieldsAdopted: string[];
  /**
   * Names of the live schema's fields the sync marked `indexed` because the
   * payload declares `indexed: true` and the live schema did not, on a schema
   * this rule set owns (planned only, under dryRun). An index is the app's
   * declaration of what it filters on (`PipelineDataIndexesService`); like
   * `kind` it changes nothing about the rows, so it is adopted without a
   * version bump. Empty when the payload and the live schema already agree.
   */
  indexesAdded: string[];
  /**
   * Names of the live schema's fields the sync un-marked because the payload
   * declares `indexed: false` EXPLICITLY. A payload that says nothing about a
   * field's index leaves it as it is: an index set in the dashboard or by the
   * API is not taken away by a push whose YAML never mentioned it. A removal
   * is also warned about, so it is never silent.
   */
  indexesRemoved: string[];
}

/**
 * What index adoption would change, by field name: the live fields the payload
 * declares `indexed: true` that are not indexed (`add`), and the ones it
 * declares `indexed: false` that are (`remove`). A payload field with no
 * `indexed` key has NO OPINION and changes nothing: the flag is tri-state on
 * the way in (true, false, absent), two-state at rest. Only fields present on
 * both sides count (a payload-only field is field adoption's business).
 * `indexed` is the resulting set of indexed field names. Pure.
 */
export function planIndexAdoption(
  incoming: ComparableSchemaField[],
  existing: ComparableSchemaField[],
): { add: string[]; remove: string[]; indexed: string[] } {
  const incomingByName = new Map(incoming.map((f) => [f.name, f]));
  const add: string[] = [];
  const remove: string[] = [];
  const indexed: string[] = [];
  for (const live of existing) {
    const payload = incomingByName.get(live.name);
    const was = live.indexed === true;
    // A flag on a type that cannot be indexed (text, json) is no opinion either.
    const says = payload && payload.indexed !== undefined && INDEXABLE_TYPES.has(live.type);
    const wants = says ? payload.indexed === true : was;
    if (wants && !was) add.push(live.name);
    if (!wants && was) remove.push(live.name);
    if (wants) indexed.push(live.name);
  }
  return { add, remove, indexed };
}

/**
 * Outcome of {@link planFieldAdoption}.
 *
 * - `additive: true` — every difference between the payload and the live
 *   field list is a NEW optional field (`added` names them, `merged` is the
 *   live list with them appended). This is the only shape the rules-as-code
 *   sync will ever write onto an existing schema (bffless/ce#721).
 * - `additive: false` — either the lists already match (`added` is empty) or
 *   the diff removes, retypes, or newly requires a field. Both are left to
 *   compareSchemaFields' warning / strict path; nothing is written.
 */
export interface FieldAdoptionPlan {
  additive: boolean;
  added: string[];
  merged: SchemaField[];
}

/**
 * Decide whether the payload's field list is a purely additive superset of the
 * live one, and if so produce the merged list.
 *
 * "Purely additive" means: every live field is still present with the same
 * `type` and the same (`?? false`-normalized) `required`; every payload-only
 * field is optional. A payload-only field that is `required: true` is NOT
 * additive — existing rows would fail validation the moment it landed.
 * Field order is live-first: the live entries are kept as-is (including any
 * `default` the dashboard set), the new ones are appended in payload order
 * with `required` normalized to `false`, mirroring `PipelineSchemasService`.
 *
 * `default` is not compared (compareSchemaFields ignores it too): it does not
 * participate in schema identity.
 */
export function planFieldAdoption(
  incoming: ComparableSchemaField[],
  existing: ComparableSchemaField[],
): FieldAdoptionPlan {
  const notAdditive: FieldAdoptionPlan = { additive: false, added: [], merged: [] };
  const existingByName = new Map(existing.map((f) => [f.name, f]));
  const incomingNames = new Set(incoming.map((f) => f.name));

  for (const field of existing) {
    if (!incomingNames.has(field.name)) return notAdditive;
  }

  const added: SchemaField[] = [];
  for (const field of incoming) {
    const live = existingByName.get(field.name);
    if (live) {
      if (field.type !== live.type) return notAdditive;
      if ((field.required ?? false) !== (live.required ?? false)) return notAdditive;
      continue;
    }
    if (field.required ?? false) return notAdditive;
    added.push({
      name: field.name,
      type: field.type,
      required: false,
      ...(field.default !== undefined ? { default: field.default } : {}),
    });
  }

  if (added.length === 0) return notAdditive;

  return {
    additive: true,
    added: added.map((f) => f.name),
    merged: [...(existing as SchemaField[]), ...added],
  };
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
