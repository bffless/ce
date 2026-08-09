import { PipelineEmbeddingsService, VectorSearchResult } from '../pipeline-embeddings.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { VectorSearchHandler } from './vector-search.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

const SCHEMA = { id: 'schema-1', projectId: 'proj-1', name: 'video_chunks' };

function buildHandler() {
  const registry = { register: jest.fn() };
  const expressionEvaluator = {
    evaluateExpression: jest.fn((expr: unknown) => {
      if (typeof expr === 'string' && expr.startsWith('steps.')) {
        return [0.1, 0.2, 0.3];
      }
      return expr;
    }),
  } as unknown as ExpressionEvaluator;
  const embeddingsService = {
    vectorSearch: jest.fn(),
  } as unknown as PipelineEmbeddingsService;
  const schemasService = {
    getById: jest.fn(async () => SCHEMA),
  } as unknown as PipelineSchemasService;
  return {
    handler: new VectorSearchHandler(registry as any, expressionEvaluator, embeddingsService, schemasService),
    embeddingsService,
  };
}

const step = (config: unknown): PipelineStep =>
  ({ name: 'search', handlerType: 'vector_search', config }) as unknown as PipelineStep;

const context = (): PipelineContext =>
  ({ projectId: 'proj-1', stepOutputs: {} }) as unknown as PipelineContext;

describe('VectorSearchHandler', () => {
  it('includes chunkMetadata on chunked results', async () => {
    const { handler, embeddingsService } = buildHandler();
    const mockResults: VectorSearchResult[] = [
      {
        id: 'e1',
        pipelineDataId: 'r1',
        similarity: 0.9,
        chunkIndex: 0,
        chunkText: '[t=754s] some words',
        metadata: { start: 754, end: 799 },
        data: { title: 'Vid' },
      },
    ];
    (embeddingsService.vectorSearch as jest.Mock).mockResolvedValue(mockResults);

    const result = await handler.execute(
      context(),
      step({
        schemaId: 'schema-1',
        fieldName: 'content',
        queryVector: 'steps.query',
      }),
    );

    expect(result.success).toBe(true);
    const output = result.output as any[];
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      id: 'r1',
      similarity: 0.9,
      chunkText: '[t=754s] some words',
      chunkIndex: 0,
      chunkMetadata: { start: 754, end: 799 },
      title: 'Vid',
    });
  });

  it('omits chunkMetadata when null', async () => {
    const { handler, embeddingsService } = buildHandler();
    const mockResults: VectorSearchResult[] = [
      {
        id: 'e1',
        pipelineDataId: 'r1',
        similarity: 0.9,
        chunkIndex: null,
        chunkText: null,
        metadata: null,
        data: { title: 'Vid' },
      },
    ];
    (embeddingsService.vectorSearch as jest.Mock).mockResolvedValue(mockResults);

    const result = await handler.execute(
      context(),
      step({
        schemaId: 'schema-1',
        fieldName: 'content',
        queryVector: 'steps.query',
      }),
    );

    expect(result.success).toBe(true);
    const output = result.output as any[];
    expect(output).toHaveLength(1);
    expect(output[0]).toEqual({
      id: 'r1',
      similarity: 0.9,
      title: 'Vid',
    });
    expect('chunkMetadata' in output[0]).toBe(false);
  });

  it('includes chunkMetadata with other chunked fields', async () => {
    const { handler, embeddingsService } = buildHandler();
    const mockResults: VectorSearchResult[] = [
      {
        id: 'e1',
        pipelineDataId: 'r1',
        similarity: 0.95,
        chunkIndex: 2,
        chunkText: '[t=1000s] more content',
        metadata: { start: 1000, end: 1100, page: 5 },
        data: { videoId: 'vid-123', title: 'Tutorial' },
      },
    ];
    (embeddingsService.vectorSearch as jest.Mock).mockResolvedValue(mockResults);

    const result = await handler.execute(
      context(),
      step({
        schemaId: 'schema-1',
        fieldName: 'content',
        queryVector: 'steps.query',
        limit: 5,
      }),
    );

    expect(result.success).toBe(true);
    const output = result.output as any[];
    expect(output[0]).toMatchObject({
      id: 'r1',
      similarity: 0.95,
      chunkIndex: 2,
      chunkText: '[t=1000s] more content',
      chunkMetadata: { start: 1000, end: 1100, page: 5 },
      videoId: 'vid-123',
      title: 'Tutorial',
    });
  });
});
