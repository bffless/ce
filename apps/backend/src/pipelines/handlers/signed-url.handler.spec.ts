import { SignedUrlHandler, sanitizeDownloadFilename } from './signed-url.handler';

describe('sanitizeDownloadFilename', () => {
  it('passes a clean filename through', () => {
    expect(sanitizeDownloadFilename('my-video.mp4')).toBe('my-video.mp4');
  });

  it('reduces a path to its basename', () => {
    expect(sanitizeDownloadFilename('a/b/c/my-video.mp4')).toBe('my-video.mp4');
    expect(sanitizeDownloadFilename('a\\b\\my-video.mp4')).toBe('my-video.mp4');
  });

  it('strips quotes, backslashes and control characters', () => {
    expect(sanitizeDownloadFilename('ev"il\r\nX-Evil: 1.mp4')).toBe('evilX-Evil: 1.mp4');
  });

  it('returns undefined for empty, whitespace-only, or non-string input', () => {
    expect(sanitizeDownloadFilename('')).toBeUndefined();
    expect(sanitizeDownloadFilename('   ')).toBeUndefined();
    expect(sanitizeDownloadFilename('"')).toBeUndefined();
    expect(sanitizeDownloadFilename(undefined)).toBeUndefined();
    expect(sanitizeDownloadFilename(42)).toBeUndefined();
  });

  it('caps the length at 200 characters', () => {
    expect(sanitizeDownloadFilename('a'.repeat(500))).toHaveLength(200);
  });
});

describe('SignedUrlHandler', () => {
  let handler: SignedUrlHandler;
  let storageAdapter: { getUrl: jest.Mock };
  const registry = { register: jest.fn() } as any;
  const evaluator = {
    evaluateExpression: jest.fn((expr: string) =>
      expr === 'steps.resolvePath.storagePath'
        ? 'owner/repo/uploads/final.mp4'
        : expr === 'steps.resolvePath.filename'
          ? 'my-video.mp4'
          : expr === 'steps.resolvePath.empty'
            ? ''
            : expr,
    ),
  } as any;

  const step = (config: Record<string, unknown>) => ({ id: 'sign', name: 'sign', config }) as any;

  beforeEach(() => {
    storageAdapter = { getUrl: jest.fn().mockResolvedValue('https://signed') };
    handler = new SignedUrlHandler(registry, evaluator, storageAdapter as any);
  });

  it('passes a sanitized downloadFilename to the adapter', async () => {
    const result = await handler.execute(
      {} as any,
      step({
        path: 'steps.resolvePath.storagePath',
        filename: 'steps.resolvePath.filename',
      }),
    );

    expect(result.success).toBe(true);
    expect(storageAdapter.getUrl).toHaveBeenCalledWith('owner/repo/uploads/final.mp4', 3600, {
      downloadFilename: 'my-video.mp4',
    });
  });

  it('passes undefined options when filename is absent', async () => {
    await handler.execute({} as any, step({ path: 'steps.resolvePath.storagePath' }));

    expect(storageAdapter.getUrl).toHaveBeenCalledWith(
      'owner/repo/uploads/final.mp4',
      3600,
      undefined,
    );
  });

  it('passes undefined options when filename resolves to empty', async () => {
    await handler.execute(
      {} as any,
      step({
        path: 'steps.resolvePath.storagePath',
        filename: 'steps.resolvePath.empty',
      }),
    );

    expect(storageAdapter.getUrl).toHaveBeenCalledWith(
      'owner/repo/uploads/final.mp4',
      3600,
      undefined,
    );
  });

  it('accepts a literal filename', async () => {
    await handler.execute(
      {} as any,
      step({
        path: 'steps.resolvePath.storagePath',
        filename: 'literal.mp4',
      }),
    );

    expect(storageAdapter.getUrl).toHaveBeenCalledWith('owner/repo/uploads/final.mp4', 3600, {
      downloadFilename: 'literal.mp4',
    });
  });
});
