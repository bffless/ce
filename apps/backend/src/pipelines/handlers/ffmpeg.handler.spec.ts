/**
 * ffmpeg_handler — probe op + registration + guards. Storage-op tests live in
 * this file too from Task 7 on. Pattern per replicate.handler.spec.ts: direct
 * construction, literal collaborators cast `as never`, REAL ExpressionEvaluator.
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { Logger } from '@nestjs/common';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { EMPTY_TIMINGS, type FfmpegJob } from '../ffmpeg/executor/ffmpeg-executor.interface';
import type { PipelineContext } from '../execution/pipeline-context.interface';
import type { PipelineStep } from '../types';
import { DRAW_TEXT_EXPRESSION, FfmpegHandler, MAX_STILLS_PER_JOB } from './ffmpeg.handler';
import { EXPRESSION_ROOTS } from '../execution/expression-evaluator';

function createHandler(
  overrides: {
    capability?: Partial<{
      isEnabled: () => Promise<boolean>;
      isAvailable: () => boolean;
      getVersion: () => string | null;
      getOps: () => Promise<string[]>;
      hasFilter: (name: string) => boolean | undefined;
    }>;
    runner?: { run: jest.Mock };
    storageAdapter?: Partial<{
      downloadStream: jest.Mock;
      uploadStream: jest.Mock;
    }>;
    /** Omitted → the handler builds its own local-only selector (pre-remote behaviour). */
    selector?: { pick: jest.Mock; probe: jest.Mock };
  } = {},
) {
  const registry = { register: jest.fn() };
  const capability = {
    isEnabled: async () => true,
    isAvailable: () => true,
    getVersion: () => 'ffmpeg version 6.1.1',
    getOps: async () => ['probe', 'extract_audio', 'slice', 'concat', 'frames'],
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
    overrides.selector as never,
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

/**
 * Shared across extract_audio/slice/concat: the runner "produces" its output
 * by writing the temp file the handler expects into the cwd it was given.
 */
function extractSetup(overrides?: Parameters<typeof createHandler>[0]) {
  const created = createHandler(overrides);
  created.runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
    await fsp.writeFile(`${cwd}/${args[args.length - 1].split('/').pop()}`, 'wav-bytes');
    return { stdout: '', stderrTail: '' };
  });
  return created;
}

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
      ops: ['probe', 'extract_audio', 'slice', 'concat', 'frames'],
      version: 'ffmpeg version 6.1.1',
      executors: ['local'],
      defaultExecutor: 'local',
    });
  });

  it('reports server=false and SUCCEEDS when the capability is off (never fails)', async () => {
    const { handler } = createHandler({
      capability: { isEnabled: async () => false, getOps: async () => [], getVersion: () => null },
    });
    const result = await handler.execute(context(), step({ operation: 'probe' }));
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      server: false,
      ops: [],
      version: null,
      executors: ['local'],
      defaultExecutor: 'local',
    });
  });
});

describe('capability gating for real ops', () => {
  it('returns FFMPEG_UNAVAILABLE without touching the runner', async () => {
    const { handler, runner } = createHandler({ capability: { isEnabled: async () => false } });
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'media/a.mp4', output: 'media/a.wav' }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_UNAVAILABLE');
    expect(result.error?.message).toMatch(/disabled on this instance|ffmpeg is missing/);
    // extract_audio really invokes the runner once past the gate — this
    // assertion is only meaningful now that the gate is checked first.
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('extract_audio', () => {
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

describe('slice', () => {
  it('resolves span expressions, runs the trim graph, returns clip + optional wav', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const ctx = context();
    (ctx.metadata.body as Record<string, unknown>) = { start: 104, end: 228 };
    const result = await handler.execute(
      ctx,
      step({
        operation: 'slice',
        input: 'studio/src.mp4',
        spans: [{ start: 'request.body.start', end: 'request.body.end' }],
        output: 'studio/clip.mp4',
        audioOutput: 'studio/clip.wav',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/clip.mp4',
      content_type: 'video/mp4',
      duration: 124,
      audio: { storage_path: 'o/r/uploads/studio/clip.wav', content_type: 'audio/wav' },
    });
    // First run: the slice; second run: extract_audio ON THE CLIP (small, cheap).
    expect(runner.run).toHaveBeenCalledTimes(2);
    const sliceArgs = runner.run.mock.calls[0][0].args as string[];
    expect(sliceArgs).toEqual(expect.arrayContaining(['-filter_complex', '-copyts']));
    const wavArgs = runner.run.mock.calls[1][0].args as string[];
    expect(wavArgs).toEqual(expect.arrayContaining(['-ar', '16000']));
  });

  it('rejects malformed spans with INVALID_SPANS before any work', async () => {
    const { handler, runner } = createHandler();
    for (const spans of [
      [{ start: 5, end: 2 }],
      [{ start: 'nope', end: 3 }],
      [],
      'request.body.missing',
    ]) {
      const result = await handler.execute(
        context(),
        step({ operation: 'slice', input: 'a.mp4', spans, output: 'b.mp4' }),
      );
      expect(result.error?.code).toBe('INVALID_SPANS');
    }
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('accepts spans as an expression resolving to an array', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const ctx = context();
    ctx.stepOutputs['job'] = {
      spans: [
        { start: 0, end: 2 },
        { start: 5, end: 8 },
      ],
    };
    const result = await handler.execute(
      ctx,
      step({
        operation: 'slice',
        input: 'a.mp4',
        spans: 'steps.job.spans',
        output: 'b.mp4',
        audioFades: true,
      }),
    );
    expect(result.success).toBe(true);
    const args = runner.run.mock.calls[0][0].args as string[];
    expect(args.join(' ')).toContain('concat=n=2');
    expect(args.join(' ')).toContain('afade');
  });

  it('accepts spans authored as a JSON-array string (UI/MCP round-trip)', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const result = await handler.execute(
      context(),
      step({
        operation: 'slice',
        input: 'a.mp4',
        spans: '[{"start": 0, "end": 2}]',
        output: 'b.mp4',
      }),
    );
    expect(result.success).toBe(true);
    const args = runner.run.mock.calls[0][0].args as string[];
    expect(args).toEqual(expect.arrayContaining(['-filter_complex', '-copyts']));
  });
});

describe('concat', () => {
  it('stream-copies, writing a concat list into the job dir', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const result = await handler.execute(
      context(),
      step({
        operation: 'concat',
        inputs: ['studio/s1.mp4', 'studio/s2.mp4'],
        output: 'studio/final.mp4',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/final.mp4',
      content_type: 'video/mp4',
      reencoded: false,
    });
    const args = runner.run.mock.calls[0][0].args as string[];
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-c', 'copy']));
  });

  it('falls back to re-encode when stream-copy fails, and reports reencoded: true', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run
      .mockRejectedValueOnce(Object.assign(new Error('stream mismatch'), { code: 'FFMPEG_FAILED' }))
      .mockImplementationOnce(async ({ args, cwd }: { args: string[]; cwd: string }) => {
        await fsp.writeFile(`${cwd}/${args[args.length - 1].split('/').pop()}`, 'mp4');
        return { stdout: '', stderrTail: '' };
      });
    const result = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: ['a.mp4', 'b.mp4'], output: 'final.mp4' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ reencoded: true });
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('busy/timeout errors from the second (re-encode) attempt are NOT retried', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run.mockRejectedValue(Object.assign(new Error('busy'), { code: 'FFMPEG_BUSY' }));
    const result = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: ['a.mp4', 'b.mp4'], output: 'f.mp4' }),
    );
    expect(result.error?.code).toBe('FFMPEG_BUSY');
    expect(runner.run).toHaveBeenCalledTimes(1); // only FFMPEG_FAILED triggers the fallback
  });

  it('accepts inputs authored as a JSON-array string (UI/MCP round-trip)', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const result = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: '["a.mp4","b.mp4"]', output: 'final.mp4' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/final.mp4',
      content_type: 'video/mp4',
      reencoded: false,
    });
    const args = runner.run.mock.calls[0][0].args as string[];
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-c', 'copy']));
  });
});

