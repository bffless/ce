import { and, or, sql, SQL } from 'drizzle-orm';
import { pipelineData } from '../../db/schema';
import { ConfigurationError } from '../errors';
import { buildInPredicate } from './in-filter.util';

/**
 * Operators accepted by the JSONB `filters` config shared by the filter-based
 * data handlers (data_query, data_update, data_delete, db_aggregate).
 *
 * Range ops (gt/lt/gte/lte) cast the field to `::numeric`, so the stored value
 * must be numeric (e.g. epoch-ms timestamps) — not ISO date strings.
 * `like` is case-insensitive (`ILIKE`). `in` accepts an array-resolving
 * expression (see in-filter.util).
 */
export const DATA_FILTER_OPS = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'like', 'in'] as const;

export type DataFilterOp = (typeof DATA_FILTER_OPS)[number];

/** `{ field: { op, value: "expression" } }` — the shape every filter-based handler accepts. */
export type DataFilters = Record<string, { op: DataFilterOp; value: string }>;

/**
 * Validate that every filter uses a known operator.
 * Throws the same `ConfigurationError` shape the handlers historically threw.
 */
export function validateFilterOps(
  filters: Record<string, { op: string; value?: unknown }> | undefined,
  handlerName: string,
): void {
  if (!filters) return;
  for (const [field, filter] of Object.entries(filters)) {
    if (!(DATA_FILTER_OPS as readonly string[]).includes(filter.op)) {
      throw new ConfigurationError(
        `Invalid operator '${filter.op}' for field '${field}'. Valid operators: ${DATA_FILTER_OPS.join(', ')}`,
        handlerName,
      );
    }
  }
}

/**
 * Build the combined drizzle `SQL` condition for a `filters` map on the
 * `pipeline_data.data` JSONB column.
 *
 * `evaluateValue` resolves each `filter.value` (an expression string) — the
 * caller binds it to its own `expressionEvaluator.evaluateExpression(value,
 * context, stepName)` so this util stays free of pipeline context.
 *
 * Returns `undefined` when there are no filters, otherwise the conditions
 * combined with AND (default) or OR per `filterLogic`.
 */
export function buildFilterConditions(
  filters: DataFilters | undefined,
  filterLogic: 'and' | 'or' | undefined,
  evaluateValue: (value: string) => unknown,
): SQL | undefined {
  if (!filters) return undefined;

  const filterConditions: SQL[] = [];

  for (const [fieldName, filter] of Object.entries(filters)) {
    // Evaluate the filter value as an expression
    const value = evaluateValue(filter.value);

    // Build JSONB field accessor for the data column
    const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${fieldName}'`)}`;

    switch (filter.op) {
      case 'eq':
        filterConditions.push(sql`${fieldPath} = ${String(value)}`);
        break;
      case 'ne':
        // IS DISTINCT FROM, not !=: for a row whose JSONB lacks the key, `data->>'f'`
        // is NULL and a bare `!=` yields NULL, silently EXCLUDING the row. Callers
        // read `ne` as "everything that isn't this value", which must include rows
        // where the field was never written (a flag added after the rows existed).
        filterConditions.push(sql`${fieldPath} IS DISTINCT FROM ${String(value)}`);
        break;
      case 'gt':
        filterConditions.push(sql`(${fieldPath})::numeric > ${Number(value)}`);
        break;
      case 'lt':
        filterConditions.push(sql`(${fieldPath})::numeric < ${Number(value)}`);
        break;
      case 'gte':
        filterConditions.push(sql`(${fieldPath})::numeric >= ${Number(value)}`);
        break;
      case 'lte':
        filterConditions.push(sql`(${fieldPath})::numeric <= ${Number(value)}`);
        break;
      case 'like':
        filterConditions.push(sql`${fieldPath} ILIKE ${String(value)}`);
        break;
      case 'in':
        filterConditions.push(buildInPredicate(fieldPath, value));
        break;
    }
  }

  if (filterConditions.length === 0) return undefined;

  // Combine filter conditions with AND or OR based on filterLogic
  return filterLogic === 'or' ? or(...filterConditions) : and(...filterConditions);
}
