import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * HTTP methods that a pipeline can respond to
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Validator types for pre-pipeline validation
 */
export type ValidatorType = 'auth_required' | 'rate_limit';

/**
 * Configuration for a pipeline validator
 */
export interface ValidatorConfig {
  type: ValidatorType;
  config: Record<string, unknown>;
}

/**
 * Pipelines table - defines request handlers for a project
 */
export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    /**
     * Path pattern to match requests (e.g., "/api/contact", "/api/users/:id")
     */
    pathPattern: varchar('path_pattern', { length: 255 }).notNull(),
    /**
     * HTTP methods this pipeline responds to
     */
    httpMethods: jsonb('http_methods').$type<HttpMethod[]>().notNull().default(['POST']),
    /**
     * Validators to run before pipeline execution (auth, rate limiting, etc.)
     */
    validators: jsonb('validators').$type<ValidatorConfig[]>().notNull().default([]),
    /**
     * Whether this pipeline is active
     */
    isEnabled: boolean('is_enabled').notNull().default(true),
    /**
     * Order for matching (lower = higher priority)
     */
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('pipelines_project_id_idx').on(table.projectId),
    index('pipelines_path_pattern_idx').on(table.projectId, table.pathPattern),
    index('pipelines_order_idx').on(table.projectId, table.order),
  ],
);

/**
 * Relations for pipelines
 */
export const pipelinesRelations = relations(pipelines, ({ one }) => ({
  project: one(projects, {
    fields: [pipelines.projectId],
    references: [projects.id],
  }),
}));

export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;
