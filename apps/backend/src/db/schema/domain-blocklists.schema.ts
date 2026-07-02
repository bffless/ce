import { pgTable, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { domainMappings } from './domain-mappings.schema';
import { blocklists } from './blocklists.schema';

/**
 * Join table for domain mapping → Blocklist (issue #393), mirroring how proxy
 * rule sets attach to aliases (alias_proxy_rule_sets).
 *
 * A domain's effective enforcement set = the code-shipped Baseline + every
 * Blocklist with isDefault=true + the Blocklists attached here. There is no
 * `order` column: unlike proxy rules, blocklist patterns merge as a plain
 * union (allow always beats block), so attachment order carries no meaning.
 *
 * ON DELETE CASCADE on both FKs:
 * - Deleting a domain mapping removes its attachments
 * - Deleting a Blocklist detaches it everywhere (no orphaned references)
 */
export const domainBlocklists = pgTable(
  'domain_blocklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    domainMappingId: uuid('domain_mapping_id')
      .references(() => domainMappings.id, { onDelete: 'cascade' })
      .notNull(),

    blocklistId: uuid('blocklist_id')
      .references(() => blocklists.id, { onDelete: 'cascade' })
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('domain_blocklists_domain_blocklist_unique').on(
      table.domainMappingId,
      table.blocklistId,
    ),
    index('domain_blocklists_domain_mapping_id_idx').on(table.domainMappingId),
    index('domain_blocklists_blocklist_id_idx').on(table.blocklistId),
  ],
);

export const domainBlocklistsRelations = relations(domainBlocklists, ({ one }) => ({
  domainMapping: one(domainMappings, {
    fields: [domainBlocklists.domainMappingId],
    references: [domainMappings.id],
  }),
  blocklist: one(blocklists, {
    fields: [domainBlocklists.blocklistId],
    references: [blocklists.id],
  }),
}));

export type DomainBlocklist = typeof domainBlocklists.$inferSelect;
export type NewDomainBlocklist = typeof domainBlocklists.$inferInsert;
