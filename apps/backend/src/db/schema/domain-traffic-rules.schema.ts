import { relations } from 'drizzle-orm';
import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { domainMappings } from './domain-mappings.schema';

export const domainTrafficRules = pgTable(
  'domain_traffic_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domainMappings.id, { onDelete: 'cascade' }),
    alias: varchar('alias', { length: 255 }).notNull(),
    conditionType: varchar('condition_type', { length: 20 }).notNull(), // 'query_param' | 'cookie'
    conditionKey: varchar('condition_key', { length: 255 }).notNull(),
    conditionValue: varchar('condition_value', { length: 500 }).notNull(),
    priority: integer('priority').notNull().default(100), // lower = evaluated first
    isActive: boolean('is_active').notNull().default(true),
    label: varchar('label', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('domain_traffic_rules_domain_id_idx').on(table.domainId),
    index('domain_traffic_rules_domain_id_priority_idx').on(table.domainId, table.priority),
  ],
);

export const domainTrafficRulesRelations = relations(domainTrafficRules, ({ one }) => ({
  domain: one(domainMappings, {
    fields: [domainTrafficRules.domainId],
    references: [domainMappings.id],
  }),
}));

export type DomainTrafficRule = typeof domainTrafficRules.$inferSelect;
export type NewDomainTrafficRule = typeof domainTrafficRules.$inferInsert;
