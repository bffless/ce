import { SchemaField, SchemaFieldType } from '../db/schema';

/**
 * The record shape every upload handler writes.
 *
 * `UploadRecordService.createUploadRecords` sets exactly these keys (plus any
 * configured `extraFields`) on the pipeline_data record, whatever the target
 * schema happens to declare — the write is not driven by the schema. So this
 * list is the real contract, and a schema that does not declare it is
 * describing something its own data isn't.
 *
 * Kept here rather than inline in the generator so the thing that CREATES an
 * upload schema and the thing that WRITES upload records cannot drift apart.
 */
export const UPLOAD_RECORD_FIELDS: readonly SchemaField[] = [
  { name: 'filename', type: 'string', required: true },
  { name: 'storage_path', type: 'string', required: true },
  { name: 'content_type', type: 'string', required: true },
  { name: 'size', type: 'number', required: true },
  { name: 'url', type: 'string', required: true },
  { name: 'sub_dir', type: 'string', required: true },
  { name: 'original_name', type: 'string', required: true },
];

/**
 * Handler types whose `config.schemaId` names a schema that upload records are
 * written into. `presigned_upload` is deliberately absent: it is the prepare
 * half of the direct-to-bucket flow and writes no record (it has no schemaId).
 */
export const UPLOAD_RECORD_HANDLER_TYPES = ['file_upload_handler', 'register_upload'] as const;

/** A field definition as declared by a schema — DB rows and payload entries both fit. */
export interface DeclaredField {
  name: string;
  type: SchemaFieldType;
  required?: boolean;
}

export interface UploadSchemaGap {
  /** Contract fields the schema does not declare at all. */
  missing: string[];
  /** Contract fields declared with a type that can't hold what the handler writes. */
  typeMismatches: { name: string; expected: SchemaFieldType; declared: SchemaFieldType }[];
}

/**
 * Types that can carry an upload field's value without lying about it. `size`
 * is a number; everything else is a string, and `text` is just as good a home
 * for a string as `string` is (a long storage path in a `text` field is fine).
 */
function isCompatible(expected: SchemaFieldType, declared: SchemaFieldType): boolean {
  if (expected === declared) return true;
  if (expected === 'string') return declared === 'text';
  return false;
}

/**
 * Compare what a schema declares against what upload handlers write.
 *
 * `extraFieldNames` are the handler's configured `extraFields` — an app is free
 * to add its own columns (handoff stores `nodeType`, `parentId`, … alongside
 * the file metadata), so those count as declared-on-purpose and a schema that
 * omits them is reported the same way as one missing a contract field.
 */
export function diffUploadSchema(
  declared: DeclaredField[] | undefined | null,
  extraFieldNames: string[] = [],
): UploadSchemaGap {
  const byName = new Map((declared ?? []).map((f) => [f.name, f]));
  const gap: UploadSchemaGap = { missing: [], typeMismatches: [] };

  for (const field of UPLOAD_RECORD_FIELDS) {
    const match = byName.get(field.name);
    if (!match) {
      gap.missing.push(field.name);
    } else if (!isCompatible(field.type, match.type)) {
      gap.typeMismatches.push({ name: field.name, expected: field.type, declared: match.type });
    }
  }

  for (const name of extraFieldNames) {
    if (!byName.has(name)) gap.missing.push(name);
  }

  return gap;
}

/** An upload step's reference to the schema its records land in. */
export interface UploadStepRef {
  stepName: string;
  schemaId: string;
  extraFieldNames: string[];
}

/**
 * Find the steps of a pipeline config that write upload records.
 *
 * Reads defensively: this runs on save/sync paths where the config is whatever
 * an author (or an agent) just sent, and a lint that throws on a malformed
 * pipeline would turn an advisory into an outage.
 */
export function collectUploadStepRefs(pipelineConfig: unknown): UploadStepRef[] {
  const steps = (pipelineConfig as { steps?: unknown } | null | undefined)?.steps;
  if (!Array.isArray(steps)) return [];

  const refs: UploadStepRef[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const { handlerType, config, name } = step as {
      handlerType?: unknown;
      config?: unknown;
      name?: unknown;
    };
    if (!UPLOAD_RECORD_HANDLER_TYPES.includes(handlerType as never)) continue;

    const schemaId = (config as { schemaId?: unknown } | undefined)?.schemaId;
    if (typeof schemaId !== 'string' || schemaId.length === 0) continue;

    const extraFields = (config as { extraFields?: unknown }).extraFields;
    refs.push({
      stepName: typeof name === 'string' ? name : String(handlerType),
      schemaId,
      extraFieldNames:
        extraFields && typeof extraFields === 'object' ? Object.keys(extraFields) : [],
    });
  }
  return refs;
}

export function hasUploadSchemaGap(gap: UploadSchemaGap): boolean {
  return gap.missing.length > 0 || gap.typeMismatches.length > 0;
}

/**
 * One human-readable line describing the gap, or null when the schema matches.
 * Says what breaks, not just what differs — an author who sees only "missing
 * storage_path" has no reason to care, since the upload itself still succeeds.
 */
export function describeUploadSchemaGap(schemaName: string, gap: UploadSchemaGap): string | null {
  if (!hasUploadSchemaGap(gap)) return null;

  const parts: string[] = [];
  if (gap.missing.length > 0) {
    parts.push(`does not declare ${gap.missing.join(', ')}`);
  }
  for (const mismatch of gap.typeMismatches) {
    parts.push(
      `declares ${mismatch.name} as ${mismatch.declared} but uploads write ${mismatch.expected}`,
    );
  }

  return (
    `Upload schema "${schemaName}": ${parts.join('; ')}. ` +
    `Files will still upload, but undeclared fields are not searchable and the schema ` +
    `will not be recognised as an upload schema in the Uploads tab.`
  );
}
