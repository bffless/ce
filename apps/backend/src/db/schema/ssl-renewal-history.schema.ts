import { relations } from 'drizzle-orm';
import { pgTable, timestamp, uuid, varchar, text, index } from 'drizzle-orm/pg-core';
import { domainMappings } from './domain-mappings.schema';

export const sslRenewalHistory = pgTable(
  'ssl_renewal_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domainId: uuid('domain_id').references(() => domainMappings.id, { onDelete: 'cascade' }),
    certificateType: varchar('certificate_type', { length: 20 })
      .notNull()
      .$type<'wildcard' | 'individual'>(),
    domain: varchar('domain', { length: 255 }).notNull(), // Store for history even if domain deleted
    status: varchar('status', { length: 20 }).notNull().$type<'success' | 'failed' | 'skipped'>(),
    errorMessage: text('error_message'),
    previousExpiresAt: timestamp('previous_expires_at'),
    newExpiresAt: timestamp('new_expires_at'),
    triggeredBy: varchar('triggered_by', { length: 20 }).notNull().$type<'auto' | 'manual'>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('ssl_renewal_history_domain_id_idx').on(table.domainId),
    index('ssl_renewal_history_created_at_idx').on(table.createdAt),
  ],
);

export const sslRenewalHistoryRelations = relations(sslRenewalHistory, ({ one }) => ({
  domainMapping: one(domainMappings, {
    fields: [sslRenewalHistory.domainId],
    references: [domainMappings.id],
  }),
}));

export type SslRenewalHistoryRecord = typeof sslRenewalHistory.$inferSelect;
export type NewSslRenewalHistoryRecord = typeof sslRenewalHistory.$inferInsert;
