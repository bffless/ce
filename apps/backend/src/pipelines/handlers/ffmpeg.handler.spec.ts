/**
 * ffmpeg_handler — probe op + registration + guards. Storage-op tests live in
 * this file too from Task 7 on. Pattern per replicate.handler.spec.ts: direct
 * construction, literal collaborators cast `as never`, REAL ExpressionEvaluator.
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import type { PipelineContext } from '../execution/pipeline-context.interface';
import type { PipelineStep } from '../types';
import { FfmpegHandler } from './ffmpeg.handler';

function createHandler(
  overrides: {
    capability?: Partial<{
      isEnabled: () => boolean;
      isAvailable: () => boolean;
      getVersion: () => string | null;
      getOps: () => string[];
    }>;
    runner?: { run: jest.Mock };
    storageAdapter?: Partial<{
      downloadStream: jest.Mock;
      uploadStream: jest.Mock;
    }>;
  } = {},
) {
  const registry = { register: jest.fn() };
  const capability = {
    isEnabled: () => true,
    isAvailable: () => true,
    getVersion: () => 'ffmpeg version 6.1.1',
    getOps: () => ['probe', 'extract_audio', 'slice', 'concat'],
    ...overrides.capability,
  };
  const runner = overrides.runner ?? {
    run: jest.fn().mockResolvedValue({ stdout: '', stderrTail: '' }),
  };
  const scratch = {
    createJobDir: jest
      .fn()
      .mockImplementation(() => fsp.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hspec-'))),
    cleanup: jest.fn().mockResolvedValue(undefined),
    assertFreeSpace: jest.fn().mockResolvedValue(undefined),
  };
  const uploadRecord = {
    resolveOwnerRepo: jest.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
  };
  const storageAdapter = {
    download: jest.fn(),
    upload: jest.fn(),
    getMetadata: jest.fn().mockResolvedValue({ size: 1000 }),
    ...overrides.storageAdapter,
  };
  const handler = new FfmpegHandler(
    registry as never,
    new ExpressionEvaluator(),
    capability as never,
    runner as never,
    scratch as never,
    uploadRecord as never,
    storageAdapter as never,
  );
  return { handler, registry, runner, scratch, storageAdapter };
}

const context = () =>
  ({
    stepOutputs: {},
    metadata: { body: {}, headers: {} },
    projectId: 'p1',
  }) as unknown as PipelineContext;
const step = (config: Record<string, unknown>): PipelineStep =>
  ({
    id: 's1',
    name: 'video',
    handlerType: 'ffmpeg_handler',
    config,
    isEnabled: true,
  }) as unknown as PipelineStep;

describe('FfmpegHandler registration & validation', () => {
  it('self-registers with type ffmpeg_handler', () => {
    const { handler, registry } = createHandler();
    expect(handler.type).toBe('ffmpeg_handler');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('validateConfig rejects unknown operations and missing per-op fields', () => {
    const { handler } = createHandler();
    expect(() => handler.validateConfig({ operation: 'transcode' } as never)).toThrow(/operation/);
    expect(() => handler.validateConfig({ operation: 'extract_audio' } as never)).toThrow(/input/);
    expect(() =>
      handler.validateConfig({ operation: 'slice', input: 'a', output: 'b' } as never),
    ).toThrow(/spans/);
    expect(() => handler.validateConfig({ operation: 'concat', output: 'b' } as never)).toThrow(
      /inputs/,
    );
    // probe without input is valid (capability self-test)
    expect(() => handler.validateConfig({ operation: 'probe' } as never)).not.toThrow();
  });
});

describe('probe without input — the capability payload', () => {
  it('reports server=true with ops and version when enabled', async () => {
    const { handler } = createHandler();
    const result = await handler.execute(context(), step({ operation: 'probe' }));
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      server: true,
      ops: ['probe', 'extract_audio', 'slice', 'concat'],
      version: 'ffmpeg version 6.1.1',
    });
  });

  it('reports server=false and SUCCEEDS when the capability is off (never fails)', async () => {
    const { handler } = createHandler({
      capability: { isEnabled: () => false, getOps: () => [], getVersion: () => null },
    });
    const result = await handler.execute(context(), step({ operation: 'probe' }));
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ server: false, ops: [], version: null });
  });
});

describe('capability gating for real ops', () => {
  it('returns FFMPEG_UNAVAILABLE without touching the runner', async () => {
    const { handler, runner } = createHandler({ capability: { isEnabled: () => false } });
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'media/a.mp4', output: 'media/a.wav' }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_UNAVAILABLE');
    // extract_audio really invokes the runner once past the gate — this
    // assertion is only meaningful now that the gate is checked first.
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('extract_audio', () => {
  function extractSetup(overrides?: Parameters<typeof createHandler>[0]) {
    const created = createHandler(overrides);
    // The runner "produces" the output by writing the temp file the handler expects.
    created.runner.run.mockImplementation(
      async ({ args, cwd }: { args: string[]; cwd: string }) => {
        await fsp.writeFile(`${cwd}/${args[args.length - 1].split('/').pop()}`, 'wav-bytes');
        return { stdout: '', stderrTail: '' };
      },
    );
    return created;
  }

  it('streams in, runs the 16k mono wav argv, streams out, returns the contract shape', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    // downloadToFile falls back to download() when downloadStream is absent on the literal mock
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4-bytes'));
    storageAdapter.upload.mockResolvedValue('o/r/uploads/studio/a.wav');
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'studio/a.mp4', output: 'studio/a.wav' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/a.wav',
      content_type: 'audio/wav',
      size: expect.any(Number),
    });
    const req = runner.run.mock.calls[0][0];
    expect(req.binary).toBe('ffmpeg');
    expect(req.args).toEqual(
      expect.arrayContaining(['-vn', '-ac', '1', '-ar', '16000', '-f', 'wav']),
    );
  });

  it('uses the streaming download/upload branch when the adapter supports it', async () => {
    const downloadStream = jest
      .fn()
      .mockResolvedValue({ stream: Readable.from(Buffer.from('mp4-bytes')), size: 9 });
    const uploadStream = jest.fn().mockResolvedValue('o/r/uploads/studio/a.wav');
    const { handler, storageAdapter } = extractSetup({
      storageAdapter: { downloadStream, uploadStream },
    });
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'studio/a.mp4', output: 'studio/a.wav' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/a.wav',
      content_type: 'audio/wav',
      size: expect.any(Number),
    });
    expect(downloadStream).toHaveBeenCalledWith('o/r/uploads/studio/a.mp4');
    expect(uploadStream).toHaveBeenCalledWith(
      expect.any(Readable),
      'o/r/uploads/studio/a.wav',
      expect.any(Number),
      { mimeType: 'audio/wav' },
    );
    expect(storageAdapter.download).not.toHaveBeenCalled();
    expect(storageAdapter.upload).not.toHaveBeenCalled();
  });

  it('accepts /api/uploads/... input form and full storage keys', async () => {
    const { handler, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    const r1 = await handler.execute(
      context(),
      step({
        operation: 'extract_audio',
        input: '/api/uploads/studio/a.mp4',
        output: 'studio/a.wav',
      }),
    );
    expect(r1.success).toBe(true);
    expect(storageAdapter.download).toHaveBeenCalledWith('o/r/uploads/studio/a.mp4');
  });

  it('rejects traversal in input and output with typed errors', async () => {
    const { handler, runner } = createHandler();
    const bad1 = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: '../../etc/passwd', output: 'a.wav' }),
    );
    expect(bad1.error?.code).toBe('INVALID_INPUT_PATH');
    const bad2 = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: '../escape.wav' }),
    );
    expect(bad2.error?.code).toBe('INVALID_OUTPUT_PATH');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('missing input object → FILE_NOT_FOUND', async () => {
    const { handler, storageAdapter } = createHandler();
    storageAdapter.download.mockRejectedValue(new Error('File not found: o/r/uploads/a.mp4'));
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }),
    );
    expect(result.error?.code).toBe('FILE_NOT_FOUND');
  });

  it('always cleans up the scratch dir, even on runner failure', async () => {
    const { handler, runner, scratch, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    runner.run.mockRejectedValue(Object.assign(new Error('boom'), { code: 'FFMPEG_FAILED' }));
    await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }),
    );
    expect(scratch.createJobDir).toHaveBeenCalledTimes(1);
    expect(scratch.cleanup).toHaveBeenCalledTimes(1);
    expect(scratch.cleanup).toHaveBeenCalledWith(await scratch.createJobDir.mock.results[0].value);
  });

  it('an unrecognized runner error maps to FFMPEG_FAILED via the default toErrorResult path', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    runner.run.mockRejectedValue(new Error('some plain, uncoded ffmpeg error'));
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_FAILED');
  });
});

describe('probe with input', () => {
  it('parses ffprobe json into duration/format/streams', async () => {
    const { handler, runner, scratch, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    runner.run.mockResolvedValue({
      stdout: JSON.stringify({
        format: { duration: '232.5', format_name: 'mov,mp4' },
        streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
      }),
      stderrTail: '',
    });
    const result = await handler.execute(context(), step({ operation: 'probe', input: 'a.mp4' }));
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      duration: 232.5,
      streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
    });
    expect(runner.run.mock.calls[0][0].binary).toBe('ffprobe');
    // probe downloads the full input to scratch too — the disk pre-flight guard applies.
    expect(scratch.assertFreeSpace).toHaveBeenCalledTimes(1);
  });
});