/**
 * Regression for #669: an accepted async job enqueued, ran its post-steps, and
 * then went silent — no error, no watchdog, no timeout. The process watchdog
 * only covers the spawned ffmpeg; every await AROUND it (storage transfers, the
 * queue wait) was unbounded, so a stalled storage socket left the post-step
 * pending forever: the job row stayed 'running' and, because the execution log
 * is only persisted once post-steps resolve, the run left no trace at all.
 */
describe('step deadlines (#669)', () => {
  const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    try {
      await fn();
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  };

  /** Microtask flush — every collaborator on the pre-transfer path is a plain promise. */
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };

  it('fails a stalled storage download with FFMPEG_JOB_TIMEOUT naming the phase', async () => {
    await withEnv({ FFMPEG_IO_MAX_SECONDS: '5', FFMPEG_JOB_MAX_SECONDS: '600' }, async () => {
      jest.useFakeTimers();
      try {
        const { handler, scratch, storageAdapter, runner } = createHandler();
        scratch.createJobDir.mockResolvedValue('/tmp/ffmpeg-hspec-stall');
        storageAdapter.download.mockReturnValue(new Promise(() => {})); // socket stalls, never settles
        const done = handler.execute(
          context(),
          step({ operation: 'extract_audio', input: 'studio/a.mp4', output: 'studio/a.wav' }),
        );
        await flush();
        jest.advanceTimersByTime(5001);
        const result = await done;
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('FFMPEG_JOB_TIMEOUT');
        expect(result.error?.message).toMatch(/download/);
        expect(runner.run).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('fails a step whose ffmpeg run never settles with FFMPEG_JOB_TIMEOUT', async () => {
    await withEnv({ FFMPEG_IO_MAX_SECONDS: '600', FFMPEG_JOB_MAX_SECONDS: '5' }, async () => {
      jest.useFakeTimers();
      try {
        const { handler, scratch, storageAdapter, runner } = createHandler();
        scratch.createJobDir.mockResolvedValue('/tmp/ffmpeg-hspec-wedged');
        storageAdapter.download.mockResolvedValue(Buffer.from('mp4-bytes'));
        runner.run.mockReturnValue(new Promise(() => {})); // slot taken, promise never settles
        const done = handler.execute(
          context(),
          step({ operation: 'extract_audio', input: 'studio/a.mp4', output: 'studio/a.wav' }),
        );
        await flush();
        jest.advanceTimersByTime(5001);
        const result = await done;
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('FFMPEG_JOB_TIMEOUT');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('executor selection (remote)', () => {
  it('config.executor is expression-evaluated and routed; output carries executor + timings', async () => {
    const remoteRun = jest.fn().mockResolvedValue({
      executor: 'remote',
      stdout: '',
      stderrTail: '',
      commands: [{ id: 'extract', ran: true, exitCode: 0 }],
      outputs: [{ name: 'out.wav', key: 'o/r/uploads/studio/a.wav', bytes: 7 }],
      bytesIn: 3,
      bytesOut: 7,
      timings: { queueMs: 0, transferInMs: 1, ffmpegMs: 1, transferOutMs: 1, totalMs: 3 },
      worker: { version: '0.4.31', ffmpeg: '6' },
    });
    const selector = {
      pick: jest.fn().mockResolvedValue({ name: 'remote', argvThreads: () => 0, run: remoteRun }),
      probe: jest.fn(),
    };
    const { handler } = createHandler({ selector });
    const ctx = context();
    (ctx.metadata.body as Record<string, unknown>).executor = 'remote';
    const result = await handler.execute(
      ctx,
      step({
        operation: 'extract_audio',
        input: 'studio/a.mp4',
        output: 'studio/a.wav',
        executor: '{{request.body.executor}}',
      }),
    );
    expect(selector.pick).toHaveBeenCalledWith('remote');
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/a.wav',
      size: 7,
      executor: 'remote',
      bytesIn: 3,
      bytesOut: 7,
      timings: { totalMs: 3 },
    });
  });

  it('an unset executor asks the selector for the instance default', async () => {
    const selector = {
      pick: jest.fn().mockRejectedValue(
        Object.assign(new Error("executor 'local' is not enabled"), {
          code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
        }),
      ),
      probe: jest.fn(),
    };
    const { handler } = createHandler({ selector });
    await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }),
    );
    expect(selector.pick).toHaveBeenCalledWith(undefined);
  });

  it('an unavailable executor is FFMPEG_EXECUTOR_UNAVAILABLE', async () => {
    const selector = {
      pick: jest.fn().mockRejectedValue(
        Object.assign(new Error('executor remote is not enabled'), {
          code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
        }),
      ),
      probe: jest.fn(),
    };
    const { handler } = createHandler({ selector });
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav', executor: 'remote' }),
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: 'FFMPEG_EXECUTOR_UNAVAILABLE' },
    });
  });

  /**
   * No selector double: the REAL FfmpegExecutorSelector the handler builds for
   * itself, so this pins the ruled contract end-to-end — flag ON but nothing to
   * run on is FFMPEG_EXECUTOR_UNAVAILABLE, not the flag-off FFMPEG_UNAVAILABLE.
   */
  it('flag on, no local binaries and no FFMPEG_REMOTE_URL → FFMPEG_EXECUTOR_UNAVAILABLE', async () => {
    const saved = process.env.FFMPEG_REMOTE_URL;
    delete process.env.FFMPEG_REMOTE_URL;
    try {
      const { handler, runner } = createHandler({
        capability: { isEnabled: async () => true, isAvailable: () => false },
      });
      const result = await handler.execute(
        context(),
        step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }),
      );
      expect(result).toMatchObject({
        success: false,
        error: { code: 'FFMPEG_EXECUTOR_UNAVAILABLE' },
      });
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.FFMPEG_REMOTE_URL;
      else process.env.FFMPEG_REMOTE_URL = saved;
    }
  });

  it('probe without input returns the selector payload verbatim', async () => {
    const payload = {
      server: true,
      ops: ['probe'],
      version: 'v',
      executors: ['local', 'remote'],
      defaultExecutor: 'remote',
      remote: { ready: true, version: '0.4.31' },
    };
    const { handler } = createHandler({
      selector: { pick: jest.fn(), probe: jest.fn().mockResolvedValue(payload) },
    });
    expect((await handler.execute(context(), step({ operation: 'probe' }))).output).toEqual(
      payload,
    );
  });
});

/**
 * `frames` (Task 17b'). ONE op: capture stills, optionally DRAW one line of
 * text on each, optionally TILE them into sheets instead of uploading them
 * individually. A contact sheet is a configuration of it, not an operation.
 * The argv itself is Task 17a's (ffmpeg-args.spec.ts owns the escaping and
 * geometry proofs), so these tests pin the HANDLER: how many commands and
 * outputs a job carries, the keys they land on, the untrusted-config guards,
 * and the drawtext degrade fence (R77).
 */
type FrameOut = {
  time: number;
  storage_path: string;
  content_type: string;
  size: number;
};
type FramesOutput = { frames: FrameOut[]; count: number; drawn: boolean };
type SheetOut = {
  storage_path: string;
  content_type: string;
  size: number;
  times: number[];
  index: number;
  total: number;
  cols: number;
  rows: number;
};
type SheetsOutput = {
  sheets: SheetOut[];
  count: number;
  drawn: boolean;
  bytesIn: number;
  bytesOut: number;
};

/** Every argv the runner double saw, one joined string per command. */
const argvs = (runner: { run: jest.Mock }): string[] =>
  runner.run.mock.calls.map((c) => (c[0].args as string[]).join(' '));

describe('frames', () => {
  const framesStep = (over: Record<string, unknown> = {}) =>
    step({
      operation: 'frames',
      input: 'studio/src.mp4',
      outputPrefix: 'studio/shots',
      times: [1, 2.5, 3],
      ...over,
    });

  const setup = () => {
    const created = extractSetup();
    created.storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    return created;
  };

  it('contact_sheet is no longer an operation', () => {
    const { handler } = createHandler();
    expect(() =>
      handler.validateConfig({
        operation: 'contact_sheet',
        input: 'a',
        outputPrefix: 'p',
      } as never),
    ).toThrow(/operation/);
  });

  it('runs one command per time and returns one frame per time under the prefix', async () => {
    const created = setup();
    const { handler, runner } = created;
    const result = await handler.execute(context(), framesStep());
    expect(result.success).toBe(true);
    const out = result.output as unknown as FramesOutput;
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(out.count).toBe(3);
    expect(out.drawn).toBe(false);
    expect(out.frames.map((f) => f.storage_path)).toEqual([
      'o/r/uploads/studio/shots/frame-01.jpg',
      'o/r/uploads/studio/shots/frame-02.jpg',
      'o/r/uploads/studio/shots/frame-03.jpg',
    ]);
    // The REQUESTED time, unchanged — a downstream step re-captures from it.
    expect(out.frames.map((f) => f.time)).toEqual([1, 2.5, 3]);
    expect(out.frames.every((f) => f.content_type === 'image/jpeg')).toBe(true);
    expect(out.frames.every((f) => typeof f.size === 'number')).toBe(true);
    // Nothing but the stills is ever DECLARED as a job output, so nothing else
    // is uploaded — a regression that declared the cells/scratch files while
    // leaving argv bare would keep every argv assertion green and still ship
    // junk objects into the bucket.
    expect(created.storageAdapter.upload).toHaveBeenCalledTimes(3);
    expect(created.storageAdapter.upload.mock.calls.map((c) => c[1])).toEqual(
      out.frames.map((f) => f.storage_path),
    );
    // No `draw` block → no drawtext anywhere in the job.
    expect(argvs(runner).some((a) => a.includes('drawtext'))).toBe(false);
    expect(argvs(runner)[0]).toContain('scale=-2:720');
    // R80: every ffmpeg command carries its own ceiling.
    expect(runner.run.mock.calls[0][0].timeoutSeconds).toBe(120);
    // R107: and every still refuses to exit 0 having encoded nothing.
    expect(runner.run.mock.calls[0][0].args).toEqual(
      expect.arrayContaining(['-abort_on', 'empty_output']),
    );
  });

  it('honours height/quality and tolerates a trailing slash on outputPrefix', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      framesStep({ outputPrefix: 'studio/shots/', height: 360, quality: 5, times: [1] }),
    );
    expect(result.success).toBe(true);
    expect((result.output as unknown as FramesOutput).frames[0].storage_path).toBe(
      'o/r/uploads/studio/shots/frame-01.jpg',
    );
    expect(argvs(runner)[0]).toContain('scale=-2:360');
    expect(runner.run.mock.calls[0][0].args).toEqual(expect.arrayContaining(['-q:v', '5']));
  });

  it('accepts times as an expression, as a JSON string, and as literal expressions', async () => {
    const { handler, runner } = setup();
    const ctx = context();
    ctx.stepOutputs['job'] = { times: [4, 9] };
    expect((await handler.execute(ctx, framesStep({ times: 'steps.job.times' }))).success).toBe(
      true,
    );
    expect(runner.run).toHaveBeenCalledTimes(2);
    const json = await handler.execute(context(), framesStep({ times: '[7]' }));
    expect((json.output as unknown as FramesOutput).frames[0].time).toBe(7);
    (ctx.metadata.body as Record<string, unknown>).at = 12;
    const expr = await handler.execute(ctx, framesStep({ times: ['request.body.at'] }));
    expect((expr.output as unknown as FramesOutput).frames[0].time).toBe(12);
  });

  it('rejects a non-array, an empty array and non-finite/negative times with INVALID_TIMES', async () => {
    const { handler, runner } = setup();
    for (const times of [[], 'request.body.missing', [-1], ['nope'], [1, NaN]]) {
      const result = await handler.execute(context(), framesStep({ times }));
      expect(result.error?.code).toBe('INVALID_TIMES');
    }
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('widens the zero-pad uniformly past 99 frames (R82)', async () => {
    const { handler } = setup();
    const times = Array.from({ length: 100 }, (_, i) => i);
    const out = (await handler.execute(context(), framesStep({ times })))
      .output as unknown as FramesOutput;
    expect(out.frames[0].storage_path).toBe('o/r/uploads/studio/shots/frame-001.jpg');
    expect(out.frames[99].storage_path).toBe('o/r/uploads/studio/shots/frame-100.jpg');
  });

  it('rejects traversal in outputPrefix with INVALID_OUTPUT_PATH', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), framesStep({ outputPrefix: '../escape' }));
    expect(result.error?.code).toBe('INVALID_OUTPUT_PATH');
    expect(runner.run).not.toHaveBeenCalled();
  });

  /**
   * `times` is expression-resolvable (`request.body.times` is an advertised
   * form), and each entry is a sequential ffmpeg spawn whose still piles up in
   * scratch before anything is uploaded — so its length is a resource decision
   * made by untrusted input unless something caps it. It is now the ONE cap:
   * with the planner gone, sheets are `times.length / perSheet`, so capping
   * the stills caps the sheets too.
   */
  it('refuses more stills than MAX_STILLS_PER_JOB before spawning anything', async () => {
    const { handler, runner } = setup();
    const times = Array.from({ length: MAX_STILLS_PER_JOB + 1 }, (_, i) => i);
    const result = await handler.execute(context(), framesStep({ times }));
    expect(result.error?.code).toBe('INVALID_TIMES');
    expect(result.error?.message).toContain(String(MAX_STILLS_PER_JOB));
    expect(result.error?.message).toContain(String(MAX_STILLS_PER_JOB + 1));
    expect(runner.run).not.toHaveBeenCalled();
  });

  /**
   * The op's most likely real-world failure: `times` is exactly the field a
   * person or an LLM hand-writes, and ffmpeg writes NO file at all for a seek
   * past the end of the source. Without help that surfaces as a bare ENOENT
   * naming a scratch path nobody has heard of.
   */
  it('names the frame ffmpeg never wrote when a time is past the end of the source', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
      const name = args[args.length - 1].split('/').pop();
      // Everything but frame-02 lands: that seek was past EOF.
      if (name !== 'frame-02.jpg') await fsp.writeFile(`${cwd}/${name}`, 'jpeg-bytes');
      return { stdout: '', stderrTail: '' };
    });
    const result = await handler.execute(context(), framesStep({ times: [1, 99999, 3] }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(result.error?.message).toContain('frames');
    expect(result.error?.message).toContain('frame-02.jpg');
    expect(result.error?.message).toMatch(/past the end of the source/);
    // Documented consequence: the stills captured BEFORE it are already in the
    // bucket. A run's outputPrefix is disposable, not a directory to append to.
    expect(storageAdapter.upload).toHaveBeenCalledTimes(1);
  });
});

