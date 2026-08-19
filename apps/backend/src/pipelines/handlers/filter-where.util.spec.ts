import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import {
  DATA_FILTER_OPS,
  DataFilters,
  buildFilterConditions,
  validateFilterOps,
} from './filter-where.util';
import { ConfigurationError } from '../errors';

/** Render a drizzle condition into SQL text + bound params. */
function render(condition: SQL | undefined): { sql: string; params: unknown[] } {
  if (!condition) throw new Error('expected a condition');
  return new PgDialect().sqlToQuery(condition);
}

// Identity evaluator: literals pass through. Handlers bind their own
// expressionEvaluator; the util only needs a (value) => resolved callback.
const literal = (value: string): unknown => value;

describe('filter-where.util', () => {
  describe('validateFilterOps', () => {
    it('accepts every operator in DATA_FILTER_OPS', () => {
      for (const op of DATA_FILTER_OPS) {
        expect(() => validateFilterOps({ f: { op, value: 'x' } }, 'data_query')).not.toThrow();
      }
    });

    it('is a no-op for undefined filters', () => {
      expect(() => validateFilterOps(undefined, 'data_query')).not.toThrow();
    });

    it('rejects unknown operators with a ConfigurationError naming the field and handler', () => {
      expect(() =>
        validateFilterOps({ fetchedAt: { op: 'between', value: '1' } }, 'data_update'),
      ).toThrow(ConfigurationError);
      expect(() =>
        validateFilterOps({ fetchedAt: { op: 'between', value: '1' } }, 'data_update'),
      ).toThrow(
        /Invalid operator 'between' for field 'fetchedAt'\. Valid operators: eq, ne, gt, lt, gte, lte, like, in/,
      );
    });
  });

  describe('buildFilterConditions', () => {
    it('returns undefined for no filters', () => {
      expect(buildFilterConditions(undefined, undefined, literal)).toBeUndefined();
      expect(buildFilterConditions({}, 'and', literal)).toBeUndefined();
    });

    it('eq binds the value as a string against data->>field', () => {
      const { sql, params } = render(
        buildFilterConditions({ status: { op: 'eq', value: 'open' } }, undefined, literal),
      );
      expect(sql).toContain(`"pipeline_data"."data"->>'status' = $1`);
      expect(params).toEqual(['open']);
    });

    it('ne is null-safe (IS DISTINCT FROM, never !=)', () => {
      const { sql, params } = render(
        buildFilterConditions({ starred: { op: 'ne', value: 'true' } }, undefined, literal),
      );
      expect(sql.toLowerCase()).toContain('is distinct from');
      expect(sql).not.toContain('!=');
      expect(params).toEqual(['true']);
    });

    it.each([
      ['gt', '>'],
      ['lt', '<'],
      ['gte', '>='],
      ['lte', '<='],
    ] as const)('%s casts the field to numeric and binds a number', (op, symbol) => {
      const { sql, params } = render(
        buildFilterConditions({ fetchedAt: { op, value: '1704067200000' } }, undefined, literal),
      );
      expect(sql).toContain(`("pipeline_data"."data"->>'fetchedAt')::numeric ${symbol} $1`);
      expect(params).toEqual([1704067200000]);
    });

    it('like uses case-insensitive ILIKE', () => {
      const { sql, params } = render(
        buildFilterConditions({ title: { op: 'like', value: '%news%' } }, undefined, literal),
      );
      expect(sql).toContain(`"pipeline_data"."data"->>'title' ILIKE $1`);
      expect(params).toEqual(['%news%']);
    });

    it('in delegates to buildInPredicate (array resolved by the evaluator)', () => {
      const evaluate = (value: string): unknown =>
        value === 'steps.prep.urls' ? ['https://a.com', 'https://b.com'] : value;
      const { sql, params } = render(
        buildFilterConditions(
          { feedId: { op: 'in', value: 'steps.prep.urls' } },
          undefined,
          evaluate,
        ),
      );
      expect(sql.toLowerCase()).toContain('in (');
      expect(params).toEqual(['https://a.com', 'https://b.com']);
    });

    it('resolves each filter value through the supplied evaluator', () => {
      const evaluate = jest.fn((value: string) => (value === 'steps.cutoff.ms' ? 42 : value));
      const { params } = render(
        buildFilterConditions(
          { fetchedAt: { op: 'lt', value: 'steps.cutoff.ms' }, read: { op: 'eq', value: 'true' } },
          undefined,
          evaluate,
        ),
      );
      expect(evaluate).toHaveBeenCalledWith('steps.cutoff.ms');
      expect(evaluate).toHaveBeenCalledWith('true');
      expect(params).toEqual([42, 'true']);
    });

    it('combines multiple filters with AND by default', () => {
      const filters: DataFilters = {
        read: { op: 'eq', value: 'true' },
        fetchedAt: { op: 'lt', value: '100' },
      };
      const { sql } = render(buildFilterConditions(filters, undefined, literal));
      expect(sql).toMatch(/\$1 and \(/i);
      expect(sql).not.toMatch(/\$1 or \(/i);
    });

    it("combines multiple filters with OR when filterLogic is 'or'", () => {
      const filters: DataFilters = {
        read: { op: 'eq', value: 'true' },
        fetchedAt: { op: 'lt', value: '100' },
      };
      const { sql } = render(buildFilterConditions(filters, 'or', literal));
      expect(sql).toMatch(/\$1 or \(/i);
      expect(sql).not.toMatch(/\$1 and \(/i);
    });
  });
});
