import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.schema';

/**
 * Action types for onboarding rules
 */
export type OnboardingActionType = 'grant_repo_access' | 'assign_role' | 'add_to_group';

/**
 * Parameters for grant_repo_access action
 */
export interface GrantRepoAccessParams {
  /** Repository identifier in format "owner/name" */
  repository: string;
  /** Role to grant: viewer, contributor, admin */
  role: 'viewer' | 'contributor' | 'admin';
}

/**
 * Parameters for assign_role action
 */
export interface AssignRoleParams {
  /** Workspace role to assign */
  role: 'admin' | 'user' | 'member';
}

/**
 * Parameters for add_to_group action
 */
export interface AddToGroupParams {
  /** Group ID to add user to */
  groupId: string;
}

/**
 * Union type for action parameters
 */
export type OnboardingActionParams = GrantRepoAccessParams | AssignRoleParams | AddToGroupParams;

/**
 * An onboarding action to execute
 */
export interface OnboardingAction {
  type: OnboardingActionType;
  params: OnboardingActionParams;
}

/**
 * Condition types for filtering when rules apply
 */
export interface OnboardingCondition {
  /** Type of condition check */
  type: 'email_domain' | 'email_pattern';
  /** Value to match against */
  value: string;
}

/**
 * Trigger types for onboarding rules
 */
export type OnboardingTrigger = 'user_signup' | 'invite_accepted';

/**
 * Onboarding rules define automatic actions when users sign up or accept invitations.
 * Rules are evaluated in priority order; all matching rules are executed.
 */
export const onboardingRules = pgTable(
  'onboarding_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Human-readable name for the rule
     */
    name: varchar('name', { length: 100 }).notNull(),

    /**
     * Optional description explaining the rule's purpose
     */
    description: varchar('description', { length: 500 }),

    /**
     * Event that triggers this rule
     * - 'user_signup': New user signs up (public or via invitation)
     * - 'invite_accepted': User accepts an invitation (already registered)
     */
    trigger: varchar('trigger', { length: 50 })
      .$type<OnboardingTrigger>()
      .notNull()
      .default('user_signup'),

    /**
     * Actions to execute when rule matches
     * Array of {type, params} objects
     */
    actions: jsonb('actions').$type<OnboardingAction[]>().notNull(),

    /**
     * Optional conditions that must match for rule to execute
     * If null/empty, rule always executes for the trigger
     */
    conditions: jsonb('conditions').$type<OnboardingCondition[] | null>(),

    /**
     * Whether this rule is active
     */
    enabled: boolean('enabled').default(true).notNull(),

    /**
     * Execution priority. Lower = higher priority (executed first).
     * Rules with same priority are executed in creation order.
     */
    priority: integer('priority').default(100).notNull(),

    /**
     * User who created this rule (used as grantedBy for permissions)
     */
    createdBy: uuid('created_by').references(() => users.id),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('onboarding_rules_enabled_trigger_idx').on(table.enabled, table.trigger),
    index('onboarding_rules_priority_idx').on(table.priority),
  ],
);

/**
 * Relations for onboarding rules
 */
export const onboardingRulesRelations = relations(onboardingRules, ({ one }) => ({
  creator: one(users, {
    fields: [onboardingRules.createdBy],
    references: [users.id],
  }),
}));

export type OnboardingRule = typeof onboardingRules.$inferSelect;
export type NewOnboardingRule = typeof onboardingRules.$inferInsert;
