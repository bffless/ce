import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';

/** OAuth 2.1 clients registered dynamically (RFC 7591) — public clients only, no secret. */
export const oauthClients = pgTable('oauth_clients', {
  clientId: uuid('client_id').primaryKey().defaultRandom(),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  grantTypes: jsonb('grant_types')
    .$type<string[]>()
    .notNull()
    .default(['authorization_code', 'refresh_token']),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at'),
});

export type OAuthClient = typeof oauthClients.$inferSelect;
export type NewOAuthClient = typeof oauthClients.$inferInsert;