/**
 * `draw` — the whole point of 17b': CE owns the ability to DRAW, not the
 * ability to draw a contact sheet. A title on a single screenshot is
 * `times: [12.5]` + a `draw` + no `tile`.
 */
describe('frames draw', () => {
  const drawStep = (draw: unknown, over: Record<string, unknown> = {}) =>
    step({
      operation: 'frames',
      input: 'studio/src.mp4',
      outputPrefix: 'studio/shots',
      times: [1, 2, 3],
      draw,
      ...over,
    });

  const setup = () => {
    const created = extractSetup();
    created.storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    return created;
  };

  it('a single string draws the SAME text on every frame', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), drawStep({ text: 'Chapter One' }));
    expect(result.success).toBe(true);
    expect((result.output as unknown as FramesOutput).drawn).toBe(true);
    expect(argvs(runner)).toHaveLength(3);
    expect(argvs(runner).every((a) => a.includes('drawtext'))).toBe(true);
    expect(argvs(runner).every((a) => a.includes('text=Chapter One'))).toBe(true);
    // Defaults from 17a': bottom-right, h/12, white, boxed.
    expect(argvs(runner)[0]).toContain('fontcolor=white');
    expect(argvs(runner)[0]).toContain('box=1');
  });

  /**
   * The pairing is the assertion, not the presence: an implementation that
   * drew texts[0] on all three frames would pass a "contains drawtext" check
   * and silently mislabel every still.
   */
  it('an array draws ITS OWN text on each frame, in order', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      drawStep({ text: ['first', 'second', 'third'] }),
    );
    expect(result.success).toBe(true);
    const drawn = argvs(runner).map((a) => /drawtext=text=([^:]*)/.exec(a)?.[1]);
    expect(drawn).toEqual(['first', 'second', 'third']);
  });

  it('an array of the wrong length is a config error naming BOTH lengths', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), drawStep({ text: ['only one'] }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONFIGURATION_ERROR');
    expect(result.error?.message).toContain('1');
    expect(result.error?.message).toContain('3');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('resolves a BARE expression to either a string or an array', async () => {
    const { handler, runner } = setup();
    const ctx = context();
    ctx.stepOutputs['job'] = { title: 'From a step', labels: ['a', 'b', 'c'] };
    expect((await handler.execute(ctx, drawStep({ text: 'steps.job.title' }))).success).toBe(true);
    expect(argvs(runner).every((a) => a.includes('text=From a step'))).toBe(true);
    runner.run.mockClear();
    expect((await handler.execute(ctx, drawStep({ text: 'steps.job.labels' }))).success).toBe(true);
    expect(argvs(runner).map((a) => /drawtext=text=([^:]*)/.exec(a)?.[1])).toEqual(['a', 'b', 'c']);
  });

  /**
   * The counterpart of the expression path: prose that merely STARTS with an
   * expression root ("user guide", "request received") is text, not a lookup.
   * Resolving it would either throw on a missing property or draw the wrong
   * thing — the silent-wrong-image failure this whole file keeps fencing.
   */
  it('draws prose that starts with an expression root verbatim', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), drawStep({ text: 'user guide' }));
    expect(result.success).toBe(true);
    expect(argvs(runner).every((a) => a.includes('text=user guide'))).toBe(true);
  });

  it('rejects a {{template}} clearly instead of drawing it verbatim', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), drawStep({ text: '{{steps.job.title}}' }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONFIGURATION_ERROR');
    expect(result.error?.message).toMatch(/\{\{/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('passes position/size/color/background through to the overlay argv', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      drawStep(
        { text: 'x', position: 'top-left', size: 0.25, color: '#ff0000', background: false },
        { times: [1] },
      ),
    );
    expect(result.success).toBe(true);
    const argv = argvs(runner)[0];
    expect(argv).toContain('fontsize=h*0.25');
    expect(argv).toContain('fontcolor=#ff0000');
    expect(argv).toContain('x=16');
    expect(argv).not.toContain('box=1');
  });

  /**
   * Config arrives as YAML/JSON, where `background: 'false'` is a string that
   * a truthiness test would treat as ON — the exact silent-wrong-image bug the
   * old `label` knob had to fix.
   */
  it('coerces the STRING forms of background, and rejects a non-boolean', async () => {
    const { handler, runner } = setup();
    const off = await handler.execute(
      context(),
      drawStep({ text: 'x', background: 'false' }, { times: [1] }),
    );
    expect(off.success).toBe(true);
    expect(argvs(runner)[0]).not.toContain('box=1');
    const bad = await handler.execute(
      context(),
      drawStep({ text: 'x', background: 'maybe' }, { times: [1] }),
    );
    expect(bad.error?.code).toBe('CONFIGURATION_ERROR');
    expect(bad.error?.message).toMatch(/draw\.background/);
  });

  /**
   * Ruling R103: `ffmpeg-args.ts` throws a plain Error for an authored value
   * out of range. The handler must map that to the typed config error the
   * pipeline contract promises, naming the field — a caller gets one fixable
   * config error rather than a generic handler failure.
   */
  it('maps a bad colour / size / position to a ConfigurationError naming the field', () => {
    const { handler } = createHandler();
    const base = {
      operation: 'frames',
      input: 'a.mp4',
      outputPrefix: 'p',
      times: [1],
    };
    expect(() =>
      handler.validateConfig({ ...base, draw: { text: 'x', color: 'white@0.5' } } as never),
    ).toThrow(/draw\.color/);
    expect(() =>
      handler.validateConfig({ ...base, draw: { text: 'x', size: 3 } } as never),
    ).toThrow(/draw\.size/);
    expect(() =>
      handler.validateConfig({ ...base, draw: { text: 'x', position: 'middle' } } as never),
    ).toThrow(/draw\.position/);
    expect(() => handler.validateConfig({ ...base, draw: null } as never)).toThrow(/draw/);
    expect(() =>
      handler.validateConfig({ ...base, draw: { text: 'x', size: 'big' } } as never),
    ).toThrow(/draw\.size/);
  });

  /**
   * Ruling R106. The shape test cannot tell `metadata.json` from a path — and
   * filenames are a very common thing to draw on a frame — so an AUTHORED
   * array is always literals. This is the escape hatch, and it is the only
   * thing that makes such a text drawable at all.
   */
  it('an authored array is always LITERAL, never resolved (R106)', async () => {
    const { handler, runner } = setup();
    const ctx = context();
    ctx.stepOutputs['job'] = { title: 'resolved!' };
    const result = await handler.execute(
      ctx,
      drawStep({ text: ['metadata.json', 'steps.job.title', 'user.manual.pdf'] }),
    );
    expect(result.success).toBe(true);
    expect(argvs(runner).map((a) => /drawtext=text=([^:]*)/.exec(a)?.[1])).toEqual([
      'metadata.json',
      // NOT 'resolved!': entries of an authored array are drawn as written.
      'steps.job.title',
      'user.manual.pdf',
    ]);
  });

  /**
   * The other half of R106: a path-shaped STRING that resolves to nothing used
   * to fail as "draw.text is required when draw is present" for a `draw.text`
   * that was plainly set. Name the string, say it was read as an expression,
   * and point at the array form.
   */
  it('says WHY a path-shaped literal resolved to nothing, and how to draw it', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), drawStep({ text: 'metadata.json' }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONFIGURATION_ERROR');
    expect(result.error?.message).toContain('metadata.json');
    expect(result.error?.message).toMatch(/shape of an expression/);
    expect(result.error?.message).toMatch(/\["metadata\.json"\]/);
    expect(result.error?.message).not.toMatch(/is required/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  /**
   * The shape test must not be NARROWER than the evaluator without saying so:
   * `parsePath` documents quoted bracket keys, so a step name with a space
   * resolves rather than being drawn verbatim.
   */
  it('resolves the bracket forms parsePath documents', async () => {
    const { handler, runner } = setup();
    const ctx = context();
    ctx.stepOutputs['chapter one'] = { title: 'From a quoted key' };
    (ctx.metadata.headers as Record<string, unknown>)['x-title'] = 'From a header';
    const quoted = await handler.execute(ctx, drawStep({ text: "steps['chapter one'].title" }));
    expect(quoted.success).toBe(true);
    expect(argvs(runner).every((a) => a.includes('text=From a quoted key'))).toBe(true);
    runner.run.mockClear();
    const header = await handler.execute(ctx, drawStep({ text: "request.headers['x-title']" }));
    expect(header.success).toBe(true);
    expect(argvs(runner).every((a) => a.includes('text=From a header'))).toBe(true);
  });

  /**
   * The regex is BUILT from the evaluator's exported roots rather than
   * hand-copied, so a new root there cannot silently start drawing as literal
   * text here. This asserts the wiring, not a duplicated list.
   */
  it('accepts a path under every root the evaluator itself accepts', () => {
    expect(EXPRESSION_ROOTS.length).toBeGreaterThan(0);
    for (const root of EXPRESSION_ROOTS) {
      expect(DRAW_TEXT_EXPRESSION.test(`${root}.some.field`)).toBe(true);
    }
    // …and prose starting with one of them is still text.
    expect(DRAW_TEXT_EXPRESSION.test('user guide')).toBe(false);
  });

  it('rejects a draw block whose text is missing or wrong-typed at CONFIG time', () => {
    const { handler } = createHandler();
    const base = { operation: 'frames', input: 'a.mp4', outputPrefix: 'p', times: [1] };
    expect(() => handler.validateConfig({ ...base, draw: {} } as never)).toThrow(/draw\.text/);
    expect(() => handler.validateConfig({ ...base, draw: { text: true } } as never)).toThrow(
      /draw\.text/,
    );
    expect(() => handler.validateConfig({ ...base, draw: { text: ['ok', {}] } } as never)).toThrow(
      /draw\.text/,
    );
    expect(() =>
      handler.validateConfig({ ...base, draw: { text: '{{steps.a.b}}' } } as never),
    ).toThrow(/draw\.text/);
  });

  it('a bad draw that slipped past validateConfig still cannot reach argv', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      drawStep({ text: 'x', color: 'white@0.5:x=0' }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONFIGURATION_ERROR');
    expect(runner.run).not.toHaveBeenCalled();
  });
});

/**
 * `tile` — a contact sheet, expressed as configuration. The stills stay
 * SCRATCH-ONLY (R75: bare scratch-relative filenames, since both executors
 * reject an undeclared `{out:}` placeholder and both spawn with cwd = scratch)
 * and only the sheets are uploaded.
 */
describe('frames tile', () => {
  const tileStep = (over: Record<string, unknown> = {}) =>
    step({
      operation: 'frames',
      input: 'studio/src.mp4',
      outputPrefix: 'studio/sheets',
      times: Array.from({ length: 12 }, (_, i) => i * 5),
      tile: { perSheet: 6, columns: 3 },
      ...over,
    });

  const setup = () => {
    const created = extractSetup();
    created.storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    return created;
  };

  it('captures every still into scratch and uploads ONLY the sheets', async () => {
    const created = setup();
    const { handler, runner } = created;
    const result = await handler.execute(context(), tileStep());
    expect(result.success).toBe(true);
    const out = result.output as unknown as SheetsOutput;
    expect(out.count).toBe(12);
    expect(out.drawn).toBe(false);
    expect(out.sheets).toHaveLength(2);
    expect(runner.run).toHaveBeenCalledTimes(14); // 12 cells + 2 tiles
    expect(out.sheets[0]).toMatchObject({
      storage_path: 'o/r/uploads/studio/sheets/sheet-01.jpg',
      content_type: 'image/jpeg',
      index: 0,
      total: 2,
      cols: 3,
      rows: 2,
    });
    expect(out.sheets[0].times).toEqual([0, 5, 10, 15, 20, 25]);
    expect(out.sheets[1].storage_path).toBe('o/r/uploads/studio/sheets/sheet-02.jpg');
    // The teeth: only the SHEETS are declared job outputs, so the 12 cells
    // sitting in the same scratch dir are never shipped to a customer bucket.
    expect(created.storageAdapter.upload).toHaveBeenCalledTimes(2);
    expect(
      created.storageAdapter.upload.mock.calls.every((c) =>
        /\/sheet-\d+\.jpg$/.test(c[1] as string),
      ),
    ).toBe(true);
    // Cells are addressed by a BARE scratch-relative name (R75), and the
    // `%0Wd` glob width matches the names (R82).
    const cellOutputs = runner.run.mock.calls
      .slice(0, 12)
      .map((c) => (c[0].args as string[])[(c[0].args as string[]).length - 1]);
    expect(cellOutputs.every((t) => !t.startsWith('{out:'))).toBe(true);
    expect(cellOutputs[0]).toBe('cell-001.jpg');
    expect(cellOutputs[11]).toBe('cell-012.jpg');
    expect(argvs(runner)[12]).toContain('cell-%03d.jpg');
    expect(argvs(runner)[12]).toContain('tile=3x2');
    // R80 on the tile commands too.
    expect(runner.run.mock.calls[12][0].timeoutSeconds).toBe(120);
    // R107 lives on the CELL commands, which is the only placement that
    // closes the gap — measured: the same flag on the tile command does not
    // fire on a gapped sequence.
    expect(
      runner.run.mock.calls
        .slice(0, 12)
        .every((c) => (c[0].args as string[]).includes('-abort_on')),
    ).toBe(true);
  });

  /**
   * A short final sheet lays out at its OWN width — 2 cells under
   * `columns: 3` are 2 wide, not 3 — and `buildTileArgs` must be handed that
   * narrower value, not the config knob. `-start_number` is the sheet's first
   * cell, 1-based.
   */
  it('a short final sheet gets its own cols/rows and start_number', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      tileStep({ times: [0, 1, 2, 3, 4, 5, 6, 7], tile: { perSheet: 6, columns: 3 } }),
    );
    const out = result.output as unknown as SheetsOutput;
    expect(out.sheets.map((s) => [s.cols, s.rows])).toEqual([
      [3, 2],
      [2, 1],
    ]);
    expect(out.sheets[1].times).toEqual([6, 7]);
    const tiles = runner.run.mock.calls.slice(8).map((c) => c[0].args as string[]);
    expect(tiles[0]).toEqual(expect.arrayContaining(['-start_number', '1']));
    expect(tiles[1]).toEqual(expect.arrayContaining(['-start_number', '7']));
    expect(tiles[0].join(' ')).toContain('tile=3x2');
    expect(tiles[1].join(' ')).toContain('tile=2x1');
  });

  it('defaults columns to 3 and requires perSheet', () => {
    const { handler } = createHandler();
    const base = { operation: 'frames', input: 'a.mp4', outputPrefix: 'p', times: [1] };
    expect(() => handler.validateConfig({ ...base, tile: { columns: 3 } } as never)).toThrow(
      /tile\.perSheet/,
    );
    expect(() => handler.validateConfig({ ...base, tile: { perSheet: 4 } } as never)).not.toThrow();
  });

  /**
   * Ruling R103, as it EXPIRES: `buildTileArgs` clamps `columns`/`count`
   * because the planner derived them. Coming from a caller's `tile:` block
   * they are authored config, so `columns: 0` silently clamping to 1 would
   * produce a 1xN strip instead of an error. Authored values throw at the
   * edge; the clamp stays the unreachable guard its TSDoc claims to be.
   */
  it('throws rather than clamping a bad perSheet/columns', () => {
    const { handler } = createHandler();
    const base = { operation: 'frames', input: 'a.mp4', outputPrefix: 'p', times: [1] };
    for (const tile of [
      { perSheet: 6, columns: 0 },
      { perSheet: 6, columns: 2.5 },
      { perSheet: 6, columns: 'three' },
      { perSheet: 0 },
      { perSheet: -1 },
      { perSheet: 2.5 },
      { perSheet: true },
    ]) {
      expect(() => handler.validateConfig({ ...base, tile } as never)).toThrow(/ffmpeg_handler/);
    }
    // Numeric strings are legitimate — config arrives as YAML/JSON.
    expect(() =>
      handler.validateConfig({ ...base, tile: { perSheet: '6', columns: '4' } } as never),
    ).not.toThrow();
    expect(() => handler.validateConfig({ ...base, tile: 6 } as never)).toThrow(/tile/);
  });

  it('names the SHEET ffmpeg never wrote instead of a bare scratch path', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
      const name = args[args.length - 1].split('/').pop();
      if (name !== 'sheet-02.jpg') await fsp.writeFile(`${cwd}/${name}`, 'jpeg-bytes');
      return { stdout: '', stderrTail: '' };
    });
    const result = await handler.execute(context(), tileStep());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(result.error?.message).toContain('sheet-02.jpg');
  });

  /**
   * Ruling R107 — the failure `tile` mode could not see. A cell is not a
   * declared output, so nothing stats it: on an ffmpeg that exits 0 for a
   * past-EOF seek the gap reached the tile pass, `image2` stopped at the hole
   * and `tile` padded the rest, and the step SUCCEEDED with a sheet of
   * `0x111111` squares whose `times` claimed real frames. `-abort_on
   * empty_output` on the still command makes that cell fail instead, so the
   * gap can never reach tiling.
   */
  it('a still that encodes nothing fails the step instead of tiling a padded sheet', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
      const name = args[args.length - 1].split('/').pop() as string;
      if (name === 'cell-003.jpg') {
        // Exactly what the local runner raises on exit 234: ffmpeg's last
        // stderr line, which names no file.
        throw Object.assign(
          new Error(
            'ffmpeg exited with code 234: [out#0/image2] Output file is empty, nothing was encoded(check -ss / -t / -frames parameters if used)',
          ),
          {
            code: 'FFMPEG_FAILED',
            exitCode: 234,
            stderrTail: '[out#0/image2] Output file is empty, nothing was encoded',
          },
        );
      }
      await fsp.writeFile(`${cwd}/${name}`, 'jpeg-bytes');
      return { stdout: '', stderrTail: '' };
    });
    const result = await handler.execute(context(), tileStep());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(result.error?.message).toMatch(/past the end of the source/);
    // It stopped AT the cell: no tile command ran and no sheet was uploaded.
    expect(argvs(runner).some((a) => a.includes('tile='))).toBe(false);
    expect(storageAdapter.upload).not.toHaveBeenCalled();
  });

  it('names the failing cell when the executor identifies it', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
      const name = args[args.length - 1].split('/').pop() as string;
      if (name === 'cell-003.jpg') {
        // The remote Worker names the command that failed; the local runner
        // does not. Cells are in the known-name list either way (R107).
        throw Object.assign(new Error('command cell-003 failed: empty_output'), {
          code: 'FFMPEG_FAILED',
          stderrTail: 'Output file is empty',
        });
      }
      await fsp.writeFile(`${cwd}/${name}`, 'jpeg-bytes');
      return { stdout: '', stderrTail: '' };
    });
    const result = await handler.execute(context(), tileStep());
    expect(result.error?.message).toContain('cell-003');
    expect(result.error?.message).toMatch(/past the end of the source/);
  });

  it('draws on the cells, never on the sheets', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      tileStep({ draw: { text: 'ts' }, times: [0, 1, 2], tile: { perSheet: 3 } }),
    );
    expect((result.output as unknown as SheetsOutput).drawn).toBe(true);
    expect(
      argvs(runner)
        .slice(0, 3)
        .every((a) => a.includes('drawtext')),
    ).toBe(true);
    expect(argvs(runner)[3]).not.toContain('drawtext');
  });
});

