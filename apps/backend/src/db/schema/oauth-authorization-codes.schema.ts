import { pgTable, uuid, varchar, timestamp, jsonb, text } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients.schema';
import { users } from './users.schema';
import { projects } from './projects.schema';

/** Authorization codes (10 minutes, single use, PKCE S256 only). Stored hashed. */
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  codeHash: varchar('code_hash', { length: 64 }).primaryKey(),
  clientId: uuid('client_id')
    .references(() => oauthClients.clientId)
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),
  redirectUri: text('redirect_uri').notNull(),
  resource: text('resource').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
