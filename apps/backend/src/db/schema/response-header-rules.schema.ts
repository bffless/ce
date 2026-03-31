import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  text,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * Response header rules define custom HTTP response headers for specific path patterns.
 * Primary use case: controlling iframe embedding (CSP frame-ancestors) per path.
 * Rules are evaluated in priority order; first match wins.
 */
export const responseHeaderRules = pgTable(
  'response_header_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Glob pattern to match request paths.
     * Examples: "embed/**", "*.html", "widget/*"
     */
    pathPattern: varchar('path_pattern', { length: 500 }).notNull(),

    /**
     * Frame embedding policy for matching paths.
     * - 'sameorigin': Only allow same-origin framing (default behavior)
     * - 'allow': Allow specific origins to iframe (uses allowedOrigins)
     * - 'deny': Block all framing
     */
    framePolicy: varchar('frame_policy', { length: 20 })
      .notNull()
      .default('sameorigin')
      .$type<'sameorigin' | 'allow' | 'deny'>(),

    /**
     * Origins allowed to iframe content when framePolicy is 'allow'.
     * Each entry should be a full origin: "https://example.com"
     * Stored as JSON array.
     */
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().default([]),

    /**
     * Additional custom response headers to set.
     * Key-value pairs, e.g. { "X-Custom-Header": "value" }
     * Set a value to null to remove a default header.
     */
    customHeaders: jsonb('custom_headers').$type<Record<string, string | null>>(),

    /**
     * Rule priority. Lower = higher priority (evaluated first).
     */
    priority: integer('priority').notNull().default(100),

    /**
     * Whether this rule is enabled.
     */
    isEnabled: boolean('is_enabled').notNull().default(true),

    /**
     * Optional human-readable name for the rule.
     */
    name: varchar('name', { length: 100 }),

    /**
     * Optional description explaining the rule's purpose.
     */
    description: varchar('description', { length: 500 }),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('response_header_rules_project_pattern_unique').on(
      table.projectId,
      table.pathPattern,
    ),
    index('response_header_rules_project_id_idx').on(table.projectId),
    index('response_header_rules_project_priority_idx').on(table.projectId, table.priority),
  ],
);

/**
 * Relations for response header rules
 */
export const responseHeaderRulesRelations = relations(responseHeaderRules, ({ one }) => ({
  project: one(projects, {
    fields: [responseHeaderRules.projectId],
    references: [projects.id],
  }),
}));

export type ResponseHeaderRule = typeof responseHeaderRules.$inferSelect;
export type NewResponseHeaderRule = typeof responseHeaderRules.$inferInsert;
