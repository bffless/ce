import { pgTable, uuid, varchar, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

export const userGroups = pgTable(
  'user_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('user_groups_created_by_idx').on(table.createdBy)],
);

export const userGroupMembers = pgTable(
  'user_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .references(() => userGroups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    addedBy: uuid('added_by').references(() => users.id),
    addedAt: timestamp('added_at').defaultNow().notNull(),
  },
  (table) => [
    unique('user_group_members_unique').on(table.groupId, table.userId),
    index('user_group_members_group_idx').on(table.groupId),
    index('user_group_members_user_idx').on(table.userId),
  ],
);

export type UserGroup = typeof userGroups.$inferSelect;
export type NewUserGroup = typeof userGroups.$inferInsert;
export type UserGroupMember = typeof userGroupMembers.$inferSelect;
export type NewUserGroupMember = typeof userGroupMembers.$inferInsert;
