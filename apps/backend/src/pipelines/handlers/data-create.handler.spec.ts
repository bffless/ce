import { DataCreateHandler } from './data-create.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

const SCHEMA = {
  id: 'schema-1',
  projectId: 'proj-1',
  name: 'handoff_comments',
  version: 1,
  fields: [
    { name: 'body', type: 'string', required: true },
    { name: 'createdMs', type: 'number', required: false },
  ],
};

function buildHandler() {
  const registry = { register: jest.fn() };
  const dataService = {
    create: jest.fn(
      async (_schemaId: string, _projectId: string, data: Record<string, unknown>) => ({
        id: 'rec-1',
        data,
        alias: null,
        version: 1,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ),
  } as unknown as jest.Mocked<Pick<PipelineDataService, 'create'>>;
  const schemasService = {
    getById: jest.fn(async () => SCHEMA),
  } as unknown as PipelineSchemasService;
  const handler = new DataCreateHandler(
    registry as any,
    new ExpressionEvaluator(),
    dataService as unknown as PipelineDataService,
    schemasService,
  );
  return { handler, dataService };
}

const step = (config: unknown): PipelineStep =>
  ({ name: 'create', handlerType: 'data_create', config }) as unknown as PipelineStep;
const context = (body: Record<string, unknown> = {}): PipelineContext =>
  ({
    projectId: 'proj-1',
    stepOutputs: {},
    metadata: { body },
    user: { id: 'user-1' },
  }) as unknown as PipelineContext;

describe('DataCreateHandler schema type coercion (ce#562)', () => {
  it('stores now() into a number-typed field as epoch milliseconds', async () => {
    const { handler, dataService } = buildHandler();

    const result = await handler.execute(
      context({ body: 'hello' }),
      step({ schemaId: 'schema-1', fields: { body: 'request.body.body', createdMs: 'now()' } }),
    );

    expect(result.success).toBe(true);
    const stored = dataService.create.mock.calls[0][2];
    expect(typeof stored.createdMs).toBe('number');
    expect(stored.createdMs as number).toBeGreaterThan(Date.now() - 60_000);
    expect(stored.createdMs as number).toBeLessThanOrEqual(Date.now());
  });

  it('coerces numeric strings from the request into number fields', async () => {
    const { handler, dataService } = buildHandler();

    const result = await handler.execute(
      context({ body: 'hello', createdMs: '1704067200000' }),
      step({
        schemaId: 'schema-1',
        fields: { body: 'request.body.body', createdMs: 'request.body.createdMs' },
      }),
    );

    expect(result.success).toBe(true);
    expect(dataService.create.mock.calls[0][2].createdMs).toBe(1704067200000);
  });

  it('fails loudly when a non-coercible value hits a number field', async () => {
    const { handler, dataService } = buildHandler();

    const result = await handler.execute(
      context({ body: 'hello', createdMs: 'not-a-number' }),
      step({
        schemaId: 'schema-1',
        fields: { body: 'request.body.body', createdMs: 'request.body.createdMs' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(
      (result.error?.details as { errors: Record<string, string> }).errors.createdMs,
    ).toBeDefined();
    expect(dataService.create).not.toHaveBeenCalled();
  });
});
