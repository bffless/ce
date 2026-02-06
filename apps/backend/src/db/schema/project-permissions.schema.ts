import { pgTable, uuid, varchar, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { projects } from './projects.schema';
import { users } from './users.schema';
import { userGroups } from './user-groups.schema';

export const projectPermissions = pgTable(
  'project_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: varchar('role', { length: 50 }).notNull(), // 'owner' | 'admin' | 'contributor' | 'viewer'
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: timestamp('granted_at').defaultNow().notNull(),
  },
  (table) => [
    unique('project_permissions_unique').on(table.projectId, table.userId),
    index('project_permissions_project_idx').on(table.projectId),
    index('project_permissions_user_idx').on(table.userId),
  ],
);

export const projectGroupPermissions = pgTable(
  'project_group_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: uuid('group_id')
      .references(() => userGroups.id, { onDelete: 'cascade' })
      .notNull(),
    role: varchar('role', { length: 50 }).notNull(), // 'admin' | 'contributor' | 'viewer' (not owner)
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: timestamp('granted_at').defaultNow().notNull(),
  },
  (table) => [
    unique('project_group_permissions_unique').on(table.projectId, table.groupId),
    index('project_group_permissions_project_idx').on(table.projectId),
    index('project_group_permissions_group_idx').on(table.groupId),
  ],
);

export type ProjectPermission = typeof projectPermissions.$inferSelect;
export type NewProjectPermission = typeof projectPermissions.$inferInsert;
export type ProjectGroupPermission = typeof projectGroupPermissions.$inferSelect;
export type NewProjectGroupPermission = typeof projectGroupPermissions.$inferInsert;
