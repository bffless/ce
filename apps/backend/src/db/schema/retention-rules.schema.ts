import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigint,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * Retention rules define automatic cleanup policies for old commits.
 * Each rule can match commits by branch pattern and delete them after a retention period.
 */
export const retentionRules = pgTable(
  'retention_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    // User-friendly name for the rule
    name: varchar('name', { length: 100 }).notNull(),

    // Matching criteria
    // Glob pattern for branches to match (e.g., "feature/*", "bugfix/*", "*")
    branchPattern: varchar('branch_pattern', { length: 255 }).notNull(),
    // Branches to explicitly exclude (e.g., ["main", "develop", "release/*"])
    excludeBranches: jsonb('exclude_branches').$type<string[]>().notNull().default([]),

    // Retention settings
    // Delete commits older than this many days
    retentionDays: integer('retention_days').notNull(),
    // Never delete commits that have active aliases (default: true)
    keepWithAlias: boolean('keep_with_alias').default(true).notNull(),
    // Always keep at least N most recent commits per branch
    keepMinimum: integer('keep_minimum').default(0).notNull(),

    // Path-based partial deletion (optional)
    // Glob patterns for file paths within commits (e.g., ["coverage/**", "*.map", "test-results/**"])
    pathPatterns: jsonb('path_patterns').$type<string[]>(),
    // How to apply pathPatterns:
    // - null: Delete entire commit (default, backwards compatible)
    // - 'exclude': Delete files matching pathPatterns, keep everything else
    // - 'include': Keep files matching pathPatterns, delete everything else
    pathMode: varchar('path_mode', { length: 10 }).$type<'include' | 'exclude'>(),

    // Execution state
    enabled: boolean('enabled').default(true).notNull(),
    lastRunAt: timestamp('last_run_at'),
    nextRunAt: timestamp('next_run_at'),
    // When a manual execution started (null = not running)
    executionStartedAt: timestamp('execution_started_at'),
    // Summary of last execution
    lastRunSummary: jsonb('last_run_summary').$type<{
      deletedCommits: number; // Full commits deleted
      partialCommits: number; // Commits with partial file deletion
      deletedAssets: number; // Total assets/files deleted
      freedBytes: number;
      errors?: string[];
    }>(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('retention_rules_project_id_idx').on(table.projectId),
    index('retention_rules_next_run_idx').on(table.nextRunAt),
    index('retention_rules_enabled_next_run_idx').on(table.enabled, table.nextRunAt),
  ],
);

/**
 * Relations for retention rules
 */
export const retentionRulesRelations = relations(retentionRules, ({ one }) => ({
  project: one(projects, {
    fields: [retentionRules.projectId],
    references: [projects.id],
  }),
}));

export type RetentionRule = typeof retentionRules.$inferSelect;
export type NewRetentionRule = typeof retentionRules.$inferInsert;

/**
 * Retention logs track individual commit deletions for audit purposes.
 */
export const retentionLogs = pgTable(
  'retention_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    // Which rule triggered this deletion (null if rule was deleted)
    ruleId: uuid('rule_id').references(() => retentionRules.id, { onDelete: 'set null' }),

    // What was deleted
    commitSha: varchar('commit_sha', { length: 40 }).notNull(),
    branch: varchar('branch', { length: 255 }),
    assetCount: integer('asset_count').notNull(),
    // Use bigint for bytes to support large files (up to 9 exabytes)
    freedBytes: bigint('freed_bytes', { mode: 'number' }).notNull(),
    // Whether this was a partial deletion (some files kept) vs full commit deletion
    isPartial: boolean('is_partial').default(false).notNull(),

    // When
    deletedAt: timestamp('deleted_at').defaultNow().notNull(),
  },
  (table) => [
    index('retention_logs_project_id_idx').on(table.projectId),
    index('retention_logs_rule_id_idx').on(table.ruleId),
    index('retention_logs_deleted_at_idx').on(table.deletedAt),
    index('retention_logs_project_deleted_at_idx').on(table.projectId, table.deletedAt),
  ],
);

/**
 * Relations for retention logs
 */
export const retentionLogsRelations = relations(retentionLogs, ({ one }) => ({
  project: one(projects, {
    fields: [retentionLogs.projectId],
    references: [projects.id],
  }),
  rule: one(retentionRules, {
    fields: [retentionLogs.ruleId],
    references: [retentionRules.id],
  }),
}));

export type RetentionLog = typeof retentionLogs.$inferSelect;
export type NewRetentionLog = typeof retentionLogs.$inferInsert;
