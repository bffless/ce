import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.schema';
import { aliasProxyRuleSets } from './alias-proxy-rule-sets.schema';

/**
 * Proxy Rule Sets - Reusable groups of proxy rules.
 *
 * Rule sets allow proxy rules to be defined once and reused across multiple aliases
 * or as project-level defaults. This enables:
 *
 * 1. **Project defaults**: Set a default rule set for a project that applies to all
 *    aliases without their own override (via projects.defaultProxyRuleSetId)
 *
 * 2. **Alias overrides**: Assign a specific rule set to an alias to override
 *    the project default (via deployment_aliases.proxyRuleSetId)
 *
 * 3. **Auto-preview support**: Specify a rule set during upload for auto-generated
 *    preview aliases
 *
 * Resolution order:
 *   1. If alias has a proxyRuleSetId -> use that rule set
 *   2. Else if project has a defaultProxyRuleSetId -> use that rule set
 *   3. Else -> no proxy rules apply
 */
export const proxyRuleSets = pgTable(
  'proxy_rule_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The project this rule set belongs to.
     * Rule sets are project-scoped for organization and permissions.
     */
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Human-readable name for the rule set.
     * Must be unique per project.
     *
     * Examples: "api-backend", "graphql-proxy", "staging-api"
     */
    name: varchar('name', { length: 255 }).notNull(),

    /**
     * Optional description explaining what this rule set does.
     */
    description: text('description'),

    /**
     * Optional environment tag for organizing rule sets.
     * Useful when you have similar rules for different environments.
     *
     * Examples: "development", "staging", "production"
     */
    environment: varchar('environment', { length: 50 }),

    /**
     * Rules-as-code provenance, written by the sync endpoint
     * (PUT /api/proxy-rule-sets/project/:projectId/sync) and never by manual
     * edits. Null for sets that have never been synced from git. Kept (not
     * cleared) when a set is later edited via the dashboard/MCP — drift is
     * detected by contentHash comparison, and the UI warns that manual edits
     * will be overwritten on the next deploy.
     */
    source: jsonb('source').$type<ProxyRuleSetSource>(),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    /**
     * Each project can only have one rule set with a given name.
     */
    uniqueIndex('proxy_rule_sets_project_name_unique').on(table.projectId, table.name),

    /**
     * Index for efficient lookup by project.
     */
    index('proxy_rule_sets_project_id_idx').on(table.projectId),

    /**
     * Index for filtering by environment.
     */
    index('proxy_rule_sets_environment_idx').on(table.projectId, table.environment),
  ],
);

/**
 * Relations for proxy rule sets
 */
export const proxyRuleSetsRelations = relations(proxyRuleSets, ({ one, many }) => ({
  project: one(projects, {
    fields: [proxyRuleSets.projectId],
    references: [projects.id],
  }),
  // Aliases using this rule set (via join table)
  aliasProxyRuleSets: many(aliasProxyRuleSets),
}));

/**
 * Provenance metadata for a rule set managed from git via the sync endpoint.
 * repo/path/gitSha are caller-supplied (best-effort from CI env or git);
 * syncedAt and contentHash are stamped server-side on every successful sync.
 */
export interface ProxyRuleSetSource {
  /** Source repository, e.g. "bffless/apps". */
  repo?: string;
  /** Rule-set directory path within the repo. */
  path?: string;
  /** Commit SHA the synced payload was built from. */
  gitSha?: string;
  /** ISO timestamp of the last successful sync. */
  syncedAt: string;
  /** sha256 of the defaults-normalized synced payload (see the Phase 1 plan doc). */
  contentHash: string;
}

// Type exports
export type ProxyRuleSet = typeof proxyRuleSets.$inferSelect;
export type NewProxyRuleSet = typeof proxyRuleSets.$inferInsert;
