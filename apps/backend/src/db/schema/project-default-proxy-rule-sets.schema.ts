import { pgTable, uuid, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';
import { proxyRuleSets } from './proxy-rule-sets.schema';

/**
 * Join table for project default proxy rule sets (many-to-many).
 *
 * Allows multiple proxy rule sets to be set as project defaults.
 * When an alias has no rule sets assigned, these defaults are used.
 * Rules are merged in `order` priority (lower = higher priority).
 *
 * ON DELETE CASCADE on both FKs:
 * - Deleting a project removes its join rows
 * - Deleting a rule set removes its join rows
 */
export const projectDefaultProxyRuleSets = pgTable(
  'project_default_proxy_rule_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    proxyRuleSetId: uuid('proxy_rule_set_id')
      .references(() => proxyRuleSets.id, { onDelete: 'cascade' })
      .notNull(),

    /** Merge priority — lower numbers are evaluated first */
    order: integer('order').notNull().default(0),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('project_default_proxy_rule_sets_project_ruleset_unique').on(
      table.projectId,
      table.proxyRuleSetId,
    ),
    index('project_default_proxy_rule_sets_project_id_idx').on(table.projectId),
    index('project_default_proxy_rule_sets_rule_set_id_idx').on(table.proxyRuleSetId),
  ],
);

export const projectDefaultProxyRuleSetsRelations = relations(
  projectDefaultProxyRuleSets,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectDefaultProxyRuleSets.projectId],
      references: [projects.id],
    }),
    proxyRuleSet: one(proxyRuleSets, {
      fields: [projectDefaultProxyRuleSets.proxyRuleSetId],
      references: [proxyRuleSets.id],
    }),
  }),
);

export type ProjectDefaultProxyRuleSet = typeof projectDefaultProxyRuleSets.$inferSelect;
export type NewProjectDefaultProxyRuleSet = typeof projectDefaultProxyRuleSets.$inferInsert;
