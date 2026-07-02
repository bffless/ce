import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Blocklists (issue #383/#391): the admin-global library of named bot/scanner
 * blocklists, per ADR-0002. Each Blocklist owns custom path patterns plus its
 * own allowlist of exceptions that always win (both stored in
 * blocklist_entries, discriminated by `kind`).
 *
 * Blocklists are admin-global (not project-scoped): they curate instance-wide
 * bot protection. Since #393 a Blocklist applies per-domain: to every domain
 * when `isDefault` is true, otherwise only to the domains it is attached to
 * via domain_blocklists. The code-shipped Baseline (see
 * traffic/blocklist-baseline.ts) is NOT one of these rows — it ships as code,
 * improves on upgrade, and applies to every domain unconditionally.
 */
export const blocklists = pgTable(
  'blocklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Human-readable name, unique across the instance (the library is admin-global). */
    name: varchar('name', { length: 255 }).notNull(),

    description: text('description'),

    /**
     * The all-domains default attachment (#393): true means the list applies
     * to every domain (plus the wildcard/unknown-host fallback), no explicit
     * attachment needed. Defaults true so pre-#393 lists keep their original
     * instance-wide behaviour across the upgrade.
     */
    isDefault: boolean('is_default').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('blocklists_name_unique').on(table.name)],
);

/**
 * A single structured pattern belonging to a Blocklist.
 *
 * Patterns are stored structured — never as raw regex or nginx config — so the
 * compiler (traffic/blocklist-compiler.ts) is the only thing that ever turns
 * admin input into matching rules. `value` is validated against a strict path
 * charset before insert; see validateBlocklistValue.
 */
export const blocklistEntries = pgTable(
  'blocklist_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    blocklistId: uuid('blocklist_id')
      .references(() => blocklists.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * block: the pattern refuses matching requests.
     * allow: the pattern is an exception that always wins over any block
     *        pattern (including the Baseline's) — the false-positive rescue.
     */
    kind: varchar('kind', { length: 10 }).$type<'block' | 'allow'>().notNull().default('block'),

    /** How `value` matches the request path (see BlocklistMatchType). */
    matchType: varchar('match_type', { length: 20 })
      .$type<'prefix' | 'exact' | 'suffix' | 'extension' | 'contains'>()
      .notNull()
      .default('prefix'),

    value: varchar('value', { length: 512 }).notNull(),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('blocklist_entries_blocklist_id_idx').on(table.blocklistId),
    // The same pattern twice in one list is a no-op; keep the data clean.
    uniqueIndex('blocklist_entries_unique').on(
      table.blocklistId,
      table.kind,
      table.matchType,
      table.value,
    ),
  ],
);

export const blocklistsRelations = relations(blocklists, ({ many }) => ({
  entries: many(blocklistEntries),
}));

export const blocklistEntriesRelations = relations(blocklistEntries, ({ one }) => ({
  blocklist: one(blocklists, {
    fields: [blocklistEntries.blocklistId],
    references: [blocklists.id],
  }),
}));

export type Blocklist = typeof blocklists.$inferSelect;
export type NewBlocklist = typeof blocklists.$inferInsert;
export type BlocklistEntry = typeof blocklistEntries.$inferSelect;
export type NewBlocklistEntry = typeof blocklistEntries.$inferInsert;
