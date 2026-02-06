import { pgTable, serial, uuid, varchar, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * Path preferences table
 * Stores user preferences for specific paths within a project (e.g., SPA mode)
 *
 * This is a project-level setting - when one user changes it, it affects all users
 * viewing the same project/path combination.
 */
export const pathPreferences = pgTable(
  'path_preferences',
  {
    id: serial('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filepath: varchar('filepath', { length: 1024 }).notNull(),
    spaMode: boolean('spa_mode').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('path_preferences_project_filepath_unique').on(table.projectId, table.filepath),
    index('idx_path_preferences_project_id').on(table.projectId),
  ],
);

/**
 * Relations for pathPreferences
 */
export const pathPreferencesRelations = relations(pathPreferences, ({ one }) => ({
  project: one(projects, {
    fields: [pathPreferences.projectId],
    references: [projects.id],
  }),
}));

export type PathPreference = typeof pathPreferences.$inferSelect;
export type NewPathPreference = typeof pathPreferences.$inferInsert;
