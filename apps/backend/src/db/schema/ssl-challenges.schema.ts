import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

export const sslChallenges = pgTable(
  'ssl_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    baseDomain: varchar('base_domain', { length: 255 }).notNull().unique(),
    challengeType: varchar('challenge_type', { length: 20 }).notNull(), // 'dns-01' | 'http-01'
    recordName: varchar('record_name', { length: 255 }).notNull(), // "_acme-challenge.yourdomain.com"
    recordValue: text('record_value').notNull(), // The TXT record value (key authorization) - may be JSON array for multiple values
    token: varchar('token', { length: 255 }).notNull(), // ACME challenge token (primary)
    orderData: text('order_data').notNull(), // JSON serialized ACME order
    authzData: text('authz_data').notNull(), // JSON serialized ALL authorizations (array)
    keyAuthorization: text('key_authorization').notNull(), // Primary key authorization (for backward compat)
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'verified' | 'failed' | 'expired'
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('ssl_challenges_base_domain_idx').on(table.baseDomain),
    index('ssl_challenges_status_idx').on(table.status),
  ],
);

export type SslChallenge = typeof sslChallenges.$inferSelect;
export type NewSslChallenge = typeof sslChallenges.$inferInsert;
