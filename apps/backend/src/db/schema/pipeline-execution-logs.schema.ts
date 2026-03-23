import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { proxyRules } from './proxy-rules.schema';
import { projects } from './projects.schema';
import type { PipelineDebugInfo } from '../../pipelines/execution/pipeline-context.interface';

/**
 * Request metadata stored with pipeline execution logs.
 * Intentionally excludes request body for privacy.
 */
export interface PipelineLogRequestMeta {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/**
 * Pipeline execution logs table.
 *
 * Stores debug data from pipeline proxy rule executions for debugging
 * production pipeline runs. Only logs when debugEnabled is true on the proxy rule.
 *
 * The `debug` column contains the full PipelineDebugInfo (validators, steps, timing)
 * as JSONB. This data is always read as a unit, so a single JSONB column is simpler
 * than splitting into a runs+steps two-table design.
 */
export const pipelineExecutionLogs = pgTable(
  'pipeline_execution_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Project this log belongs to (for access control) */
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    /** Which proxy rule was executed */
    proxyRuleId: uuid('proxy_rule_id')
      .references(() => proxyRules.id, { onDelete: 'cascade' })
      .notNull(),

    /** Whether the pipeline succeeded */
    success: boolean('success').notNull(),

    /** HTTP status code returned */
    statusCode: integer('status_code').notNull(),

    /** HTTP request method */
    method: varchar('method', { length: 10 }).notNull(),

    /** Request path */
    path: varchar('path', { length: 500 }).notNull(),

    /** Total execution time in milliseconds */
    durationMs: integer('duration_ms').notNull(),

    /** Number of steps executed */
    stepsCount: integer('steps_count').notNull(),

    /** Error code if failed */
    errorCode: varchar('error_code', { length: 100 }),

    /** Error message if failed */
    errorMessage: text('error_message'),

    /** Which step failed */
    errorStep: varchar('error_step', { length: 255 }),

    /** Request metadata (ip, userAgent, userId) — no body for privacy */
    requestMeta: jsonb('request_meta').$type<PipelineLogRequestMeta>(),

    /** Full PipelineDebugInfo (validators, steps, timing) */
    debug: jsonb('debug').$type<PipelineDebugInfo>().notNull(),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    /** List logs for a rule, newest first */
    index('pipeline_exec_logs_rule_created_idx').on(table.proxyRuleId, table.createdAt),

    /** Access control by project */
    index('pipeline_exec_logs_project_idx').on(table.projectId),

    /** Cleanup by age */
    index('pipeline_exec_logs_created_idx').on(table.createdAt),
  ],
);

/**
 * Relations for pipeline execution logs
 */
export const pipelineExecutionLogsRelations = relations(pipelineExecutionLogs, ({ one }) => ({
  project: one(projects, {
    fields: [pipelineExecutionLogs.projectId],
    references: [projects.id],
  }),
  proxyRule: one(proxyRules, {
    fields: [pipelineExecutionLogs.proxyRuleId],
    references: [proxyRules.id],
  }),
}));

// Type exports
export type PipelineExecutionLog = typeof pipelineExecutionLogs.$inferSelect;
export type NewPipelineExecutionLog = typeof pipelineExecutionLogs.$inferInsert;
