import { PresignedUploadHandler } from './presigned-upload.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { UploadRecordService } from '../upload-record.service';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineDataService } from '../pipeline-data.service';

// Minimal registry stub — the handler only calls registry.register(this) in its ctor.
const registry = { register: () => {} } as any;

// Storage adapter that supports presigned URLs and echoes the key it was asked to sign.
const storageAdapter = {
  supportsPresignedUrls: () => true,
  getPresignedUploadUrl: async (key: string) => `https://bucket.example/${encodeURI(key)}?sig=x`,
} as any;

const buildHandler = () => {
  const evaluator = new ExpressionEvaluator();
  const uploadRecords = new UploadRecordService({} as PipelineDataService, evaluator);
  return new PresignedUploadHandler(registry, evaluator, uploadRecords, storageAdapter);
};

// owner/repo come from deployment context so resolveOwnerRepo never touches the DB.
const contextWith = (body: Record<string, unknown>): PipelineContext =>
  ({
    projectId: 'p1',
    deployment: { owner: 'acme', repo: 'site' },
    metadata: { body },
    stepOutputs: {},
  }) as unknown as PipelineContext;

const step = (config: Record<string, unknown>): PipelineStep =>
  ({ name: 'presigned', handlerType: 'presigned_upload', config }) as unknown as PipelineStep;

describe('PresignedUploadHandler — verbatim mode', () => {
  it('mints a presigned URL for the exact app-chosen key', async () => {
    const handler = buildHandler();
    const res: StepResult = await handler.execute(
      contextWith({ path: 'Design Docs/doc.md' }),
      step({ subDir: 'content', keyStrategy: 'verbatim', key: 'request.body.path' }),
    );
    expect(res.success).toBe(true);
    expect((res.output as any).storageKey).toBe('acme/site/uploads/content/Design Docs/doc.md');
    expect((res.output as any).publicPath).toBe('/api/uploads/content/Design Docs/doc.md');
    expect(String((res.output as any).uploadUrl)).toContain(
      'acme/site/uploads/content/Design%20Docs/doc.md',
    );
  });

  it('errors when the key expression resolves to nothing', async () => {
    const handler = buildHandler();
    const res = await handler.execute(
      contextWith({}),
      step({ subDir: 'content', keyStrategy: 'verbatim', key: 'request.body.path' }),
    );
    expect(res.success).toBe(false);
    expect(res.error!.code).toBe('MISSING_KEY');
  });

  it('is unchanged in default (uuid) mode', async () => {
    const handler = buildHandler();
    const res = await handler.execute(
      contextWith({ filename: 'a b.png' }),
      step({ subDir: 'content' }),
    );
    expect(res.success).toBe(true);
    expect((res.output as any).storageKey).toMatch(
      /^acme\/site\/uploads\/content\/[0-9a-f-]{36}-a_b\.png$/,
    );
  });
});
