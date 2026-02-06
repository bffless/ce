import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * Cache rules define HTTP caching behavior for specific path patterns.
 * Rules are evaluated in priority order; first match wins.
 */
export const cacheRules = pgTable(
  'cache_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Glob pattern to match request paths.
     * Examples: "*.js", "*.css", "images/**", "index.html", "api/**"
     */
    pathPattern: varchar('path_pattern', { length: 500 }).notNull(),

    /**
     * Browser cache max-age in seconds.
     * 0 = no-cache (always revalidate)
     */
    browserMaxAge: integer('browser_max_age').notNull().default(300),

    /**
     * CDN/proxy cache max-age in seconds (s-maxage directive).
     * null = use browserMaxAge
     */
    cdnMaxAge: integer('cdn_max_age'),

    /**
     * Stale-while-revalidate duration in seconds.
     * null = don't include this directive
     */
    staleWhileRevalidate: integer('stale_while_revalidate'),

    /**
     * Whether content is immutable (no revalidation needed).
     * Typically true for content-hashed files like main.abc123.js
     */
    immutable: boolean('immutable').notNull().default(false),

    /**
     * Cache directive: public (can be cached by CDNs) or private (browser only).
     * null = inherit from project visibility
     */
    cacheability: varchar('cacheability', { length: 10 }).$type<
      'public' | 'private' | null
    >(),

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
    uniqueIndex('cache_rules_project_pattern_unique').on(table.projectId, table.pathPattern),
    index('cache_rules_project_id_idx').on(table.projectId),
    index('cache_rules_project_priority_idx').on(table.projectId, table.priority),
  ],
);

/**
 * Relations for cache rules
 */
export const cacheRulesRelations = relations(cacheRules, ({ one }) => ({
  project: one(projects, {
    fields: [cacheRules.projectId],
    references: [projects.id],
  }),
}));

export type CacheRule = typeof cacheRules.$inferSelect;
export type NewCacheRule = typeof cacheRules.$inferInsert;
