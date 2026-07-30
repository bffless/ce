import { PresignedUploadHandler } from './presigned-upload.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { UploadRecordService } from '../upload-record.service';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineDataService } from '../pipeline-data.service';

// Minimal registry stub — the handler only calls registry.register(this) in its ctor.
const registry = { register: () => {} } as any;

// Storage adapter that supports presigned URLs and echoes the key it was asked to sign.
// Bucket-shaped (no `isLocalAdapter`) so resolveLocalAdapter() treats it as non-local.
const storageAdapter = {
  supportsPresignedUrls: () => true,
  getPresignedUploadUrl: async (key: string) => `https://bucket.example/${encodeURI(key)}?sig=x`,
} as any;

// Flags on by default so existing behaviour-preserving tests don't need to care.
const featureFlagsOn = { isEnabled: async () => true } as any;
const featureFlagsOff = { isEnabled: async () => false } as any;

const buildHandler = (adapter: any = storageAdapter, featureFlags: any = featureFlagsOn) => {
  const evaluator = new ExpressionEvaluator();
  const uploadRecords = new UploadRecordService({} as PipelineDataService, evaluator);
  return new PresignedUploadHandler(registry, evaluator, uploadRecords, adapter, featureFlags);
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

  it('errors with MISSING_KEY when the resolved key is whitespace-only', async () => {
    const handler = buildHandler();
    const res = await handler.execute(
      contextWith({ path: '   ' }),
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

describe('PresignedUploadHandler — uuid mode', () => {
  it('errors with MISSING_FILENAME when no filename is provided', async () => {
    const handler = buildHandler();
    const res = await handler.execute(contextWith({}), step({ subDir: 'content' }));
    expect(res.success).toBe(false);
    expect(res.error!.code).toBe('MISSING_FILENAME');
  });
});

describe('PresignedUploadHandler — ENABLE_LOCAL_PRESIGNED_UPLOADS gating', () => {
  // resolveLocalAdapter() keys off `isLocalAdapter`, not adapter shape/naming.
  const localAdapter = {
    isLocalAdapter: true,
    supportsPresignedUrls: () => true,
    getPresignedUploadUrl: async (key: string) => `/api/storage/presigned/local?key=${key}`,
  } as any;

  it('flag off + local adapter -> PRESIGNED_NOT_SUPPORTED (does not mint a URL that would 404)', async () => {
    const handler = buildHandler(localAdapter, featureFlagsOff);
    const res = await handler.execute(
      contextWith({ filename: 'a.png' }),
      step({ subDir: 'content' }),
    );
    expect(res.success).toBe(false);
    expect(res.error!.code).toBe('PRESIGNED_NOT_SUPPORTED');
  });

  it('flag off + bucket adapter -> still supported (flag is local-specific)', async () => {
    const handler = buildHandler(storageAdapter, featureFlagsOff);
    const res = await handler.execute(
      contextWith({ filename: 'a.png' }),
      step({ subDir: 'content' }),
    );
    expect(res.success).toBe(true);
  });

  it('flag on + local adapter -> supported', async () => {
    const handler = buildHandler(localAdapter, featureFlagsOn);
    const res = await handler.execute(
      contextWith({ filename: 'a.png' }),
      step({ subDir: 'content' }),
    );
    expect(res.success).toBe(true);
  });
});

describe('PresignedUploadHandler — maxFileSize narrows the signed max', () => {
  it('passes the step-configured maxFileSize through to getPresignedUploadUrl', async () => {
    const seen: { key?: string; expiresIn?: number; maxBytes?: number } = {};
    const adapter = {
      isLocalAdapter: true,
      supportsPresignedUrls: () => true,
      getPresignedUploadUrl: async (key: string, expiresIn?: number, maxBytes?: number) => {
        seen.key = key;
        seen.expiresIn = expiresIn;
        seen.maxBytes = maxBytes;
        return `/api/storage/presigned/local?key=${key}&max=${maxBytes}`;
      },
    } as any;

    const handler = buildHandler(adapter, featureFlagsOn);
    const res = await handler.execute(
      contextWith({ filename: 'avatar.png' }),
      step({ subDir: 'avatars', maxFileSize: 5_242_880 }),
    );

    expect(res.success).toBe(true);
    expect(seen.maxBytes).toBe(5_242_880);
    expect(String((res.output as any).uploadUrl)).toContain('max=5242880');
    // Echoed back as a hint too.
    expect((res.output as any).maxFileSize).toBe(5_242_880);
  });

  it('a real LocalStorageAdapter actually clamps the signed max to the narrower step limit', async () => {
    const { LocalStorageAdapter } = await import('../../storage/local.adapter');
    const { verifyLocalUpload, DEFAULT_MAX_UPLOAD_BYTES } = await import(
      '../../storage/presign.util'
    );

    const local = new LocalStorageAdapter({
      localPath: '/tmp/does-not-matter',
      presignKey: Buffer.from('a'.repeat(32)),
    } as any);

    const handler = buildHandler(local as any, featureFlagsOn);
    const stepMaxFileSize = 1_048_576; // 1 MiB, well under the 100 MiB default ceiling
    const res = await handler.execute(
      contextWith({ filename: 'avatar.png' }),
      step({ subDir: 'avatars', maxFileSize: stepMaxFileSize }),
    );

    expect(res.success).toBe(true);
    const url = new URL(String((res.output as any).uploadUrl), 'http://localhost');
    const signedMax = Number(url.searchParams.get('max'));
    expect(signedMax).toBe(stepMaxFileSize);
    expect(signedMax).toBeLessThan(DEFAULT_MAX_UPLOAD_BYTES);

    // The narrowed max is still exactly what the route will re-verify against.
    const key = Buffer.from(url.searchParams.get('key')!, 'base64url').toString('utf8');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(verifyLocalUpload({ key, exp, max: signedMax }, sig, local.getPresignKey())).toBe(true);
  });
});
