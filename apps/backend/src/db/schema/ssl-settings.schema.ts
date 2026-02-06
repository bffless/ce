import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

export const sslSettings = pgTable('ssl_settings', {
  key: varchar('key', { length: 50 }).primaryKey(),
  value: varchar('value', { length: 255 }).notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Default settings:
// - renewal_threshold_days: 30
// - notification_email: admin@example.com
// - wildcard_auto_renew: true

export type SslSetting = typeof sslSettings.$inferSelect;
export type NewSslSetting = typeof sslSettings.$inferInsert;
