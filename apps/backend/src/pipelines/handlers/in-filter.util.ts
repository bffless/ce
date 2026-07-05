import { sql, SQL } from 'drizzle-orm';

/**
 * Build a parameterized `<fieldPath> IN (...)` predicate for the `in` filter
 * operator. The value is expression-resolved upstream and treated as an array
 * (a scalar is wrapped into a single-element list; null/undefined → empty).
 * JSONB fields are text (`data->>'field'`), so elements are bound as strings.
 * An empty array compiles to a match-nothing predicate (never invalid `IN ()`).
 */
export function buildInPredicate(fieldPath: SQL, value: unknown): SQL {
  const arr = value == null ? [] : Array.isArray(value) ? value : [value];
  if (arr.length === 0) {
    return sql`false`;
  }
  const elements = sql.join(
    arr.map((el) => sql`${String(el)}`),
    sql`, `,
  );
  return sql`${fieldPath} in (${elements})`;
}
