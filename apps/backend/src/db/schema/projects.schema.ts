import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.schema';
import { proxyRuleSets } from './proxy-rule-sets.schema';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    owner: varchar('owner', { length: 255 }).notNull(), // e.g., "bffless"
    name: varchar('name', { length: 255 }).notNull(), // e.g., "ce"
    displayName: varchar('display_name', { length: 255 }), // Optional friendly name
    description: text('description'),
    isPublic: boolean('is_public').default(false).notNull(),
    /**
     * Behavior when unauthenticated user accesses private content.
     * - 'not_found': Return 404 (default, hides existence)
     * - 'redirect_login': Redirect to login page with return URL
     */
    unauthorizedBehavior: varchar('unauthorized_behavior', { length: 20 })
      .default('not_found')
      .notNull(),
    /**
     * Minimum role required to access private content.
     * - 'authenticated': Any logged-in user (default)
     * - 'viewer' | 'contributor' | 'admin' | 'owner': Specific role level
     */
    requiredRole: varchar('required_role', { length: 20 })
      .default('authenticated')
      .notNull(),
    settings: jsonb('settings'), // Extensible settings object

    /**
     * Default proxy rule set for this project.
     * Used as fallback when an alias doesn't have its own proxyRuleSetId.
     * NULL means no default proxy rules.
     */
    defaultProxyRuleSetId: uuid('default_proxy_rule_set_id'),
    // Note: Can't add .references() here due to circular dependency
    // Foreign key will be added via migration SQL

    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('projects_owner_name_unique').on(table.owner, table.name),
    index('projects_created_by_idx').on(table.createdBy),
    index('projects_owner_idx').on(table.owner),
    index('projects_updated_at_idx').on(table.updatedAt),
    index('projects_name_idx').on(table.name),
  ],
);

/**
 * Relations for projects
 */
export const projectsRelations = relations(projects, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [projects.createdBy],
    references: [users.id],
  }),
  // Proxy rule sets belonging to this project
  proxyRuleSets: many(proxyRuleSets),
  // Default proxy rule set for this project
  defaultProxyRuleSet: one(proxyRuleSets, {
    fields: [projects.defaultProxyRuleSetId],
    references: [proxyRuleSets.id],
  }),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
