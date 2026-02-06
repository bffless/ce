import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects.schema';
import { users } from './users.schema';

export const primaryContent = pgTable('primary_content', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Is primary content routing enabled?
  enabled: boolean('enabled').notNull().default(false),

  // Which project to serve
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),

  // Which alias (e.g., 'production', 'staging')
  alias: varchar('alias', { length: 255 }),

  // Optional path within the deployment (e.g., '/dist')
  path: varchar('path', { length: 500 }),

  // Whether to enable www subdomain support
  // When false: only serve on root domain (no www server blocks)
  // When true: use wwwBehavior to determine redirect behavior
  wwwEnabled: boolean('www_enabled').notNull().default(true),

  // www redirect behavior (only applies when wwwEnabled is true)
  // 'redirect-to-www': j5s.dev → 301 → www.j5s.dev
  // 'redirect-to-root': www.j5s.dev → 301 → j5s.dev
  // 'serve-both': both domains serve content directly
  wwwBehavior: varchar('www_behavior', { length: 50 }).notNull().default('redirect-to-www'),

  // Is this a Single Page Application?
  // When true: 404s fallback to index.html for client-side routing
  // When false: 404s show the 404 error page (static site behavior)
  isSpa: boolean('is_spa').notNull().default(false),

  // Who configured this
  configuredBy: uuid('configured_by').references(() => users.id),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type PrimaryContent = typeof primaryContent.$inferSelect;
export type NewPrimaryContent = typeof primaryContent.$inferInsert;
