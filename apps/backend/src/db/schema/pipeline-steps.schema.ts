import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  boolean,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { pipelines } from './pipelines.schema';

/**
 * Handler types for pipeline steps
 */
export type HandlerType =
  | 'form_handler'
  | 'data_create'
  | 'data_query'
  | 'data_update'
  | 'data_delete'
  | 'email_handler'
  | 'response_handler'
  | 'function_handler'
  | 'aggregate_handler';

/**
 * Pipeline steps table - defines the execution steps within a pipeline
 */
export const pipelineSteps = pgTable(
  'pipeline_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    /**
     * Optional name for referencing this step's output in expressions
     */
    name: varchar('name', { length: 255 }),
    /**
     * Type of handler to execute for this step
     */
    handlerType: varchar('handler_type', { length: 50 }).$type<HandlerType>().notNull(),
    /**
     * Handler-specific configuration (varies by handler type)
     */
    config: jsonb('config').notNull(),
    /**
     * Execution order within the pipeline
     */
    order: integer('order').notNull(),
    /**
     * Whether this step is active
     */
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('pipeline_steps_pipeline_id_idx').on(table.pipelineId),
    index('pipeline_steps_order_idx').on(table.pipelineId, table.order),
  ],
);

/**
 * Relations for pipeline steps
 */
export const pipelineStepsRelations = relations(pipelineSteps, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineSteps.pipelineId],
    references: [pipelines.id],
  }),
}));

export type PipelineStep = typeof pipelineSteps.$inferSelect;
export type NewPipelineStep = typeof pipelineSteps.$inferInsert;
