import { PipelineSchema } from '@/services/pipelineSchemasApi';

type SchemaShape = Pick<PipelineSchema, 'kind' | 'fields'>;

/**
 * A declared `kind` settles it; otherwise the caller's field-shape heuristic
 * decides (bffless/ce#633).
 *
 * Undeclared is the common case — every schema created before the column
 * existed, and any schema written by hand — so the fallbacks are not
 * vestigial, and each caller keeps the exact heuristic it used before the
 * column existed. A declared non-upload kind wins over field shape, so a chat
 * or state schema that happens to carry file-ish fields stops being
 * mislabelled.
 */
function hasUploadIntent(schema: SchemaShape, fallback: (fieldNames: Set<string>) => boolean) {
  if (schema.kind) return schema.kind === 'upload';
  return fallback(new Set((schema.fields ?? []).map((f) => f.name)));
}

/**
 * Should this schema be PRESENTED as an upload schema — listed under "Upload
 * Schemas" with a file count rather than offered as a plain browsable schema?
 */
export function isUploadSchema(schema: SchemaShape): boolean {
  return hasUploadIntent(
    schema,
    (names) => names.has('storage_path') && names.has('content_type') && names.has('url'),
  );
}

/**
 * Can this schema's rows be narrowed to actual files?
 *
 * Deliberately looser than {@link isUploadSchema}: one marker field is enough,
 * because the filter reads the RECORDS (`storage_path` is written by every
 * upload handler regardless of what the schema declares). A declared upload
 * schema qualifies even if it declares no fields at all — which is exactly the
 * under-declared schema the upload-schema lint warns about.
 *
 * `kind` states primary intent, NOT exclusivity: an upload schema may hold rows
 * that aren't files (handoff stores a whole file tree in one), which is why
 * this exists at all — callers filter rows instead of assuming.
 */
export function holdsUploadedFiles(schema: SchemaShape): boolean {
  return hasUploadIntent(schema, (names) => names.has('storage_path'));
}
