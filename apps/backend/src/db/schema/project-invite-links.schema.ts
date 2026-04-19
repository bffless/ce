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
import { users } from './users.schema';

export const projectInviteLinks = pgTable(
  'project_invite_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    role: varchar('role', { length: 50 }).notNull().default('guest'),
    label: varchar('label', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    expiresAt: timestamp('expires_at'),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at'),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('project_invite_links_project_id_idx').on(table.projectId),
    uniqueIndex('project_invite_links_token_idx').on(table.token),
    index('project_invite_links_is_active_idx').on(table.isActive),
  ],
);

export const projectInviteLinksRelations = relations(projectInviteLinks, ({ one }) => ({
  project: one(projects, {
    fields: [projectInviteLinks.projectId],
    references: [projects.id],
  }),
  createdByUser: one(users, {
    fields: [projectInviteLinks.createdBy],
    references: [users.id],
  }),
}));

export type ProjectInviteLink = typeof projectInviteLinks.$inferSelect;
export type NewProjectInviteLink = typeof projectInviteLinks.$inferInsert;
