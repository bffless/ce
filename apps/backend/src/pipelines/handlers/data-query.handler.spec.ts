jest.mock('../../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset'];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) chainable[method] = jest.fn(() => chainable);
  chainable.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
    Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) (chainable[method] as jest.Mock).mockClear();
  };
  return { db: chainable };
});

import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../../db/client';
import { DataQueryHandler } from './data-query.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (r: unknown) => void;
  __reset: () => void;
};
const SCHEMA = { id: 'schema-1', projectId: 'proj-1', name: 'reader_items' };

function buildHandler() {
  const registry = { register: jest.fn() };
  const expressionEvaluator = {
    evaluateExpression: jest.fn((expr: unknown, context: PipelineContext) => {
      if (typeof expr !== 'string') return expr;
      if (expr.startsWith('steps.')) {
        const parts = expr.split('.').slice(1);
        let value: unknown = context.stepOutputs;
        for (const part of parts) {
          if (value == null || typeof value !== 'object') return undefined;
          value = (value as Record<string, unknown>)[part];
        }
        return value;
      }
      return expr;
    }),
  } as unknown as ExpressionEvaluator;
  const schemasService = { getById: jest.fn(async () => SCHEMA) } as unknown as PipelineSchemasService;
  return { handler: new DataQueryHandler(registry as any, expressionEvaluator, schemasService) };
}

const step = (config: unknown): PipelineStep =>
  ({ name: 'page', handlerType: 'data_query', config }) as unknown as PipelineStep;
const context = (stepOutputs: Record<string, unknown> = {}): PipelineContext =>
  ({ projectId: 'proj-1', stepOutputs, user: { id: 'user-1' } }) as unknown as PipelineContext;

function selectWhereQuery(): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(mockDb.where.mock.calls[0][0]);
}

describe('DataQueryHandler in operator', () => {
  beforeEach(() => mockDb.__reset());

  it('validateConfig accepts the in operator', () => {
    const { handler } = buildHandler();
    expect(() =>
      handler.validateConfig({
        schemaId: 'schema-1',
        filters: { feedId: { op: 'in', value: 'steps.prep.urls' } },
      } as any),
    ).not.toThrow();
  });

  it('filters feedId IN (folder urls) resolved from a prior step', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([]); // page rows
    await handler.execute(
      context({ prep: { urls: ['https://a.com/feed', 'https://b.com/feed'] } }),
      step({
        schemaId: 'schema-1',
        filters: { feedId: { op: 'in', value: 'steps.prep.urls' } },
      }),
    );
    const { sql, params } = selectWhereQuery();
    expect(sql.toLowerCase()).toContain('in (');
    expect(params).toEqual(
      expect.arrayContaining(['https://a.com/feed', 'https://b.com/feed']),
    );
  });
});

describe('DataQueryHandler output shape (array vs single object)', () => {
  beforeEach(() => mockDb.__reset());

  const row = (guid: string) => ({
    id: `id-${guid}`,
    alias: null,
    version: 1,
    data: { guid },
    createdAt: 'c',
    updatedAt: 'u',
  });

  it('returns an ARRAY when limit is 1 and single/recordId are not set (bffless/ce#428)', async () => {
    // Regression: limit:1 used to implicitly return a single object, which
    // silently dropped the row for any array-shaped consumer.
    const { handler } = buildHandler();
    mockDb.__queue([row('g1')]);
    const result = await handler.execute(
      context(),
      step({ schemaId: 'schema-1', limit: 1 }),
    );
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output).toHaveLength(1);
    expect((result.output as Array<{ guid: string }>)[0].guid).toBe('g1');
  });

  it('returns a single OBJECT when single:true is set explicitly', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([row('g1')]);
    const result = await handler.execute(
      context(),
      step({ schemaId: 'schema-1', single: true }),
    );
    expect(Array.isArray(result.output)).toBe(false);
    expect((result.output as { guid: string }).guid).toBe('g1');
  });

  it('returns null when single:true matches no rows', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([]);
    const result = await handler.execute(
      context(),
      step({ schemaId: 'schema-1', single: true }),
    );
    expect(result.output).toBeNull();
  });

  it('returns a single OBJECT when recordId is set', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([row('g1')]);
    const result = await handler.execute(
      context(),
      step({ schemaId: 'schema-1', recordId: 'id-g1' }),
    );
    expect(Array.isArray(result.output)).toBe(false);
    expect((result.output as { guid: string }).guid).toBe('g1');
  });
});
