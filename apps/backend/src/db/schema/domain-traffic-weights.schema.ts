import { relations } from 'drizzle-orm';
import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  integer,
  boolean,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { domainMappings } from './domain-mappings.schema';

export const domainTrafficWeights = pgTable(
  'domain_traffic_weights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domainMappings.id, { onDelete: 'cascade' }),
    alias: varchar('alias', { length: 255 }).notNull(),
    weight: integer('weight').notNull(), // 0-100, percentage
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('domain_traffic_weights_domain_alias_unique').on(table.domainId, table.alias),
    index('domain_traffic_weights_domain_id_idx').on(table.domainId),
  ],
);

export const domainTrafficWeightsRelations = relations(domainTrafficWeights, ({ one }) => ({
  domain: one(domainMappings, {
    fields: [domainTrafficWeights.domainId],
    references: [domainMappings.id],
  }),
}));

export type DomainTrafficWeight = typeof domainTrafficWeights.$inferSelect;
export type NewDomainTrafficWeight = typeof domainTrafficWeights.$inferInsert;
