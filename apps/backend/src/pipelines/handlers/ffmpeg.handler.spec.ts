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
import { FfmpegHandler } from './ffmpeg.handler';

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
    getOps: async () => ['probe', 'extract_audio', 'slice', 'concat', 'frames', 'contact_sheet'],
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
      ops: ['probe', 'extract_audio', 'slice', 'concat', 'frames', 'contact_sheet'],
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
 * frames / contact_sheet (Task 17b). Both are path-in/path-out under an
 * explicit `outputPrefix`; the argv itself is Task 17a's (ffmpeg-args.spec.ts
 * owns the escaping/planning proofs), so these tests pin the HANDLER: how many
 * commands and outputs a job carries, the keys they land on, the untrusted-
 * config guards, and the label degrade fence (R77).
 */
type FrameOut = {
  time: number;
  storage_path: string;
  content_type: string;
  size: number;
};
type FramesOutput = { frames: FrameOut[]; count: number };
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
  interval: number;
  count: number;
  labelled: boolean;
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

  it('runs one command per time and returns one frame per time under the prefix', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), framesStep());
    expect(result.success).toBe(true);
    const out = result.output as unknown as FramesOutput;
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(out.count).toBe(3);
    expect(out.frames.map((f) => f.storage_path)).toEqual([
      'o/r/uploads/studio/shots/frame-01.jpg',
      'o/r/uploads/studio/shots/frame-02.jpg',
      'o/r/uploads/studio/shots/frame-03.jpg',
    ]);
    // The REQUESTED time, unchanged — a downstream step re-captures from it.
    expect(out.frames.map((f) => f.time)).toEqual([1, 2.5, 3]);
    expect(out.frames.every((f) => f.content_type === 'image/jpeg')).toBe(true);
    expect(out.frames.every((f) => typeof f.size === 'number')).toBe(true);
    // Clean stills: `frames` never burns a label in.
    expect(argvs(runner).some((a) => a.includes('drawtext'))).toBe(false);
    expect(argvs(runner)[0]).toContain('scale=-2:720');
    // R80: every ffmpeg command carries its own ceiling.
    expect(runner.run.mock.calls[0][0].timeoutSeconds).toBe(120);
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
});

