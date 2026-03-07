import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';
import { pipelineSchemas } from './pipeline-schemas.schema';
import { users } from './users.schema';

/**
 * Pipeline data table - stores data records created by pipeline handlers
 */
export const pipelineData = pgTable(
  'pipeline_data',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => pipelineSchemas.id, { onDelete: 'cascade' }),
    /**
     * The actual data record (JSON object matching the schema fields)
     */
    data: jsonb('data').notNull(),
    /**
     * User who created this record (null for anonymous/API submissions)
     */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('pipeline_data_project_id_idx').on(table.projectId),
    index('pipeline_data_schema_id_idx').on(table.schemaId),
    index('pipeline_data_created_at_idx').on(table.projectId, table.createdAt),
  ],
);

/**
 * Relations for pipeline data
 */
export const pipelineDataRelations = relations(pipelineData, ({ one }) => ({
  project: one(projects, {
    fields: [pipelineData.projectId],
    references: [projects.id],
  }),
  schema: one(pipelineSchemas, {
    fields: [pipelineData.schemaId],
    references: [pipelineSchemas.id],
  }),
  createdByUser: one(users, {
    fields: [pipelineData.createdBy],
    references: [users.id],
  }),
}));

export type PipelineData = typeof pipelineData.$inferSelect;
export type NewPipelineData = typeof pipelineData.$inferInsert;
