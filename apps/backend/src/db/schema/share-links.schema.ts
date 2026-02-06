import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';
import { domainMappings } from './domain-mappings.schema';
import { users } from './users.schema';

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    domainMappingId: uuid('domain_mapping_id').references(
      () => domainMappings.id,
      { onDelete: 'cascade' },
    ),
    token: varchar('token', { length: 64 }).notNull().unique(),
    label: varchar('label', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    expiresAt: timestamp('expires_at'),
    lastUsedAt: timestamp('last_used_at'),
    useCount: integer('use_count').notNull().default(0),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('share_links_project_id_idx').on(table.projectId),
    index('share_links_domain_mapping_id_idx').on(table.domainMappingId),
    uniqueIndex('share_links_token_idx').on(table.token),
    index('share_links_is_active_idx').on(table.isActive),
  ],
);

export const shareLinksRelations = relations(shareLinks, ({ one }) => ({
  project: one(projects, {
    fields: [shareLinks.projectId],
    references: [projects.id],
  }),
  domainMapping: one(domainMappings, {
    fields: [shareLinks.domainMappingId],
    references: [domainMappings.id],
  }),
  createdByUser: one(users, {
    fields: [shareLinks.createdBy],
    references: [users.id],
  }),
}));

export type ShareLink = typeof shareLinks.$inferSelect;
export type NewShareLink = typeof shareLinks.$inferInsert;
