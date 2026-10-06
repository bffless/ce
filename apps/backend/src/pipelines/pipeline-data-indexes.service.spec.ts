import {
  createIndexSql,
  dropIndexSql,
  indexName,
  indexPrefix,
  indexedFieldNames,
  planIndexes,
} from './pipeline-data-indexes.service';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';

/**
 * The per-schema field indexes on pipeline_data: an app marks the fields its
 * rules filter on `indexed: true` in its schema, and CE keeps a partial
 * expression index per such field. Pure planning here; the service's SQL
 * execution is a thin wrapper (database-level behaviour is Postgres's).
 */
describe('pipeline_data field indexes', () => {
  const schemaId = '64e5f008-77b4-47c9-94fe-863c78634845';
  const fields: SchemaField[] = [
    { name: 'runId', type: 'string', required: true, indexed: true },
    { name: 'key', type: 'string', required: false, indexed: true },
    { name: 'status', type: 'string', required: false },
    { name: 'notes', type: 'text', required: false, indexed: true },
    { name: 'payload', type: 'json', required: false, indexed: true },
  ];

  it('names an index after the schema and the field, under the identifier limit, without collisions', () => {
    expect(indexPrefix(schemaId)).toBe('pd_64e5f00877b4_');
    const name = indexName(schemaId, 'runId');
    expect(name).toMatch(/^pd_64e5f00877b4_runid_[0-9a-f]{6}$/);
    expect(name.length).toBeLessThanOrEqual(63);
    // Two fields reducing to one slug still get two names.
    expect(indexName(schemaId, 'runId')).not.toBe(indexName(schemaId, 'run_id'));
    expect(indexName(schemaId, 'x'.repeat(80)).length).toBeLessThanOrEqual(63);
    expect(indexName(schemaId, '!!!')).toMatch(/^pd_64e5f00877b4_f_[0-9a-f]{6}$/);
  });

  it('builds a partial expression index on the field for the schema, concurrently, with the names as literals', () => {
    expect(createIndexSql(schemaId, 'runId')).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName(schemaId, 'runId')} ON pipeline_data ((data->>'runId')) WHERE schema_id = '${schemaId}'`,
    );
    // A field name is data: a quote in it is doubled, never an injection.
    expect(createIndexSql(schemaId, "o'brien")).toContain("(data->>'o''brien')");
    expect(() => createIndexSql('pipeline_data; drop table x', 'a')).toThrow(/not a schema id/);
  });

  it('only drops indexes of its own naming', () => {
    expect(dropIndexSql(indexName(schemaId, 'runId'))).toBe(
      `DROP INDEX CONCURRENTLY IF EXISTS ${indexName(schemaId, 'runId')}`,
    );
    expect(() => dropIndexSql('pipeline_data_pkey')).toThrow(/not one of ours/);
  });

  it('plans indexes for the scalar fields marked indexed, and ignores text and json', () => {
    expect(indexedFieldNames(fields)).toEqual(['key', 'runId']);
    const plan = planIndexes(schemaId, fields, []);
    expect(plan.wanted.map((w) => w.field)).toEqual(['runId', 'key']);
    expect(plan.create.map((c) => c.field)).toEqual(['runId', 'key']);
    expect(plan.drop).toEqual([]);
  });

  it("creates what is missing and drops what is no longer declared, leaving other schemas' indexes alone", () => {
    const stale = indexName(schemaId, 'status');
    const other = indexName('11111111-2222-3333-4444-555555555555', 'runId');
    const plan = planIndexes(schemaId, fields, [indexName(schemaId, 'runId'), stale, other]);
    expect(plan.create.map((c) => c.field)).toEqual(['key']);
    expect(plan.drop).toEqual([stale]);
  });

  it('with no fields marked, plans to drop every index of the schema (a deleted schema, or all flags taken away)', () => {
    const plan = planIndexes(
      schemaId,
      [{ name: 'runId', type: 'string', required: true }],
      [indexName(schemaId, 'runId')],
    );
    expect(plan.create).toEqual([]);
    expect(plan.drop).toEqual([indexName(schemaId, 'runId')]);
  });
});
