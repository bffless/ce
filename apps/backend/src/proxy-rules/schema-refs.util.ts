/**
 * Keys inside a pipeline rule's `pipelineConfig` (step/postStep `config` objects)
 * that hold a reference to a `pipeline_schemas` row id. These are project-scoped,
 * so they must be remapped when a rule set is imported into another project.
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
 * Recursively collect every schema-id reference value found under any
 * SCHEMA_REF_KEYS key. Generic key-based walk so new schema-bearing handlers
 * are covered automatically.
 */
export function collectSchemaIds(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaIds(item, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (SCHEMA_REF_KEY_SET.has(key) && typeof value === 'string' && value) {
        out.add(value);
      }
      collectSchemaIds(value, out);
    }
  }
  return out;
}

/**
 * Return a deep clone of `node` with any schema-id reference value replaced via
 * `idMap`. References not present in the map are left untouched (e.g. a v1 export
 * with no bundled schemas, or a ref the user chose not to remap).
 */
export function remapSchemaIds<T>(node: T, idMap: Map<string, string>): T {
  if (Array.isArray(node)) {
    return node.map((item) => remapSchemaIds(item, idMap)) as unknown as T;
  }
  if (node && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (SCHEMA_REF_KEY_SET.has(key) && typeof value === 'string' && idMap.has(value)) {
        result[key] = idMap.get(value);
      } else {
        result[key] = remapSchemaIds(value, idMap);
      }
    }
    return result as T;
  }
  return node;
}
