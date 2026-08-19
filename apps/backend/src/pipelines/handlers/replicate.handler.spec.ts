import { ReplicateHandler } from './replicate.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

/**
 * Image models take their reference images as an *array* of URIs
 * (`google/nano-banana-2`'s `image_input`, for one). Storage paths inside such
 * an array have to be resolved the same way a bare string input is, or the raw
 * path reaches Replicate and the prediction fails.
 */
function createHandler(download: Buffer = Buffer.from('png-bytes')) {
  const registry = { register: jest.fn() };
  const projectAISettingsService = {
    getServiceConfig: jest.fn().mockResolvedValue({ apiToken: 'r8-test' }),
  };
  const storageAdapter = { download: jest.fn().mockResolvedValue(download) };
  const handler = new ReplicateHandler(
    registry as never,
    new ExpressionEvaluator(),
    projectAISettingsService as never,
    storageAdapter as never,
  );
  return { handler, storageAdapter };
}

/**
 * The expression evaluator has no array literal syntax, so a rule supplies an
 * array input by referencing a prior step's output (`steps.prep.images`) — a
 * `function_handler` that returns the list. That's the shape real rules use, so
 * it's the shape these tests exercise.
 */
function createContext(images: unknown = []): PipelineContext {
  return {
    request: { body: {} } as never,
    stepOutputs: { prep: { images } },
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    deployment: { owner: 'bffless', repo: 'studio', commitSha: 'sha-1' },
    metadata: { path: '/x', method: 'POST', headers: {}, query: {}, body: {} },
  } as PipelineContext;
}

function step(input: Record<string, unknown>): PipelineStep {
  return {
    id: 'generate',
    name: 'generate',
    handlerType: 'replicate',
    config: {
      model: 'google/nano-banana-2',
      // Pin the version so execute() doesn't make a lookup request first.
      version: 'google/nano-banana-2:abc123',
      input,
    },
  } as PipelineStep;
}

/** The `input` object actually POSTed to Replicate's predictions endpoint. */
function sentInput(): Record<string, unknown> {
  const call = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
    String(url).endsWith('/predictions'),
  );
  return JSON.parse(call[1].body).input;
}

describe('ReplicateHandler — file inputs', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pred-1', status: 'succeeded', output: 'https://out.test/i.png' }),
    }) as never;
  });

  it('resolves a storage path held in an array input', async () => {
    const { handler, storageAdapter } = createHandler();

    await handler.execute(
      createContext(['bffless/studio/uploads/thumbnails/face.png']),
      step({ prompt: "'a thumbnail'", image_input: 'steps.prep.images' }),
    );

    expect(storageAdapter.download).toHaveBeenCalledWith(
      'bffless/studio/uploads/thumbnails/face.png',
    );
    expect(sentInput().image_input).toEqual([
      `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
    ]);
  });

  it('resolves an /api/uploads serve path held in an array input', async () => {
    const { handler, storageAdapter } = createHandler();

    await handler.execute(
      createContext(['/api/uploads/thumbnails/face.png']),
      step({ prompt: "'x'", image_input: 'steps.prep.images' }),
    );

    expect(storageAdapter.download).toHaveBeenCalledWith(
      'bffless/studio/uploads/thumbnails/face.png',
    );
  });

  it('leaves plain https entries in an array untouched', async () => {
    const { handler, storageAdapter } = createHandler();

    await handler.execute(
      createContext(['https://cdn.test/face.png']),
      step({ prompt: "'x'", image_input: 'steps.prep.images' }),
    );

    expect(storageAdapter.download).not.toHaveBeenCalled();
    expect(sentInput().image_input).toEqual(['https://cdn.test/face.png']);
  });

  it('passes an empty array through unchanged', async () => {
    const { handler } = createHandler();

    await handler.execute(
      createContext([]),
      step({ prompt: "'x'", image_input: 'steps.prep.images' }),
    );

    expect(sentInput().image_input).toEqual([]);
  });

  it('resolves only the storage entries in a mixed array, in order', async () => {
    const { handler } = createHandler();

    await handler.execute(
      createContext(['https://cdn.test/a.png', 'bffless/studio/uploads/thumbnails/face.png']),
      step({ prompt: "'x'", image_input: 'steps.prep.images' }),
    );

    expect(sentInput().image_input).toEqual([
      'https://cdn.test/a.png',
      `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
    ]);
  });

  it('still resolves a bare string input (regression)', async () => {
    const { handler, storageAdapter } = createHandler();

    await handler.execute(
      createContext(),
      step({ prompt: "'x'", image: "'bffless/studio/uploads/thumbnails/face.png'" }),
    );

    expect(storageAdapter.download).toHaveBeenCalledWith(
      'bffless/studio/uploads/thumbnails/face.png',
    );
    expect(sentInput().image).toMatch(/^data:image\/png;base64,/);
  });
});
