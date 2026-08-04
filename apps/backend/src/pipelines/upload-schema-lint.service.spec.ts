import { UploadSchemaLintService } from './upload-schema-lint.service';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { UPLOAD_RECORD_FIELDS } from './upload-schema-contract';

const CANONICAL = UPLOAD_RECORD_FIELDS.map((f) => ({ ...f }));

function buildService(schemas: Record<string, { name: string; fields: unknown[] }>) {
  const getById = jest.fn(async (id: string) => (schemas[id] ? { id, ...schemas[id] } : null));
  const service = new UploadSchemaLintService({
    getById,
  } as unknown as PipelineSchemasService);
  return { service, getById };
}

const uploadStep = (schemaId: string, extraFields?: Record<string, string>) => ({
  name: 'upload',
  handlerType: 'register_upload',
  config: { schemaId, subDir: 'content', ...(extraFields ? { extraFields } : {}) },
});

describe('UploadSchemaLintService', () => {
  it('is silent for a schema that matches the upload record shape', async () => {
    const { service } = buildService({ s1: { name: 'uploads', fields: CANONICAL } });
    const warnings = await service.lintPipelineConfig({ steps: [uploadStep('s1')] });
    expect(warnings).toEqual([]);
  });

  it('warns, naming the schema and the fields it left out', async () => {
    const { service } = buildService({
      s1: { name: 'my_files', fields: [{ name: 'path', type: 'string', required: true }] },
    });
    const [warning, ...rest] = await service.lintPipelineConfig({ steps: [uploadStep('s1')] });
    expect(rest).toEqual([]);
    expect(warning).toContain('my_files');
    expect(warning).toContain('storage_path');
  });

  it('counts configured extraFields as part of the expected shape', async () => {
    const { service } = buildService({ s1: { name: 'nodes', fields: CANONICAL } });
    const [warning] = await service.lintPipelineConfig({
      steps: [uploadStep('s1', { nodeType: "'file'", parentId: 'request.body.parentId' })],
    });
    expect(warning).toContain('nodeType');
    expect(warning).toContain('parentId');
  });

  it('checks the proxied upload handler too, not just the presigned one', async () => {
    const { service } = buildService({ s1: { name: 'uploads', fields: [] } });
    const warnings = await service.lintPipelineConfig({
      steps: [{ name: 'up', handlerType: 'file_upload_handler', config: { schemaId: 's1' } }],
    });
    expect(warnings).toHaveLength(1);
  });

  it('ignores steps that write no upload record', async () => {
    const { service, getById } = buildService({});
    const warnings = await service.lintPipelineConfig({
      steps: [
        // prepare half of the direct-to-bucket flow — writes nothing
        { name: 'prepare', handlerType: 'presigned_upload', config: { subDir: 'content' } },
        { name: 'save', handlerType: 'data_create', config: { schemaId: 's1' } },
        { name: 'out', handlerType: 'response_handler', config: {} },
      ],
    });
    expect(warnings).toEqual([]);
    expect(getById).not.toHaveBeenCalled();
  });

  it('reports a schema once even when several steps target it', async () => {
    const { service } = buildService({ s1: { name: 'uploads', fields: [] } });
    const warnings = await service.lintPipelineConfig({
      steps: [uploadStep('s1'), { ...uploadStep('s1'), name: 'upload2' }],
    });
    expect(warnings).toHaveLength(1);
  });

  it('stays quiet about a schema it cannot resolve — the handler reports that itself', async () => {
    const { service } = buildService({});
    const warnings = await service.lintPipelineConfig({ steps: [uploadStep('missing')] });
    expect(warnings).toEqual([]);
  });

  it('tolerates malformed pipeline configs rather than throwing at save time', async () => {
    const { service } = buildService({});
    await expect(service.lintPipelineConfig(undefined)).resolves.toEqual([]);
    await expect(service.lintPipelineConfig({})).resolves.toEqual([]);
    await expect(service.lintPipelineConfig({ steps: 'nope' })).resolves.toEqual([]);
    await expect(
      service.lintPipelineConfig({ steps: [null, { handlerType: 'register_upload' }] }),
    ).resolves.toEqual([]);
  });

  it('lints against caller-supplied fields when the schema is not saved yet', async () => {
    // The rules-as-code sync path knows the fields a bundled schema WILL have,
    // before anything is written (and under dryRun, nothing ever is).
    const { service, getById } = buildService({});
    const warnings = service.lintWithFields({ steps: [uploadStep('src-1')] }, (schemaId) =>
      schemaId === 'src-1' ? { name: 'uploads', fields: [] } : undefined,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('uploads');
    expect(getById).not.toHaveBeenCalled();
  });
});
