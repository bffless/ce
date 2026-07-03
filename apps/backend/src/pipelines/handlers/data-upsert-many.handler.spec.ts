import { DataUpsertManyHandler, DataUpsertManyOutput } from './data-upsert-many.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

const SCHEMA = {
  id: 'schema-1',
  projectId: 'proj-1',
  name: 'items',
  version: 3,
  fields: [
    { name: 'guid', type: 'string', required: false },
    { name: 'title', type: 'string', required: true },
    { name: 'link', type: 'string', required: false },
  ],
};

function buildHandler() {
  const registry = { register: jest.fn() };

  // A small real-ish evaluator: resolves "steps.<path>" (including the injected
  // "steps.item.<field>") against stepOutputs, handles now()/false, and passes
  // any other literal through. Enough to exercise mapping, the dedup fallback
  // chain, and now().
  const expressionEvaluator = {
    evaluateExpression: jest.fn((expr: string, context: PipelineContext) => {
      if (typeof expr !== 'string') return expr;
      if (expr === 'now()') return '2024-01-01T00:00:00.000Z';
      if (expr === 'false') return false;
      if (expr.startsWith('steps.')) {
        const parts = expr.split('.').slice(1);
        let value: unknown = context.stepOutputs;
        for (const part of parts) {
          if (value == null || typeof value !== 'object') return undefined;
          value = (value as Record<string, unknown>)[part];
        }
        return value;
      }
      return expr; // literal
    }),
  } as unknown as ExpressionEvaluator;

  const dataService = {
    findExistingKeys: jest.fn(async () => new Set<string>()),
    createMany: jest.fn(async (_s, _p, records: Record<string, unknown>[]) =>
      records.map((data, i) => ({ id: `new-${i}`, data })),
    ),
  } as unknown as jest.Mocked<Pick<PipelineDataService, 'findExistingKeys' | 'createMany'>>;

  const schemasService = {
    getById: jest.fn(async () => SCHEMA),
  } as unknown as jest.Mocked<Pick<PipelineSchemasService, 'getById'>>;

  const handler = new DataUpsertManyHandler(
    registry as any,
    expressionEvaluator,
    dataService as unknown as PipelineDataService,
    schemasService as unknown as PipelineSchemasService,
  );
  return { handler, dataService, schemasService, expressionEvaluator };
}

const baseContext = {
  projectId: 'proj-1',
  stepOutputs: {},
  user: { id: 'user-1' },
} as unknown as PipelineContext;

const step = (config: unknown): PipelineStep =>
  ({ name: 'upsert', handlerType: 'data_upsert_many', config } as unknown as PipelineStep);

const defaultConfig = (items: unknown[]) => ({
  schemaId: 'schema-1',
  items: 'steps.feed.items',
  dedupField: 'guid',
  dedupKey: ['steps.item.guid', 'steps.item.link'],
  map: {
    guid: 'steps.item.guid',
    title: 'steps.item.title',
    link: 'steps.item.link',
    fetchedAt: 'now()',
  },
});

/** Put the array into stepOutputs.feed so "steps.feed.items" resolves to it. */
const contextWith = (items: unknown[]): PipelineContext =>
  ({ ...baseContext, stepOutputs: { feed: { items } } } as PipelineContext);

