import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Feature Flags Schema
 *
 * Stores feature flag overrides in the database.
 * Part of a layered configuration system:
 *   Priority: Database > File > Environment > Default
 *
 * The PaaS can set flags via:
 *   1. Environment variables (set at container creation)
 *   2. Config file (mounted at provisioning)
 *   3. Database (runtime changes via API)
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Flag identifier (e.g., 'ENABLE_CUSTOM_DOMAINS', 'MAX_PROJECTS')
    key: varchar('key', { length: 100 }).notNull().unique(),

    // Flag value stored as text (supports strings, numbers, booleans as JSON)
    value: text('value').notNull(),

    // Value type for proper parsing
    valueType: varchar('value_type', { length: 20 }).notNull().default('boolean'), // 'boolean' | 'string' | 'number' | 'json'

    // Human-readable description
    description: text('description'),

    // Whether this flag is active (allows soft-disable without deletion)
    enabled: boolean('enabled').notNull().default(true),

    // Audit fields
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('feature_flags_key_idx').on(table.key)],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
