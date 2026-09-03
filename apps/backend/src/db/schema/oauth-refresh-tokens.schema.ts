import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients.schema';
import { users } from './users.schema';
import { projects } from './projects.schema';
import { appTokens } from './app-tokens.schema';

/**
 * Refresh tokens (30 days), rotated on every use (OAuth 2.1 §4.3.1): a rotated
 * token presented again revokes its whole family. Stored hashed.
 */
export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    familyId: uuid('family_id').notNull(),
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
    /** The access token (an app token) this refresh token last issued. */
    appTokenId: uuid('app_token_id').references(() => appTokens.id),
    expiresAt: timestamp('expires_at').notNull(),
    rotatedAt: timestamp('rotated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('oauth_refresh_tokens_family_idx').on(t.familyId)],
);

export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