describe('contact_sheet', () => {
  const sheetStep = (over: Record<string, unknown> = {}) =>
    step({
      operation: 'contact_sheet',
      input: 'studio/src.mp4',
      outputPrefix: 'studio/sheets',
      duration: 600,
      ...over,
    });

  /** Local executor + a runner that answers ffprobe with json and writes every other output. */
  const setup = (overrides?: Parameters<typeof createHandler>[0]) => {
    const created = createHandler(overrides);
    created.runner.run.mockImplementation(
      async ({ binary, args, cwd }: { binary: string; args: string[]; cwd: string }) => {
        if (binary === 'ffprobe') {
          return { stdout: JSON.stringify({ format: { duration: '600' } }), stderrTail: '' };
        }
        await fsp.writeFile(`${cwd}/${args[args.length - 1].split('/').pop()}`, 'jpeg-bytes');
        return { stdout: '', stderrTail: '' };
      },
    );
    created.storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    return created;
  };

  it('plans 120 cells into 10 labelled sheets and uploads only the sheets', async () => {
    const { handler, runner, scratch } = setup();
    const result = await handler.execute(context(), sheetStep());
    expect(result.success).toBe(true);
    const out = result.output as unknown as SheetsOutput;
    expect(out.count).toBe(120);
    expect(out.interval).toBe(5);
    expect(out.labelled).toBe(true);
    expect(out.sheets).toHaveLength(10);
    expect(runner.run).toHaveBeenCalledTimes(130); // 120 cells + 10 tiles
    // duration came from config, so no ffprobe ran and it was ONE job.
    expect(runner.run.mock.calls.every((c) => c[0].binary === 'ffmpeg')).toBe(true);
    expect(scratch.createJobDir).toHaveBeenCalledTimes(1);
    expect(out.sheets[0]).toMatchObject({
      storage_path: 'o/r/uploads/studio/sheets/sheet-01.jpg',
      content_type: 'image/jpeg',
      index: 0,
      total: 10,
      cols: 3,
      rows: 4,
    });
    expect(out.sheets[0].times).toHaveLength(12);
    expect(out.sheets[9].storage_path).toBe('o/r/uploads/studio/sheets/sheet-10.jpg');
    // Every cell burns the clock in; the tiles never do.
    const cells = argvs(runner).slice(0, 120);
    expect(cells.every((a) => a.includes('drawtext'))).toBe(true);
    expect(
      argvs(runner)
        .slice(120)
        .some((a) => a.includes('drawtext')),
    ).toBe(false);
    expect(argvs(runner)[120]).toContain('tile=3x4');
  });

  it('probes the duration as its OWN job when config omits it', async () => {
    const { handler, runner, scratch } = setup();
    const result = await handler.execute(context(), sheetStep({ duration: undefined }));
    expect(result.success).toBe(true);
    expect(runner.run.mock.calls[0][0].binary).toBe('ffprobe');
    expect(runner.run.mock.calls[0][0].timeoutSeconds).toBe(60);
    // Two jobs: the probe, then the cells+tiles planned from its answer.
    expect(scratch.createJobDir).toHaveBeenCalledTimes(2);
    expect(runner.run).toHaveBeenCalledTimes(131);
    expect((result.output as unknown as SheetsOutput).count).toBe(120);
  });

  it('addresses scratch cells by BARE filenames whose width matches the tile pattern (R75/R82)', async () => {
    const { handler, runner } = setup();
    await handler.execute(context(), sheetStep());
    const cellOutputs = runner.run.mock.calls
      .slice(0, 120)
      .map((c) => (c[0].args as string[])[(c[0].args as string[]).length - 1]);
    // Cells are scratch-only: never a {out:} placeholder (both executors reject
    // an undeclared one) and never rewritten to an absolute path by the executor.
    expect(cellOutputs.every((t) => !t.startsWith('{out:'))).toBe(true);
    expect(cellOutputs[0]).toBe('cell-001.jpg');
    expect(cellOutputs[119]).toBe('cell-120.jpg');
    expect(argvs(runner)[120]).toContain('cell-%03d.jpg');
  });

  it('label:false skips drawtext entirely and never retries', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(
      context(),
      sheetStep({ label: false, duration: 60, maxSheets: 1 }),
    );
    expect(result.success).toBe(true);
    expect((result.output as unknown as SheetsOutput).labelled).toBe(false);
    expect(argvs(runner).some((a) => a.includes('drawtext'))).toBe(false);
  });

  it('fails with a typed error when the duration is unusable', async () => {
    const { handler, runner } = setup();
    for (const duration of [0, -5, 'not a number']) {
      const result = await handler.execute(context(), sheetStep({ duration }));
      expect(result.error?.code).toBe('INVALID_TIMES');
      expect(result.error?.message).toMatch(/duration/);
    }
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects traversal in outputPrefix with INVALID_OUTPUT_PATH', async () => {
    const { handler, runner } = setup();
    const result = await handler.execute(context(), sheetStep({ outputPrefix: '../out' }));
    expect(result.error?.code).toBe('INVALID_OUTPUT_PATH');
    expect(runner.run).not.toHaveBeenCalled();
  });
});

/**
 * R77 — the label degrade. The local `-filters` probe may only SUPPRESS labels,
 * and only for the LOCAL executor: a remote-only instance has no local ffmpeg
 * at all, so gating on that probe alone would mean it never labels, which
 * defeats the point of a contact sheet. The universal net is the retry.
 */
