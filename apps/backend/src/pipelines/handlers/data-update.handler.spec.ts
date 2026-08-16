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

import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../../db/client';
import { DataUpdateHandler, buildDataMergeExpression } from './data-update.handler';
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
    const setArg = mockDb.set.mock.calls[0][0] as { data: SQL };
    const { params } = new PgDialect().sqlToQuery(setArg.data);
    expect(params).toContain(JSON.stringify({ updatedMs: 1704067200000 }));
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

describe('DataUpdateHandler merges in SQL, not from the earlier read (ce#432)', () => {
  beforeEach(() => mockDb.__reset());

  const dialect = new PgDialect();
  const setDataSql = (callIndex: number) =>
    dialect.sqlToQuery((mockDb.set.mock.calls[callIndex][0] as { data: SQL }).data);

  it('writes `data || <updates>::jsonb` instead of a whole-blob replacement', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'n1', data: { mode: 'inheriting', grantsJson: '[]', title: 'Docs' } }]);
    mockDb.__queue([{ id: 'n1', data: { mode: 'restricted', grantsJson: '[]', title: 'Docs' } }]);

    const result = await handler.execute(
      context({}),
      step({ schemaId: 'schema-1', recordId: 'n1', fields: { mode: 'restricted' } }),
    );

    expect(result.success).toBe(true);
    const { sql, params } = setDataSql(0);
    expect(sql).toMatch(/"pipeline_data"\."data" \|\| \$1::jsonb/);
    // Only the fields this step sets travel to the database — never the stale
    // copy of the other fields we read a moment ago.
    expect(params).toEqual([JSON.stringify({ mode: 'restricted' })]);
    expect(JSON.stringify(params)).not.toContain('grantsJson');
    expect(JSON.stringify(params)).not.toContain('Docs');
  });

  it('two concurrent field-disjoint updates each send only their own field', async () => {
    // Reproduces the Handoff race: PATCH /api/node (mode) and POST /api/grants/revoke
    // (grantsJson) fired via Promise.all against the same record. Both handlers read
    // the same pre-update row; neither write may carry the other\'s field.
    const { handler } = buildHandler();
    const original = { id: 'n1', data: { mode: 'inheriting', grantsJson: '[]' } };
    mockDb.__queue([original]); // select for update A
    mockDb.__queue([original]); // select for update B (stale, same as A)
    mockDb.__queue([{ id: 'n1', data: { mode: 'restricted', grantsJson: '[]' } }]);
    mockDb.__queue([{ id: 'n1', data: { mode: 'restricted', grantsJson: '[{"u":"x"}]' } }]);

    const [a, b] = await Promise.all([
      handler.execute(
        context({}),
        step({ schemaId: 'schema-1', recordId: 'n1', fields: { mode: 'restricted' } }),
      ),
      handler.execute(
        context({}),
        step({ schemaId: 'schema-1', recordId: 'n1', fields: { grantsJson: '[{"u":"x"}]' } }),
      ),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledTimes(2);
    const paramSets = [setDataSql(0).params, setDataSql(1).params].map((p) => JSON.parse(String(p[0])));
    expect(paramSets).toEqual(
      expect.arrayContaining([{ mode: 'restricted' }, { grantsJson: '[{"u":"x"}]' }]),
    );
    // Neither write mentions the field it did not set, so `||` in Postgres composes
    // them regardless of commit order.
    for (const p of paramSets) {
      expect(Object.keys(p)).toHaveLength(1);
    }
  });

  it('removes keys whose evaluated value is undefined (matches the old spread + JSON semantics)', () => {
    const { sql, params } = dialect.sqlToQuery(
      buildDataMergeExpression({ keep: 1, gone: undefined }),
    );
    expect(sql).toBe('("pipeline_data"."data" - $1::text) || $2::jsonb');
    expect(params).toEqual(['gone', JSON.stringify({ keep: 1 })]);
  });

  it('emits a bare `data - key` when every update is undefined', () => {
    const { sql, params } = dialect.sqlToQuery(buildDataMergeExpression({ gone: undefined }));
    expect(sql).toBe('("pipeline_data"."data" - $1::text)');
    expect(params).toEqual(['gone']);
  });

  it('serialises nested objects and nulls into the jsonb payload', () => {
    const { params } = dialect.sqlToQuery(
      buildDataMergeExpression({ meta: { a: [1, 2] }, cleared: null }),
    );
    expect(params).toEqual([JSON.stringify({ meta: { a: [1, 2] }, cleared: null })]);
  });
});
