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
