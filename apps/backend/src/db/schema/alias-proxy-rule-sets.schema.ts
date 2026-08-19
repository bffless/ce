import { pgTable, uuid, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { deploymentAliases } from './deployment-aliases.schema';
import { proxyRuleSets } from './proxy-rule-sets.schema';

/**
 * Join table for alias → proxy rule set (many-to-many).
 *
 * Allows multiple proxy rule sets to be attached to a single alias.
 * Rules are merged in `order` priority (lower = higher priority).
 * If two rule sets define the same path+method, the lower-ordered set's rule wins.
 *
 * ON DELETE CASCADE on both FKs:
 * - Deleting an alias removes its join rows
 * - Deleting a rule set removes its join rows (no orphaned references)
 */
export const aliasProxyRuleSets = pgTable(
  'alias_proxy_rule_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    aliasId: uuid('alias_id')
      .references(() => deploymentAliases.id, { onDelete: 'cascade' })
      .notNull(),

    proxyRuleSetId: uuid('proxy_rule_set_id')
      .references(() => proxyRuleSets.id, { onDelete: 'cascade' })
      .notNull(),

    /** Merge priority — lower numbers are evaluated first */
    order: integer('order').notNull().default(0),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('alias_proxy_rule_sets_alias_ruleset_unique').on(
      table.aliasId,
      table.proxyRuleSetId,
    ),
    index('alias_proxy_rule_sets_alias_id_idx').on(table.aliasId),
    index('alias_proxy_rule_sets_rule_set_id_idx').on(table.proxyRuleSetId),
  ],
);

export const aliasProxyRuleSetsRelations = relations(aliasProxyRuleSets, ({ one }) => ({
  alias: one(deploymentAliases, {
    fields: [aliasProxyRuleSets.aliasId],
    references: [deploymentAliases.id],
  }),
  proxyRuleSet: one(proxyRuleSets, {
    fields: [aliasProxyRuleSets.proxyRuleSetId],
    references: [proxyRuleSets.id],
  }),
}));

export type AliasProxyRuleSet = typeof aliasProxyRuleSets.$inferSelect;
export type NewAliasProxyRuleSet = typeof aliasProxyRuleSets.$inferInsert;
