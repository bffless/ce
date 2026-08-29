import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * Field types supported in pipeline schemas
 */
export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'email'
  | 'text'
  | 'datetime'
  | 'json';

/**
 * Definition of a field in a pipeline schema
 */
export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  required: boolean;
  default?: unknown;
}

/**
 * What a schema is FOR, as declared at creation — not inferred from its fields.
 *
 * Each value corresponds to one of the schema generators, which know the intent
 * at creation time. `null` means "not declared": every schema created before
 * this column existed, and any schema authored by hand. Consumers must treat
 * null as unknown and fall back to their previous behaviour rather than
 * assuming "plain data" (bffless/ce#633).
 *
 * This is PRIMARY INTENT, not exclusivity. An upload schema may legitimately
 * hold rows that aren't files — handoff models a whole file tree, folders
 * included, in one upload schema — so `kind: 'upload'` must never be read as
 * "every row here is a file".
 */
export type SchemaKind = 'upload' | 'chat' | 'state';

/**
 * Provenance of a schema that the rules-as-code sync created or adopted
 * fields onto (bffless/ce#721). Mirrors `ProxyRuleSetSource` on rule sets:
 * it records WHICH rule set (by name — the identity a sync works in) owns the
 * schema, so a later sync of a *different* set that happens to bundle the
 * same schema name can never write fields onto it. `null` means "not
 * stamped": every schema that predates the column, and any schema created
 * from the dashboard or the schema API.
 */
export interface PipelineSchemaSource {
  /** Name of the rule set whose sync created (or first adopted fields onto) this schema. */
  ruleSetName: string;
  /** ISO timestamp of the sync that last wrote this stamp. */
  syncedAt: string;
}

/**
 * Pipeline schemas table - defines data structures for pipeline data storage
 */
export const pipelineSchemas = pgTable(
  'pipeline_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Schema name (unique within project)
     */
    name: varchar('name', { length: 255 }).notNull(),
    /**
     * Schema version number. Bumped when fields change so data records
     * can be associated with the schema definition that created them.
     */
    version: integer('version').notNull().default(1),
    /**
     * Field definitions for this schema
     */
    fields: jsonb('fields').$type<SchemaField[]>().notNull(),
    /**
     * What this schema is for, when it was created by a generator that knew.
     * Nullable on purpose: existing rows keep null, so nothing reclassifies on
     * upgrade and consumers fall back to their field-shape heuristics.
     */
    kind: varchar('kind', { length: 32 }).$type<SchemaKind>(),
    /**
     * Which rule-set sync owns this schema, when one does. Nullable on
     * purpose: existing rows keep null, and the sync's field adoption
     * (bffless/ce#721) falls back to reference-based ownership for them.
     */
    source: jsonb('source').$type<PipelineSchemaSource>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('pipeline_schemas_project_id_idx').on(table.projectId),
    unique('pipeline_schemas_project_name_unique').on(table.projectId, table.name),
  ],
);

/**
 * Relations for pipeline schemas
 */
export const pipelineSchemasRelations = relations(pipelineSchemas, ({ one }) => ({
  project: one(projects, {
    fields: [pipelineSchemas.projectId],
    references: [projects.id],
  }),
}));

export type PipelineSchema = typeof pipelineSchemas.$inferSelect;
export type NewPipelineSchema = typeof pipelineSchemas.$inferInsert;
