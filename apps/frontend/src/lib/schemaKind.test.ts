import { isUploadSchema, holdsUploadedFiles } from './schemaKind';
import type { PipelineSchema, SchemaKind } from '@/services/pipelineSchemasApi';

const schema = (kind: SchemaKind | null, fieldNames: string[]) =>
  ({
    kind,
    fields: fieldNames.map((name) => ({ name, type: 'string', required: false })),
  }) as unknown as PipelineSchema;

const UPLOAD_FIELDS = ['storage_path', 'content_type', 'url'];

describe('isUploadSchema (how a schema is presented)', () => {
  it('trusts a declared upload kind', () => {
    expect(isUploadSchema(schema('upload', []))).toBe(true);
  });

  it('lets a declared non-upload kind override file-ish fields', () => {
    // The whole point of the column: a chat schema that happens to store a
    // storage_path is no longer paraded as an upload schema.
    expect(isUploadSchema(schema('chat', UPLOAD_FIELDS))).toBe(false);
    expect(isUploadSchema(schema('state', UPLOAD_FIELDS))).toBe(false);
  });

  it('falls back to the field shape when nothing is declared', () => {
    // Every schema predating the column is null, so this path must not change.
    expect(isUploadSchema(schema(null, UPLOAD_FIELDS))).toBe(true);
    expect(isUploadSchema(schema(null, ['storage_path']))).toBe(false);
    expect(isUploadSchema(schema(null, ['name', 'body']))).toBe(false);
  });
});

describe('holdsUploadedFiles (whether rows can be narrowed to files)', () => {
  it('is true for a declared upload schema that declares nothing', () => {
    // Records carry storage_path whatever the schema says, so the filter still
    // works — this is the under-declared schema the upload lint warns about.
    expect(holdsUploadedFiles(schema('upload', []))).toBe(true);
  });

  it('needs only the marker field when nothing is declared', () => {
    // Looser than isUploadSchema on purpose, and unchanged from the behaviour
    // before the column existed.
    expect(holdsUploadedFiles(schema(null, ['storage_path']))).toBe(true);
    expect(holdsUploadedFiles(schema(null, ['name', 'body']))).toBe(false);
  });

  it('is false for a declared non-upload kind', () => {
    expect(holdsUploadedFiles(schema('state', ['storage_path']))).toBe(false);
  });
});
