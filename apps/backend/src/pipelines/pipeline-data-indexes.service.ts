import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';

/**
 * Per-schema indexes on `pipeline_data`, declared field by field (`indexed: true`).
 *
 * Every data record of every schema lives in one `pipeline_data` table as JSONB, and
 * a `data_query` filter is `data->>'field' = $value`. With nothing but the `schema_id`
 * index, that is a scan of every row of the schema, extracting the JSON on each, on
 * every query. An app whose rules filter a table of tens of thousands of rows by one
 * field, often, pays that scan every time; a one-core instance under such an app was
 * found pegged by exactly this (2026-10-06). Which fields an app filters on is the
 * app's to say, in its schema, not CE's to guess.
 *
 * A schema field marked `indexed` gets a PARTIAL EXPRESSION INDEX
 *
 *     CREATE INDEX CONCURRENTLY pd_<schema>_<field>_<hash>
 *       ON pipeline_data ((data->>'<field>')) WHERE schema_id = '<id>'
 *
 * which the planner uses for exactly that filter shape (the query always carries
 * `schema_id = …`). Partial, so each index holds one schema's rows and nothing
 * else; an expression, so the JSON is extracted once at write time, not per read.
 *
 * The same shape as the per-field HNSW index `PipelineEmbeddingsService.ensureHnswIndex`
 * makes for embeddings: an index created for one schema's field when it is first needed.
 *
 * Reconciled, not migrated: whenever a schema's fields are written (created,
 * updated, adopted by the rules-as-code sync) the set of `pd_<schema>_*` indexes is
 * brought to match the fields marked `indexed`, creating and dropping as needed.
 * `CONCURRENTLY` builds without blocking writers and must run outside a
 * transaction, which is why this is its own statement after the schema row is
 * written, not part of it. A failure here is logged and does not fail the schema
 * write: the data is correct without the index, only slower.
 */
@Injectable()
export class PipelineDataIndexesService {
  private readonly logger = new Logger(PipelineDataIndexesService.name);

  /**
   * Bring the schema's indexes to match its fields marked `indexed`. Never throws:
   * the schema row is already written when this runs, and a failure to read or
   * write an index must not turn that success into an error for the caller.
   */
  async reconcile(schemaId: string, fields: readonly SchemaField[]): Promise<IndexPlan> {
    let existing: string[];
    try {
      existing = await this.existingIndexNames(schemaId);
    } catch (error) {
      this.logger.warn(
        `Could not read the indexes of schema ${schemaId}: ${(error as Error).message}`,
      );
      return { create: [], drop: [], wanted: [] };
    }
    const plan = planIndexes(schemaId, fields, existing);
    for (const { name, statement } of plan.create) {
      try {
        await db.execute(sql.raw(statement));
        this.logger.log(`Created index ${name} on pipeline_data for schema ${schemaId}`);
      } catch (error) {
        this.logger.warn(`Could not create index ${name}: ${(error as Error).message}`);
      }
    }
    for (const name of plan.drop) {
      try {
        await db.execute(sql.raw(dropIndexSql(name)));
        this.logger.log(`Dropped index ${name} on pipeline_data for schema ${schemaId}`);
      } catch (error) {
        this.logger.warn(`Could not drop index ${name}: ${(error as Error).message}`);
      }
    }
    return plan;
  }

  /** Drop every index of a schema (its rows are gone with it; a partial index's predicate would just match nothing). */
  async dropAll(schemaId: string): Promise<void> {
    await this.reconcile(schemaId, []);
  }

  private async existingIndexNames(schemaId: string): Promise<string[]> {
    const prefix = indexPrefix(schemaId);
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'pipeline_data' and indexname like ${prefix + '%'}`,
    );
    return rows.map((r) => r.indexname);
  }
}

export interface IndexPlan {
  create: { field: string; name: string; statement: string }[];
  drop: string[];
  /** The indexes the schema should have, by field name. */
  wanted: { field: string; name: string }[];
}

/** The field types an index makes sense for: scalars compared whole. `text` and `json` are not indexed. */
export const INDEXABLE_FIELD_TYPES = ['string', 'number', 'boolean', 'email', 'datetime'] as const;

export const isIndexable = (type: string): boolean =>
  (INDEXABLE_FIELD_TYPES as readonly string[]).includes(type);

/** `pd_<first 12 hex of the schema id>_`: every index of the schema starts with it, which is how they are found again. */
export const indexPrefix = (schemaId: string): string =>
  `pd_${schemaId.replace(/-/g, '').slice(0, 12)}_`;

/**
 * The index's name: the prefix, the field name reduced to identifier characters (at
 * most 24), and six hex characters of the field name's hash so two fields that reduce
 * to the same slug cannot collide. Under Postgres's 63-character identifier limit.
 */
export function indexName(schemaId: string, field: string): string {
  const slug =
    field
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'f';
  const hash = createHash('sha1').update(field).digest('hex').slice(0, 6);
  return `${indexPrefix(schemaId)}${slug}_${hash}`;
}

/** The field name as a SQL string literal: single quotes doubled. Field names are data, never identifiers here. */
const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export function createIndexSql(schemaId: string, field: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(schemaId)) throw new Error(`not a schema id: ${schemaId}`);
  return (
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName(schemaId, field)} ` +
    `ON pipeline_data ((data->>${literal(field)})) WHERE schema_id = ${literal(schemaId)}`
  );
}

export function dropIndexSql(name: string): string {
  if (!/^pd_[0-9a-f]{12}_[a-z0-9_]+$/.test(name)) throw new Error(`not one of ours: ${name}`);
  return `DROP INDEX CONCURRENTLY IF EXISTS ${name}`;
}

/**
 * What to create and what to drop so the schema's indexes match its fields marked
 * `indexed` (of an indexable type). Pure: the caller hands in the index names that
 * exist now (every `pd_<schema>_*` index on the table).
 */
export function planIndexes(
  schemaId: string,
  fields: readonly SchemaField[],
  existing: readonly string[],
): IndexPlan {
  const wanted = fields
    .filter((f) => f.indexed === true && isIndexable(f.type))
    .map((f) => ({ field: f.name, name: indexName(schemaId, f.name) }));
  const wantedNames = new Set(wanted.map((w) => w.name));
  const have = new Set(existing);
  return {
    wanted,
    create: wanted
      .filter((w) => !have.has(w.name))
      .map((w) => ({ ...w, statement: createIndexSql(schemaId, w.field) })),
    drop: existing.filter(
      (name) => name.startsWith(indexPrefix(schemaId)) && !wantedNames.has(name),
    ),
  };
}

/** The names of the fields marked `indexed`, for comparing a payload's declaration with the live schema's. */
export const indexedFieldNames = (fields: readonly SchemaField[]): string[] =>
  fields
    .filter((f) => f.indexed === true && isIndexable(f.type))
    .map((f) => f.name)
    .sort();