/**
 * R77 — the drawtext degrade. The local `-filters` probe may only SUPPRESS a
 * draw, and only for the LOCAL executor: a remote-only instance has no local
 * ffmpeg at all, so gating on that probe alone would mean it never draws. The
 * universal net is the one-shot retry without the overlay.
 */
describe('frames draw degrade (R77)', () => {
  /** A selector double whose executor identity and failures this test controls. */
  const withExecutor = (
    name: 'local' | 'remote',
    run: jest.Mock,
    hasFilter?: (n: string) => boolean | undefined,
  ) =>
    createHandler({
      selector: {
        pick: jest.fn().mockResolvedValue({ name, argvThreads: () => 1, run }),
        probe: jest.fn(),
      },
      ...(hasFilter ? { capability: { hasFilter } } : {}),
    });

  const jobResult = (job: FfmpegJob) => ({
    executor: 'local' as const,
    stdout: '',
    stderrTail: '',
    commands: job.commands.map((c) => ({ id: c.id, ran: true, exitCode: 0 })),
    outputs: job.outputs.map((o) => ({ name: o.name, key: o.key, bytes: 11 })),
    bytesIn: 5,
    bytesOut: 11 * job.outputs.length,
    timings: EMPTY_TIMINGS,
  });
  const runOk = () => jest.fn(async (job: FfmpegJob) => jobResult(job));
  const drawtextFailure = () =>
    Object.assign(new Error('ffmpeg exited with code 1: No such filter: drawtext'), {
      code: 'FFMPEG_FAILED',
      stderrTail: "[AVFilterGraph] No such filter: 'drawtext'",
    });
  const drawStep = (over: Record<string, unknown> = {}) =>
    step({
      operation: 'frames',
      input: 'a.mp4',
      outputPrefix: 'shots',
      times: [1, 2, 3],
      draw: { text: 'hello' },
      ...over,
    });
  const drew = (run: jest.Mock, call = 0): boolean =>
    (run.mock.calls[call][0] as FfmpegJob).commands.some((c) =>
      c.argv.join(' ').includes('drawtext'),
    );

  it('a LOCAL executor whose ffmpeg has no drawtext never attempts a draw', async () => {
    const run = runOk();
    const { handler } = withExecutor('local', run, () => false);
    const result = await handler.execute(context(), drawStep());
    expect(result.success).toBe(true);
    expect((result.output as unknown as FramesOutput).drawn).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(drew(run)).toBe(false);
  });

  it('an unknown local filter set (undefined) still attempts the draw', async () => {
    const run = runOk();
    const { handler } = withExecutor('local', run, () => undefined);
    const result = await handler.execute(context(), drawStep());
    expect((result.output as unknown as FramesOutput).drawn).toBe(true);
    expect(drew(run)).toBe(true);
  });

  it('a REMOTE executor draws even when THIS box has no drawtext', async () => {
    const run = runOk();
    const { handler } = withExecutor('remote', run, () => false);
    const result = await handler.execute(context(), drawStep());
    expect((result.output as unknown as FramesOutput).drawn).toBe(true);
    expect(drew(run)).toBe(true);
  });

  it('no draw block at all reports drawn:false and never retries', async () => {
    const run = jest.fn().mockRejectedValue(drawtextFailure());
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), drawStep({ draw: undefined }));
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(run).toHaveBeenCalledTimes(1);
    expect(drew(run)).toBe(false);
  });

  /**
   * The sniff reads ffmpeg's OWN stderr, never CE's error message: an input
   * path containing "drawtext" must not cost a full un-drawn re-run.
   */
  it('does not retry when only the CE-side message mentions drawtext', async () => {
    const run = jest.fn().mockRejectedValue(
      Object.assign(new Error('input not found in storage: o/r/uploads/drawtext-demo.mp4'), {
        code: 'FFMPEG_FAILED',
        stderrTail: 'moov atom not found',
      }),
    );
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), drawStep());
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries ONCE without the overlay when the job fails on drawtext, and warns', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(drawtextFailure())
      .mockImplementation(async (job: FfmpegJob) => jobResult(job));
    const { handler } = withExecutor('remote', run);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const result = await handler.execute(context(), drawStep());
      expect(result.success).toBe(true);
      const out = result.output as unknown as FramesOutput;
      expect(out.drawn).toBe(false);
      expect(out.frames).toHaveLength(3);
      expect(run).toHaveBeenCalledTimes(2);
      expect(drew(run, 0)).toBe(true);
      expect(drew(run, 1)).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ffmpeg_frames_drawtext_missing' }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The sniff is `drawtext` alone, not "no such filter": an ffmpeg missing
   * `tile` would otherwise buy a full undrawn re-run of a job that can be 400
   * commands long and then fail in exactly the same way, since dropping the
   * overlay cannot conjure a different filter.
   */
  it('does not retry a missing filter that is NOT drawtext', async () => {
    const run = jest.fn().mockRejectedValue(
      Object.assign(new Error('ffmpeg exited with code 1: No such filter: tile'), {
        code: 'FFMPEG_FAILED',
        stderrTail: "[AVFilterGraph] No such filter: 'tile'",
      }),
    );
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), drawStep());
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a second drawtext failure propagates as FFMPEG_FAILED', async () => {
    const run = jest.fn().mockRejectedValue(drawtextFailure());
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), drawStep());
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('an unrelated FFMPEG_FAILED is NOT retried', async () => {
    const run = jest.fn().mockRejectedValue(
      Object.assign(new Error('ffmpeg exited with code 1: Invalid data found'), {
        code: 'FFMPEG_FAILED',
        stderrTail: 'moov atom not found',
      }),
    );
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), drawStep());
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('untrusted numeric config knobs', () => {
  it('validateConfig requires the per-op fields', () => {
    const { handler } = createHandler();
    expect(() =>
      handler.validateConfig({ operation: 'frames', times: [1], outputPrefix: 'p' } as never),
    ).toThrow(/input/);
    expect(() =>
      handler.validateConfig({ operation: 'frames', input: 'a', outputPrefix: 'p' } as never),
    ).toThrow(/times/);
    expect(() =>
      handler.validateConfig({ operation: 'frames', input: 'a', times: [1] } as never),
    ).toThrow(/outputPrefix/);
    expect(() =>
      handler.validateConfig({
        operation: 'frames',
        input: 'a',
        times: [1],
        outputPrefix: 'p',
      } as never),
    ).not.toThrow();
  });

  /**
   * Pipeline config is authored as YAML/JSON by a user, so `2.5`, `"3"` and
   * `true` are all reachable — and a non-integer `height` reaches ffmpeg as
   * `scale=-2:2.5`, which it rejects at runtime. Guard at the boundary.
   */
  it('rejects non-integer / non-positive / non-numeric knobs at config time', () => {
    const { handler } = createHandler();
    const base = { operation: 'frames', input: 'a', outputPrefix: 'p', times: [1] };
    for (const bad of [
      { height: 0 },
      { height: -720 },
      { height: 'tall' },
      { height: 2.5 },
      { quality: 1.5 },
      { quality: true },
    ]) {
      expect(() => handler.validateConfig({ ...base, ...bad } as never)).toThrow(/ffmpeg_handler/);
    }
    // Numeric strings are legitimate.
    expect(() =>
      handler.validateConfig({ ...base, height: '360', quality: '5' } as never),
    ).not.toThrow();
  });

  it('a bad knob that slipped past validateConfig still cannot reach argv', async () => {
    const { handler, runner } = createHandler();
    const result = await handler.execute(
      context(),
      step({
        operation: 'frames',
        input: 'a.mp4',
        outputPrefix: 'p',
        times: [1],
        height: 2.5,
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONFIGURATION_ERROR');
    expect(runner.run).not.toHaveBeenCalled();
  });
});
