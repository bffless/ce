import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';
import { proxyRuleSets } from './proxy-rule-sets.schema';
import { aliasProxyRuleSets } from './alias-proxy-rule-sets.schema';

export const deploymentAliases = pgTable(
  'deployment_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Phase 3H: Project reference (NEW)
    projectId: uuid('project_id')
      .references(() => projects.id)
      .notNull(),

    // Repository identifier (e.g., "owner/repo")
    // DEPRECATED (Phase 3H) - Use projectId instead. Will be removed in future.
    repository: varchar('repository', { length: 255 }).notNull(),

    // Alias name (e.g., "main", "production", "latest", "develop")
    alias: varchar('alias', { length: 100 }).notNull(),

    // Points to specific commit SHA
    commitSha: varchar('commit_sha', { length: 40 }).notNull(),

    // References the deployment (assets grouped by deploymentId)
    deploymentId: uuid('deployment_id').notNull(),

    // Phase B5: Visibility override
    // null = inherit from project, true = force public, false = force private
    isPublic: boolean('is_public'),

    // Access control overrides (null = inherit from project)
    // 'not_found' | 'redirect_login'
    unauthorizedBehavior: varchar('unauthorized_behavior', { length: 20 }),
    // 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner'
    requiredRole: varchar('required_role', { length: 20 }),

    // Auto-preview aliases (generated from basePath during upload)
    isAutoPreview: boolean('is_auto_preview').default(false).notNull(),

    // Base path for SPA preview (e.g., '/apps/frontend/dist')
    basePath: varchar('base_path', { length: 512 }),

    /**
     * @deprecated Use alias_proxy_rule_sets join table instead.
     * Kept for backwards compatibility — the system reads from the join table first,
     * falling back to this column if the join table is empty.
     * When writing, both this column and the join table are updated.
     */
    proxyRuleSetId: uuid('proxy_rule_set_id').references(() => proxyRuleSets.id, {
      onDelete: 'set null',
    }),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Phase 3H: NEW - Unique constraint: one alias per project
    uniqueIndex('deployment_aliases_project_alias_unique').on(table.projectId, table.alias),
    // Index for project lookups
    index('deployment_aliases_project_id_idx').on(table.projectId),
    // DEPRECATED - Unique constraint: one alias per repository (keep for migration)
    uniqueIndex('deployment_aliases_repository_alias_unique').on(table.repository, table.alias),
    // DEPRECATED - Index for looking up by repository (keep for migration)
    index('deployment_aliases_repository_idx').on(table.repository),
    // Index for looking up by commitSha
    index('deployment_aliases_commit_sha_idx').on(table.commitSha),
    // Index for looking up by deploymentId
    index('deployment_aliases_deployment_id_idx').on(table.deploymentId),
  ],
);

/**
 * Relations for deployment aliases
 */
export const deploymentAliasesRelations = relations(deploymentAliases, ({ one, many }) => ({
  project: one(projects, {
    fields: [deploymentAliases.projectId],
    references: [projects.id],
  }),
  // Legacy: single proxy rule set for this alias (overrides project default)
  proxyRuleSet: one(proxyRuleSets, {
    fields: [deploymentAliases.proxyRuleSetId],
    references: [proxyRuleSets.id],
  }),
  // New: multiple proxy rule sets via join table
  aliasProxyRuleSets: many(aliasProxyRuleSets),
}));

export type DeploymentAlias = typeof deploymentAliases.$inferSelect;
export type NewDeploymentAlias = typeof deploymentAliases.$inferInsert;
