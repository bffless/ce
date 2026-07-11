/**
 * Keys inside a rule's pipeline config (step/postStep `config` objects, canonical or
 * authoring form) that hold a reference to a `pipeline_schemas` row id. Mirror of
 * `apps/backend/src/proxy-rules/schema-refs.util.ts:10-16` — kept as a separate,
 * independently-maintained copy in the CLI (no cross-repo imports).
 *
 * - `schemaId`: data_create, data_query, data_update, data_delete, db_aggregate,
 *   file_upload, embed_store, vector_search
 * - `persist*SchemaId` / deprecated `conversationsSchemaId` / `messagesSchemaId`: ai handler
 */
export const SCHEMA_REF_KEYS = [
  'schemaId',
  'persistMessagesSchemaId',
  'persistConversationsSchemaId',
  'conversationsSchemaId',
  'messagesSchemaId',
] as const;

const SCHEMA_REF_KEY_SET = new Set<string>(SCHEMA_REF_KEYS);

/**
 * Recursively walks `value` (objects and arrays, at any depth) and invokes `visit` for
 * every *string* value found under a `SCHEMA_REF_KEYS` key. `visit` receives the
 * current ref string plus a `set` callback that replaces that value in place on the
 * walked structure (mutates `value`).
 *
 * A `SCHEMA_REF_KEYS` key whose value is not a string (e.g. `null`, a number) is left
 * alone — `visit` is not called for it — matching the backend's `typeof value ===
 * 'string'` guard.
 */
export function walkSchemaRefs(value: unknown, visit: (ref: string, set: (v: string) => void) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkSchemaRefs(item, visit);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (SCHEMA_REF_KEY_SET.has(key) && typeof v === 'string') {
        visit(v, (newValue: string) => {
          obj[key] = newValue;
        });
      }
      walkSchemaRefs(v, visit);
    }
  }
}
