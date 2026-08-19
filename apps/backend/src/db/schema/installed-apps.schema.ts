import { pgTable, uuid, varchar, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';
import { users } from './users.schema';

export type InstalledAppStatus = 'installing' | 'installed' | 'failed';

/** Objects this install created (vs adopted) — the undo/uninstall boundary. */
export interface CreatedResources {
  projectCreated?: boolean;
  ruleSetIds?: string[];
  /** Only schemas the sync CREATED (action === 'create'); reused ones are never ours to delete. */
  schemaIdsCreated?: string[];
  aliasName?: string;
  domainId?: string;
  deploymentId?: string;
  scheduleIds?: string[];
}

export const installedApps = pgTable(
  'installed_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: varchar('app_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    version: varchar('version', { length: 50 }).notNull(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    alias: varchar('alias', { length: 100 }).notNull(),
    domainId: uuid('domain_id'),
    deploymentId: uuid('deployment_id'),
    ruleSetIds: jsonb('rule_set_ids').$type<string[]>().notNull().default([]),
    schemaIds: jsonb('schema_ids').$type<string[]>().notNull().default([]),
    bundleSha256: varchar('bundle_sha256', { length: 64 }).notNull(),
    /** Full manifest at install time — powers eject + manual steps without refetching. */
    manifest: jsonb('manifest').notNull(),
    status: varchar('status', { length: 20 })
      .$type<InstalledAppStatus>()
      .notNull()
      .default('installing'),
    createdResources: jsonb('created_resources').$type<CreatedResources>().notNull().default({}),
    installedBy: uuid('installed_by')
      .references(() => users.id)
      .notNull(),
    installedAt: timestamp('installed_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('installed_apps_project_id_idx').on(table.projectId),
    unique('installed_apps_app_project_unique').on(table.appId, table.projectId),
  ],
);

export const installedAppsRelations = relations(installedApps, ({ one }) => ({
  project: one(projects, {
    fields: [installedApps.projectId],
    references: [projects.id],
  }),
  installedByUser: one(users, {
    fields: [installedApps.installedBy],
    references: [users.id],
  }),
}));

export type InstalledApp = typeof installedApps.$inferSelect;
export type NewInstalledApp = typeof installedApps.$inferInsert;