describe('contact_sheet label degrade (R77)', () => {
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

  const ok = jest.fn();
  const jobResult = (job: FfmpegJob) => ({
    executor: 'local' as const,
    // The probe job answers with ffprobe json; the sheet job has no stdout.
    stdout: job.commands.some((c) => c.kind === 'ffprobe')
      ? JSON.stringify({ format: { duration: '60' } })
      : '',
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
  const sheetStep = (over: Record<string, unknown> = {}) =>
    step({
      operation: 'contact_sheet',
      input: 'a.mp4',
      outputPrefix: 'sheets',
      duration: 60,
      ...over,
    });
  const labelled = (run: jest.Mock, call = 0): boolean =>
    (run.mock.calls[call][0] as FfmpegJob).commands.some((c) =>
      c.argv.join(' ').includes('drawtext'),
    );

  afterEach(() => ok.mockReset());

  it('a LOCAL executor whose ffmpeg has no drawtext never attempts a label', async () => {
    const run = runOk();
    const { handler } = withExecutor('local', run, () => false);
    const result = await handler.execute(context(), sheetStep());
    expect(result.success).toBe(true);
    expect((result.output as unknown as SheetsOutput).labelled).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(labelled(run)).toBe(false);
  });

  it('an unknown local filter set (undefined) still attempts the label', async () => {
    const run = runOk();
    const { handler } = withExecutor('local', run, () => undefined);
    const result = await handler.execute(context(), sheetStep());
    expect((result.output as unknown as SheetsOutput).labelled).toBe(true);
    expect(labelled(run)).toBe(true);
  });

  it('a REMOTE executor labels even when THIS box has no drawtext', async () => {
    const run = runOk();
    const { handler } = withExecutor('remote', run, () => false);
    const result = await handler.execute(context(), sheetStep());
    expect((result.output as unknown as SheetsOutput).labelled).toBe(true);
    expect(labelled(run)).toBe(true);
  });

  it('retries ONCE without labels when the job fails on drawtext, and warns', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(drawtextFailure())
      .mockImplementation(async (job: FfmpegJob) => jobResult(job));
    const { handler } = withExecutor('remote', run);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const result = await handler.execute(context(), sheetStep());
      expect(result.success).toBe(true);
      const out = result.output as unknown as SheetsOutput;
      expect(out.labelled).toBe(false);
      expect(out.sheets.length).toBeGreaterThan(0);
      expect(run).toHaveBeenCalledTimes(2);
      expect(labelled(run, 0)).toBe(true);
      expect(labelled(run, 1)).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ffmpeg_contact_sheet_drawtext_missing' }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('a second drawtext failure propagates as FFMPEG_FAILED', async () => {
    const run = jest.fn().mockRejectedValue(drawtextFailure());
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), sheetStep());
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
    const result = await handler.execute(context(), sheetStep());
    expect(result.error?.code).toBe('FFMPEG_FAILED');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sums bytesIn/bytesOut across the probe job and the sheet job (R79)', async () => {
    const run = runOk();
    const { handler } = withExecutor('remote', run);
    const result = await handler.execute(context(), sheetStep({ duration: undefined }));
    expect(result.success).toBe(true);
    const out = result.output as unknown as SheetsOutput;
    // Two jobs ran (probe + sheets), each reporting bytesIn 5.
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.bytesIn).toBe(10);
  });
});

describe('untrusted numeric config knobs', () => {
  it('validateConfig requires the new per-op fields', () => {
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
      handler.validateConfig({ operation: 'contact_sheet', outputPrefix: 'p' } as never),
    ).toThrow(/input/);
    expect(() =>
      handler.validateConfig({ operation: 'contact_sheet', input: 'a' } as never),
    ).toThrow(/outputPrefix/);
    expect(() =>
      handler.validateConfig({
        operation: 'contact_sheet',
        input: 'a',
        outputPrefix: 'p',
      } as never),
    ).not.toThrow();
  });

  /**
   * Pipeline config is authored as YAML/JSON by a user, so `2.5`, `"3"` and
   * `true` are all reachable — and a non-integer `columns` reaches ffmpeg as
   * `tile=2.5x2`, which it rejects at runtime. Guard at the boundary.
   */
  it('rejects non-integer / non-positive / non-numeric knobs at config time', () => {
    const { handler } = createHandler();
    const base = { operation: 'contact_sheet', input: 'a', outputPrefix: 'p' };
    for (const bad of [
      { columns: 2.5 },
      { columns: 0 },
      { columns: true },
      { height: 0 },
      { height: -720 },
      { height: 'tall' },
      { quality: 1.5 },
      { cellsPerSheet: -1 },
      { maxSheets: 0 },
      { interval: 0 },
      { interval: 'soon' },
    ]) {
      expect(() => handler.validateConfig({ ...base, ...bad } as never)).toThrow(/ffmpeg_handler/);
    }
    // Numeric strings and fractional intervals are legitimate.
    expect(() =>
      handler.validateConfig({ ...base, height: '360', columns: '4', interval: 2.5 } as never),
    ).not.toThrow();
  });

  it('a bad knob that slipped past validateConfig still cannot reach argv', async () => {
    const { handler, runner } = createHandler();
    const result = await handler.execute(
      context(),
      step({
        operation: 'contact_sheet',
        input: 'a.mp4',
        outputPrefix: 'p',
        duration: 60,
        columns: 2.5,
      }),
    );
    expect(result.success).toBe(false);
    expect(runner.run).not.toHaveBeenCalled();
  });
});
