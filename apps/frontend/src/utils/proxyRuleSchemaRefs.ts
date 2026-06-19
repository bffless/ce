/**
 * Keys inside a pipeline rule's `pipelineConfig` (step/postStep `config` objects)
 * that hold a reference to a pipeline schema id. These are project-scoped, so an
 * export must bundle the referenced schemas and an import must remap them.
 *
 * Mirrors SCHEMA_REF_KEYS in the backend (apps/backend/src/proxy-rules/schema-refs.util.ts).
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
