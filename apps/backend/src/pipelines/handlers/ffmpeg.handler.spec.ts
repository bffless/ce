/**
 * ffmpeg_handler — probe op + registration + guards. Storage-op tests live in
 * this file too from Task 7 on. Pattern per replicate.handler.spec.ts: direct
 * construction, literal collaborators cast `as never`, REAL ExpressionEvaluator.
 */
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
    createJobDir: jest.fn().mockResolvedValue('/scratch/job-x'),
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
    expect(runner.run).not.toHaveBeenCalled();
  });
});
