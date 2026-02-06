import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { domainMappings } from './domain-mappings.schema';
import { users } from './users.schema';

/**
 * Path Redirects
 *
 * Handles path-level redirects within a domain (e.g., /old-page -> /new-page).
 * Unlike domain redirects which redirect entire domains, path redirects
 * allow redirecting specific paths while keeping the domain the same.
 *
 * Examples:
 *   /old-blog/* -> /blog/*
 *   /legacy/products -> /products
 *   /api/v1/* -> /api/v2/*
 */
export const pathRedirects = pgTable(
  'path_redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // The domain mapping this redirect belongs to
    domainMappingId: uuid('domain_mapping_id')
      .notNull()
      .references(() => domainMappings.id, { onDelete: 'cascade' }),

    // Source path to match (supports wildcards: /old-blog/*)
    sourcePath: varchar('source_path', { length: 500 }).notNull(),

    // Target path to redirect to (/blog/$1 for wildcard replacement)
    targetPath: varchar('target_path', { length: 500 }).notNull(),

    // Redirect type: 301 (permanent) or 302 (temporary)
    redirectType: varchar('redirect_type', { length: 10 })
      .notNull()
      .default('301')
      .$type<'301' | '302'>(),

    // Whether this redirect is currently active
    isActive: boolean('is_active').notNull().default(true),

    // Sort order for matching (lower = higher priority)
    priority: varchar('priority', { length: 10 }).notNull().default('100'),

    // User who created this redirect
    createdBy: uuid('created_by').references(() => users.id),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('path_redirects_domain_mapping_id_idx').on(table.domainMappingId),
    index('path_redirects_source_path_idx').on(table.sourcePath),
  ],
);

export const pathRedirectsRelations = relations(pathRedirects, ({ one }) => ({
  domainMapping: one(domainMappings, {
    fields: [pathRedirects.domainMappingId],
    references: [domainMappings.id],
  }),
  creator: one(users, {
    fields: [pathRedirects.createdBy],
    references: [users.id],
  }),
}));

export type PathRedirect = typeof pathRedirects.$inferSelect;
export type NewPathRedirect = typeof pathRedirects.$inferInsert;
