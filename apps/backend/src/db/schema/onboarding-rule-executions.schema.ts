import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.schema';
import { onboardingRules, OnboardingAction, OnboardingTrigger } from './onboarding-rules.schema';

/**
 * Execution status for onboarding rule execution
 */
export type ExecutionStatus = 'success' | 'partial' | 'failed' | 'skipped';

/**
 * Details about individual action results
 */
export interface ActionExecutionResult {
  action: OnboardingAction;
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Audit log of onboarding rule executions.
 * Tracks when rules were executed, for which users, and the outcome.
 */
export const onboardingRuleExecutions = pgTable(
  'onboarding_rule_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Reference to the rule that was executed
     * May be null if rule was deleted after execution
     */
    ruleId: uuid('rule_id').references(() => onboardingRules.id, { onDelete: 'set null' }),

    /**
     * Snapshot of rule name at execution time (for audit trail)
     */
    ruleName: varchar('rule_name', { length: 100 }).notNull(),

    /**
     * User the rule was executed for
     */
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * What triggered the execution
     */
    trigger: varchar('trigger', { length: 50 }).$type<OnboardingTrigger>().notNull(),

    /**
     * Overall execution status
     * - 'success': All actions completed successfully
     * - 'partial': Some actions succeeded, some failed
     * - 'failed': All actions failed
     * - 'skipped': Rule conditions not met
     */
    status: varchar('status', { length: 20 }).$type<ExecutionStatus>().notNull(),

    /**
     * Detailed results for each action
     */
    details: jsonb('details').$type<ActionExecutionResult[]>(),

    /**
     * Summary error message if execution failed
     */
    errorMessage: varchar('error_message', { length: 1000 }),

    /**
     * When the execution occurred
     */
    executedAt: timestamp('executed_at').defaultNow().notNull(),
  },
  (table) => [
    index('onboarding_rule_executions_user_idx').on(table.userId),
    index('onboarding_rule_executions_rule_idx').on(table.ruleId),
    index('onboarding_rule_executions_executed_at_idx').on(table.executedAt),
    index('onboarding_rule_executions_status_idx').on(table.status),
  ],
);

/**
 * Relations for onboarding rule executions
 */
export const onboardingRuleExecutionsRelations = relations(onboardingRuleExecutions, ({ one }) => ({
  rule: one(onboardingRules, {
    fields: [onboardingRuleExecutions.ruleId],
    references: [onboardingRules.id],
  }),
  user: one(users, {
    fields: [onboardingRuleExecutions.userId],
    references: [users.id],
  }),
}));

export type OnboardingRuleExecution = typeof onboardingRuleExecutions.$inferSelect;
export type NewOnboardingRuleExecution = typeof onboardingRuleExecutions.$inferInsert;
