import { pgTable, uuid, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  role: varchar('role', { length: 50 }).notNull().default('member'), // 'admin' | 'user' | 'member'
  disabled: boolean('disabled').default(false).notNull(),
  disabledAt: timestamp('disabled_at'),
  disabledBy: uuid('disabled_by'),
  // Timestamp of the user's most recent successful OIDC sign-in. Used as the
  // safeguard for disabling email/password login: the admin UI only allows
  // turning off ENABLE_EMAIL_PASSWORD once at least one admin has a non-null
  // value here (i.e. has proven OIDC works end-to-end for them).
  oidcVerifiedAt: timestamp('oidc_verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
