// Thenable chainable db mock: every builder method returns the chain, and
// awaiting consumes the next queued result in await order. Mirrors
// pipeline-schedules.service.spec (the house pattern) — the handler imports
// db directly from db/client, so the module is mocked wholesale.
jest.mock('../../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'delete', 'returning'];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) {
    chainable[method] = jest.fn(() => chainable);
  }
  chainable.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../../db/client';
import { DataDeleteHandler } from './data-delete.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

const SCHEMA = { id: 'schema-1', projectId: 'proj-1', name: 'articles' };

function buildHandler() {
  const registry = { register: jest.fn() };

  // Resolves "steps.<path>" against stepOutputs; passes literals through.
  const expressionEvaluator = {
    evaluateExpression: jest.fn((expr: string, context: PipelineContext) => {
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
      return expr; // literal
    }),
  } as unknown as ExpressionEvaluator;

  const schemasService = {
    getById: jest.fn(async () => SCHEMA),
  } as unknown as jest.Mocked<Pick<PipelineSchemasService, 'getById'>>;

  const handler = new DataDeleteHandler(
    registry as any,
    expressionEvaluator,
    schemasService as unknown as PipelineSchemasService,
  );
  return { handler, schemasService };
}

const step = (config: unknown): PipelineStep =>
  ({ name: 'prune', handlerType: 'data_delete', config }) as unknown as PipelineStep;

const context = (stepOutputs: Record<string, unknown> = {}): PipelineContext =>
  ({ projectId: 'proj-1', stepOutputs, user: { id: 'user-1' } }) as unknown as PipelineContext;

/** Render the drizzle condition passed to the select's .where() into SQL text + params. */
function selectWhereQuery(): { sql: string; params: unknown[] } {
  const dialect = new PgDialect();
  const whereArg = mockDb.where.mock.calls[0][0];
  return dialect.sqlToQuery(whereArg);
}

describe('DataDeleteHandler', () => {
  beforeEach(() => mockDb.__reset());

  describe('validateConfig', () => {
    const { handler } = buildHandler();

    it('accepts the full data_query operator set', () => {
      for (const op of ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'like']) {
        expect(() =>
          handler.validateConfig({
            schemaId: 'schema-1',
            filters: { fetchedAt: { op, value: '123' } },
          } as any),
        ).not.toThrow();
      }
    });

    it('still rejects unknown operators', () => {
      expect(() =>
        handler.validateConfig({
          schemaId: 'schema-1',
          filters: { fetchedAt: { op: 'in', value: '123' } },
        } as any),
      ).toThrow(ConfigurationError);
      expect(() =>
        handler.validateConfig({
          schemaId: 'schema-1',
          filters: { fetchedAt: { op: 'between', value: '123' } },
        } as any),
      ).toThrow(/Invalid operator/);
    });

    it('still requires recordId or at least one filter', () => {
      expect(() => handler.validateConfig({ schemaId: 'schema-1' } as any)).toThrow(
        /recordId or at least one filter/,
      );
    });
  });

  it('deletes by range predicate: read/starred flags + fetchedAt < cutoff', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'old-1' }, { id: 'old-2' }]); // select matching ids
    mockDb.__queue([{ id: 'old-1' }, { id: 'old-2' }]); // delete .returning()

    const result = await handler.execute(
      context({ cutoff: { cutoff: 1704067200000 } }),
      step({
        schemaId: 'schema-1',
        filters: {
          read: { op: 'eq', value: 'true' },
          starred: { op: 'eq', value: 'false' },
          fetchedAt: { op: 'lt', value: 'steps.cutoff.cutoff' },
        },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ count: 2, deletedIds: ['old-1', 'old-2'] });

    // The lt filter must cast the JSONB field to numeric and bind the resolved
    // cutoff as a number — the same shape data_query emits.
    const { sql, params } = selectWhereQuery();
    expect(sql).toContain('::numeric <');
    expect(params).toContain(1704067200000);
    expect(params).toContain('true');
    expect(params).toContain('false');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('ne is null-safe — a row missing the key is now IN SCOPE for deletion', async () => {
    // NOTE: this WIDENS a destructive operation. `starred ne true` previously spared
    // rows that had no `starred` key at all (NULL != 'true' is NULL); it now deletes
    // them. That is the correct reading of "delete everything that isn't starred" —
    // a row with no flag is not starred — but any delete-by-query relying on the old
    // NULL-skipping behaviour to protect partially-populated rows will remove more.
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'no-flag-1' }]); // a legacy row with no `starred` key
    mockDb.__queue([{ id: 'no-flag-1' }]); // delete .returning()

    const result = await handler.execute(
      context({}),
      step({
        schemaId: 'schema-1',
        filters: { starred: { op: 'ne', value: 'true' } },
      }),
    );

    expect(result.output).toEqual({ count: 1, deletedIds: ['no-flag-1'] });
    const { sql, params } = selectWhereQuery();
    expect(sql.toLowerCase()).toContain('is distinct from');
    expect(sql).not.toContain('!=');
    expect(params).toContain('true');
  });

  it('returns count 0 without deleting when no rows match the predicate', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([]); // select finds nothing

    const result = await handler.execute(
      context({ cutoff: { cutoff: 1704067200000 } }),
      step({
        schemaId: 'schema-1',
        filters: { fetchedAt: { op: 'lt', value: 'steps.cutoff.cutoff' } },
      }),
    );

    expect(result.output).toEqual({ count: 0, deletedIds: [] });
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('single-recordId delete still works (back-compat)', async () => {
    const { handler } = buildHandler();
    mockDb.__queue([{ id: 'rec-1' }]);
    mockDb.__queue([{ id: 'rec-1' }]);

    const result = await handler.execute(
      context(),
      step({ schemaId: 'schema-1', recordId: 'rec-1' }),
    );

    expect(result.output).toEqual({ count: 1, deletedIds: ['rec-1'] });
  });

  it('rejects a schema belonging to another project', async () => {
    const { handler, schemasService } = buildHandler();
    schemasService.getById.mockResolvedValueOnce({ ...SCHEMA, projectId: 'other-proj' } as any);

    await expect(
      handler.execute(context(), step({ schemaId: 'schema-1', recordId: 'rec-1' })),
    ).rejects.toThrow(/does not belong to this project/);
  });
});
