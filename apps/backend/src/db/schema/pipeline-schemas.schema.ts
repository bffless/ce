import {
  pgTable,
  uuid,
  varchar,
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
     * Field definitions for this schema
     */
    fields: jsonb('fields').$type<SchemaField[]>().notNull(),
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
