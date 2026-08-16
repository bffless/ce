jest.mock('../../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'update', 'set', 'returning', 'limit'];
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
import { DataUpdateHandler } from './data-update.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

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
  return { handler: new DataUpdateHandler(registry as any, expressionEvaluator, schemasService) };
}

const step = (config: unknown): PipelineStep =>
  ({ name: 'readAll', handlerType: 'data_update', config }) as unknown as PipelineStep;
const context = (stepOutputs: Record<string, unknown> = {}): PipelineContext =>
  ({ projectId: 'proj-1', stepOutputs, user: { id: 'user-1' } }) as unknown as PipelineContext;

describe('DataUpdateHandler in operator', () => {
  beforeEach(() => mockDb.__reset());

  it('validateConfig accepts the in operator', () => {
    const { handler } = buildHandler();
    expect(() =>
      handler.validateConfig({
        schemaId: 'schema-1',
        filters: { feedId: { op: 'in', value: 'steps.prep.urls' } },
        fields: { read: 'true' },
      } as any),
    ).not.toThrow();
  });

  it('marks all matching folder items read via feedId IN (urls)', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'i1', data: { read: false } }, { id: 'i2', data: { read: false } }]); // select matches
    mockDb.__queue([{ id: 'i1', data: { read: true } }]); // update i1 .returning()
    mockDb.__queue([{ id: 'i2', data: { read: true } }]); // update i2 .returning()

    const result = await handler.execute(
      context({ prep: { urls: ['https://a.com/feed', 'https://b.com/feed'] } }),
      step({
        schemaId: 'schema-1',
        filters: {
          feedId: { op: 'in', value: 'steps.prep.urls' },
          read: { op: 'eq', value: 'false' },
        },
        fields: { read: 'true' },
      }),
    );

    expect((result.output as { count: number }).count).toBe(2);
    const { sql, params } = new PgDialect().sqlToQuery(mockDb.where.mock.calls[0][0]);
    expect(sql.toLowerCase()).toContain('in (');
    expect(params).toEqual(
      expect.arrayContaining(['https://a.com/feed', 'https://b.com/feed', 'false']),
    );
  });
});

describe('DataUpdateHandler range predicates (ce#415)', () => {
  beforeEach(() => mockDb.__reset());

  it('validateConfig accepts the full data_query operator set', () => {
    const { handler } = buildHandler();
    for (const op of ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'like', 'in']) {
      expect(() =>
        handler.validateConfig({
          schemaId: 'schema-1',
          filters: { fetchedAt: { op, value: '123' } },
          fields: { read: 'true' },
        } as any),
      ).not.toThrow();
    }
  });

  it('still rejects unknown operators', () => {
    const { handler } = buildHandler();
    expect(() =>
      handler.validateConfig({
        schemaId: 'schema-1',
        filters: { fetchedAt: { op: 'between', value: '123' } },
        fields: { read: 'true' },
      } as any),
    ).toThrow(ConfigurationError);
    expect(() =>
      handler.validateConfig({
        schemaId: 'schema-1',
        filters: { fetchedAt: { op: 'between', value: '123' } },
        fields: { read: 'true' },
      } as any),
    ).toThrow(/Invalid operator 'between'/);
  });

  it('marks everything older than a cutoff read: read eq false AND fetchedAt lt cutoff', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'old-1', data: { read: false } }, { id: 'old-2', data: { read: false } }]); // select matches
    mockDb.__queue([{ id: 'old-1', data: { read: true } }]); // update old-1 .returning()
    mockDb.__queue([{ id: 'old-2', data: { read: true } }]); // update old-2 .returning()

    const result = await handler.execute(
      context({ cutoff: { cutoff: 1704067200000 } }),
      step({
        schemaId: 'schema-1',
        filters: {
          read: { op: 'eq', value: 'false' },
          fetchedAt: { op: 'lt', value: 'steps.cutoff.cutoff' },
        },
        fields: { read: 'true' },
      }),
    );

    expect(result.success).toBe(true);
    expect((result.output as { count: number }).count).toBe(2);

    // The lt filter must cast the JSONB field to numeric and bind the resolved
    // cutoff as a number — the same shape data_query / data_delete emit.
    const { sql, params } = new PgDialect().sqlToQuery(mockDb.where.mock.calls[0][0]);
    expect(sql).toContain('::numeric <');
    expect(params).toContain(1704067200000);
    expect(params).toContain('false');
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });
});

describe('DataUpdateHandler schema type coercion (ce#562)', () => {
  beforeEach(() => mockDb.__reset());

  function buildTypedHandler() {
    const { handler } = buildHandler();
    const typedSchema = {
      ...SCHEMA,
      fields: [
        { name: 'updatedMs', type: 'number', required: false },
        { name: 'read', type: 'boolean', required: false },
      ],
    };
    (handler as unknown as { schemasService: { getById: jest.Mock } }).schemasService = {
      getById: jest.fn(async () => typedSchema),
    };
    return handler;
  }

  it('coerces an ISO date string into a number-typed field as epoch ms', async () => {
    const handler = buildTypedHandler();
    mockDb.__queue([{ id: 'i1', data: { read: false } }]); // select matches
    mockDb.__queue([{ id: 'i1', data: { updatedMs: 1704067200000 } }]); // update .returning()

    const result = await handler.execute(
      context({}),
      step({
        schemaId: 'schema-1',
        recordId: 'i1',
        fields: { updatedMs: '2024-01-01T00:00:00.000Z' },
      }),
    );

    expect(result.success).toBe(true);
    const setArg = mockDb.set.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(setArg.data.updatedMs).toBe(1704067200000);
  });

  it('returns VALIDATION_ERROR for a non-coercible value instead of writing it', async () => {
    const handler = buildTypedHandler();
    mockDb.__queue([{ id: 'i1', data: {} }]); // select matches

    const result = await handler.execute(
      context({}),
      step({ schemaId: 'schema-1', recordId: 'i1', fields: { updatedMs: 'garbage' } }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('DataUpdateHandler ne operator is null-safe', () => {
  beforeEach(() => mockDb.__reset());

  it('updates rows missing the key via IS DISTINCT FROM', async () => {
    // This is what makes a backfill possible at all: `flag ne <value>` has to reach
    // the rows that predate the flag, which is precisely where it needs writing.
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'i1', data: { guid: 'g1' } }]); // select matches (no `archived` key)
    mockDb.__queue([{ id: 'i1', data: { guid: 'g1', archived: 'false' } }]); // update .returning()

    const result = await handler.execute(
      context({}),
      step({
        schemaId: 'schema-1',
        filters: { archived: { op: 'ne', value: 'false' } },
        fields: { archived: 'false' },
      }),
    );

    expect((result.output as { count: number }).count).toBe(1);
    const { sql, params } = new PgDialect().sqlToQuery(mockDb.where.mock.calls[0][0]);
    expect(sql.toLowerCase()).toContain('is distinct from');
    expect(sql).not.toContain('!=');
    expect(params).toEqual(expect.arrayContaining(['false']));
  });
});
