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
import { projectDefaultProxyRuleSets } from './project-default-proxy-rule-sets.schema';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    owner: varchar('owner', { length: 255 }).notNull(), // e.g., "bffless"
    name: varchar('name', { length: 255 }).notNull(), // e.g., "ce"
    displayName: varchar('display_name', { length: 255 }), // Optional friendly name
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
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
    requiredRole: varchar('required_role', { length: 20 }).default('authenticated').notNull(),
    /**
     * When true, anonymous visitors can self-register on this project's site
     * and are auto-granted a `guest` membership. Only consulted when the
     * platform feature flag REQUIRE_PROJECT_MEMBERSHIP is enabled; otherwise
     * the legacy "any workspace user can authenticate anywhere" path runs.
     */
    allowPublicSignup: boolean('allow_public_signup').default(false).notNull(),
    settings: jsonb('settings'), // Extensible settings object

    /**
     * AI Provider Configuration (supports multiple providers per project)
     * Each provider is stored with its encrypted config in a JSON array
     * Format: [{ provider: 'openai', config: '<encrypted>', isDefault: true }, ...]
     */
    aiProviders: text('ai_providers'),

    /**
     * AI Service Configuration (external ML services like Replicate)
     * Each service is stored with its encrypted config in a JSON array
     * Format: [{ service: 'replicate', config: '<encrypted>', createdAt: '...' }, ...]
     */
    aiServices: text('ai_services'),

    /**
     * @deprecated Use project_default_proxy_rule_sets join table instead.
     * Kept for backwards compatibility — the system reads from the join table first,
     * falling back to this column if the join table is empty.
     * When writing, both this column and the join table are updated.
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
  // Legacy: single default proxy rule set for this project
  defaultProxyRuleSet: one(proxyRuleSets, {
    fields: [projects.defaultProxyRuleSetId],
    references: [proxyRuleSets.id],
  }),
  // New: multiple default proxy rule sets via join table
  defaultProxyRuleSets: many(projectDefaultProxyRuleSets),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
