import {
  UPLOAD_RECORD_FIELDS,
  diffUploadSchema,
  hasUploadSchemaGap,
  describeUploadSchemaGap,
  DeclaredField,
} from './upload-schema-contract';

/** The canonical shape, as `generate_upload_schema` produces it. */
const canonical = (): DeclaredField[] => UPLOAD_RECORD_FIELDS.map((f) => ({ ...f }));

describe('diffUploadSchema', () => {
  it('reports no gap for the schema the generator creates', () => {
    const gap = diffUploadSchema(canonical());
    expect(hasUploadSchemaGap(gap)).toBe(false);
  });

  it('ignores fields the schema declares beyond the contract', () => {
    // An app is free to add its own columns — handoff stores a whole node tree
    // alongside the file metadata.
    const gap = diffUploadSchema([
      ...canonical(),
      { name: 'nodeType', type: 'string', required: true },
      { name: 'parentId', type: 'string', required: true },
    ]);
    expect(hasUploadSchemaGap(gap)).toBe(false);
  });

  it('names every contract field an AI-authored schema left out', () => {
    const gap = diffUploadSchema([
      { name: 'name', type: 'string', required: true },
      { name: 'path', type: 'string', required: true },
      { name: 'mime', type: 'string', required: true },
    ]);
    expect(gap.missing).toEqual([
      'filename',
      'storage_path',
      'content_type',
      'size',
      'url',
      'sub_dir',
      'original_name',
    ]);
  });

  it('treats configured extraFields as part of the expected shape', () => {
    const gap = diffUploadSchema(canonical(), ['nodeType', 'parentId']);
    expect(gap.missing).toEqual(['nodeType', 'parentId']);
  });

  it('accepts text where the contract says string', () => {
    // A long storage path in a `text` column is fine — the value round-trips.
    const declared = canonical().map((f) =>
      f.name === 'storage_path' ? { ...f, type: 'text' as const } : f,
    );
    expect(hasUploadSchemaGap(diffUploadSchema(declared))).toBe(false);
  });

  it('flags a type that cannot hold what the handler writes', () => {
    const declared = canonical().map((f) =>
      f.name === 'size' ? { ...f, type: 'string' as const } : f,
    );
    const gap = diffUploadSchema(declared);
    expect(gap.typeMismatches).toEqual([{ name: 'size', expected: 'number', declared: 'string' }]);
  });

  it('treats a schema with no fields as missing everything', () => {
    expect(diffUploadSchema([]).missing).toHaveLength(UPLOAD_RECORD_FIELDS.length);
    expect(diffUploadSchema(undefined).missing).toHaveLength(UPLOAD_RECORD_FIELDS.length);
  });

  it('does not care whether the schema marks the fields required', () => {
    // The write path never enforces `required`, so demanding it would be a
    // warning the author cannot act on meaningfully.
    const declared = canonical().map((f) => ({ ...f, required: false }));
    expect(hasUploadSchemaGap(diffUploadSchema(declared))).toBe(false);
  });
});

describe('describeUploadSchemaGap', () => {
  it('returns null when the schema matches', () => {
    expect(describeUploadSchemaGap('uploads', diffUploadSchema(canonical()))).toBeNull();
  });

  it('says what actually breaks, not just what differs', () => {
    const message = describeUploadSchemaGap('uploads', diffUploadSchema([]))!;
    expect(message).toContain('Upload schema "uploads"');
    expect(message).toContain('storage_path');
    // The author needs to know the upload still succeeds, or the warning reads
    // as a failure they must fix before shipping.
    expect(message).toContain('still upload');
    expect(message).toMatch(/searchable|Uploads tab/);
  });

  it('describes a type mismatch in both directions', () => {
    const declared = canonical().map((f) =>
      f.name === 'size' ? { ...f, type: 'string' as const } : f,
    );
    const message = describeUploadSchemaGap('uploads', diffUploadSchema(declared))!;
    expect(message).toContain('declares size as string but uploads write number');
  });
});
