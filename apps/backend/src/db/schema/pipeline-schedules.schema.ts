import { pgTable, uuid, varchar, boolean, timestamp, text, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';
import { proxyRules } from './proxy-rules.schema';

/**
 * Pipeline schedules define "run pipeline X on a cron cadence" per project.
 *
 * A generic, app-agnostic scheduling primitive: the target is any proxy rule
 * that carries a pipeline configuration. A minute-resolution scheduler selects
 * due, enabled rows and triggers each target pipeline in a system context.
 * Modeled on `retention_rules` (the same enabled/lastRunAt/nextRunAt/
 * executionStartedAt shape), with `executionStartedAt` used as an atomic claim
 * marker so a run can never double-fire.
 */
export const pipelineSchedules = pgTable(
  'pipeline_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    // User-friendly name for the schedule
    name: varchar('name', { length: 100 }).notNull(),

    // The proxy rule whose pipeline this schedule fires. If the rule is deleted,
    // the schedule goes with it.
    targetProxyRuleId: uuid('target_proxy_rule_id')
      .references(() => proxyRules.id, { onDelete: 'cascade' })
      .notNull(),

    // Cron expression (5 or 6 field) and IANA timezone it is evaluated in.
    cronExpression: varchar('cron_expression', { length: 120 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),

    // Execution state
    enabled: boolean('enabled').default(true).notNull(),
    lastRunAt: timestamp('last_run_at'),
    nextRunAt: timestamp('next_run_at'),
    // Atomic claim marker: set to now() when a run is claimed, cleared when it
    // finishes. A stale value (older than the claim timeout) is reclaimable so a
    // crashed run never wedges the schedule.
    executionStartedAt: timestamp('execution_started_at'),
    // Error from the most recent run (null = last run was clean)
    lastError: text('last_error'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('pipeline_schedules_project_id_idx').on(table.projectId),
    index('pipeline_schedules_target_proxy_rule_id_idx').on(table.targetProxyRuleId),
    index('pipeline_schedules_enabled_next_run_idx').on(table.enabled, table.nextRunAt),
  ],
);

/**
 * Relations for pipeline schedules
 */
export const pipelineSchedulesRelations = relations(pipelineSchedules, ({ one }) => ({
  project: one(projects, {
    fields: [pipelineSchedules.projectId],
    references: [projects.id],
  }),
  targetProxyRule: one(proxyRules, {
    fields: [pipelineSchedules.targetProxyRuleId],
    references: [proxyRules.id],
  }),
}));

export type PipelineSchedule = typeof pipelineSchedules.$inferSelect;
export type NewPipelineSchedule = typeof pipelineSchedules.$inferInsert;