describe('DataUpsertManyHandler', () => {
  describe('validateConfig', () => {
    it('requires schemaId, items, map, dedupField, dedupKey', () => {
      const { handler } = buildHandler();
      expect(() => handler.validateConfig({} as any)).toThrow(ConfigurationError);
      expect(() =>
        handler.validateConfig({
          schemaId: 's',
          items: 'x',
          map: { a: 'b' },
          dedupField: 'guid',
          dedupKey: [],
        } as any),
      ).toThrow(/dedupKey/);
      expect(() =>
        handler.validateConfig({
          schemaId: 's',
          items: 'x',
          map: { a: 'b' },
          dedupField: 'guid',
          dedupKey: 'steps.item.guid',
        } as any),
      ).not.toThrow();
    });
  });

  it('inserts N records from the array in one run', async () => {
    const { handler, dataService } = buildHandler();
    const items = [
      { guid: 'a', title: 'A', link: 'https://x/a' },
      { guid: 'b', title: 'B', link: 'https://x/b' },
    ];

    const result = await handler.execute(contextWith(items), step(defaultConfig(items)));
    const output = result.output as DataUpsertManyOutput;

    expect(output.inserted).toBe(2);
    expect(output.skipped).toBe(0);
    expect(output.total).toBe(2);
    expect(dataService.createMany).toHaveBeenCalledTimes(1);
    // stored records carry the mapped fields + forced dedup value + version/alias
    const [, projectId, records, createdBy, , version] = dataService.createMany.mock.calls[0];
    expect(projectId).toBe('proj-1');
    expect(createdBy).toBe('user-1');
    expect(version).toBe(3);
    expect(records[0]).toMatchObject({ guid: 'a', title: 'A', fetchedAt: '2024-01-01T00:00:00.000Z' });
  });

  it('skips records whose dedup key already exists (insert-only, idempotent)', async () => {
    const { handler, dataService } = buildHandler();
    dataService.findExistingKeys.mockResolvedValueOnce(new Set(['a'])); // 'a' already stored
    const items = [
      { guid: 'a', title: 'A' },
      { guid: 'b', title: 'B' },
    ];

    const result = await handler.execute(contextWith(items), step(defaultConfig(items)));
    const output = result.output as DataUpsertManyOutput;

    expect(output.inserted).toBe(1);
    expect(output.skipped).toBe(1);
    const inserted = dataService.createMany.mock.calls[0][2];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ guid: 'b' });
  });

  it('is idempotent: re-running with all keys present inserts nothing', async () => {
    const { handler, dataService } = buildHandler();
    dataService.findExistingKeys.mockResolvedValueOnce(new Set(['a', 'b']));
    const items = [
      { guid: 'a', title: 'A' },
      { guid: 'b', title: 'B' },
    ];

    const result = await handler.execute(contextWith(items), step(defaultConfig(items)));
    const output = result.output as DataUpsertManyOutput;

    expect(output.inserted).toBe(0);
    expect(output.skipped).toBe(2);
    expect(dataService.createMany).toHaveBeenCalledWith(
      'schema-1',
      'proj-1',
      [],
      'user-1',
      null,
      3,
    );
  });

  it('uses the fallback chain when the primary key is empty', async () => {
    const { handler, dataService } = buildHandler();
    const items = [{ guid: '', title: 'No GUID', link: 'https://x/only-link' }];

    await handler.execute(contextWith(items), step(defaultConfig(items)));

    // dedupField (guid) is forced to the resolved fallback value (the link)
    const stored = dataService.createMany.mock.calls[0][2][0];
    expect(stored.guid).toBe('https://x/only-link');
    // and the existence check was queried with that same value
    const queried = dataService.findExistingKeys.mock.calls[0][3];
    expect(queried).toEqual(['https://x/only-link']);
  });

  it('falls back to a content hash when no dedup expression resolves', async () => {
    const { handler, dataService } = buildHandler();
    const items = [{ guid: '', title: 'Anonymous', link: '' }];

    await handler.execute(contextWith(items), step(defaultConfig(items)));

    const stored = dataService.createMany.mock.calls[0][2][0];
    expect(String(stored.guid)).toMatch(/^hash:[0-9a-f]{64}$/);
  });

  it('dedupes duplicates within the same batch', async () => {
    const { handler, dataService } = buildHandler();
    const items = [
      { guid: 'dup', title: 'First' },
      { guid: 'dup', title: 'Second' },
    ];

    const result = await handler.execute(contextWith(items), step(defaultConfig(items)));
    const output = result.output as DataUpsertManyOutput;

    expect(output.inserted).toBe(1);
    expect(output.skipped).toBe(1);
    expect(dataService.createMany.mock.calls[0][2][0]).toMatchObject({ title: 'First' });
  });

  it('records a per-item error for a missing required field without sinking the batch', async () => {
    const { handler, dataService } = buildHandler();
    const items = [
      { guid: 'a', title: 'Has title' },
      { guid: 'b' }, // missing required `title`
    ];

    const result = await handler.execute(contextWith(items), step(defaultConfig(items)));
    const output = result.output as DataUpsertManyOutput;

    expect(output.inserted).toBe(1);
    expect(output.errored).toBe(1);
    expect(output.errors[0]).toMatchObject({ index: 1 });
    expect(output.errors[0].error).toMatch(/title/);
    expect(dataService.createMany.mock.calls[0][2]).toHaveLength(1);
  });

  it('treats a null items expression as an empty no-op batch', async () => {
    const { handler, dataService } = buildHandler();
    const ctx = { ...baseContext, stepOutputs: { feed: {} } } as PipelineContext;

    const result = await handler.execute(ctx, step(defaultConfig([])));
    const output = result.output as DataUpsertManyOutput;

    expect(output).toEqual({
      inserted: 0,
      skipped: 0,
      errored: 0,
      total: 0,
      insertedIds: [],
      errors: [],
    });
    expect(dataService.createMany).not.toHaveBeenCalled();
  });

  it('rejects a dedupField that is not a schema column', async () => {
    const { handler } = buildHandler();
    const items = [{ guid: 'a', title: 'A' }];
    const config = { ...defaultConfig(items), dedupField: 'not_a_field' };

    await expect(handler.execute(contextWith(items), step(config))).rejects.toThrow(
      ConfigurationError,
    );
  });
});
