import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { projects } from './projects.schema';

/**
 * App tokens — member-bound, project-bound, scoped bearer credentials
 * (`Authorization: Bearer bfat_…`).
 *
 * Unlike an API key (pinned to role `user`, bound to no person), an app token
 * *is* the member wherever a session is accepted for content or pipelines,
 * narrowed by its scopes. Stored as a sha256 hash and looked up by index: the
 * raw token carries 256 bits of entropy, so a slow hash buys nothing and a
 * per-request scan (the API-key path) would make every MCP tool call pay
 * for every key on the instance.
 */
export const appTokens = pgTable(
  'app_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    /** sha256 hex of the raw token. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    /** `bfat_` + the first 7 hex chars, for display only. */
    tokenPrefix: varchar('token_prefix', { length: 16 }).notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    projectId: uuid('project_id')
      .references(() => projects.id)
      .notNull(),
    /** What the credential was delegated; the vocabulary is the app's. */
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    /** 'personal' (minted by the member) | 'oauth' (obtained by an OAuth client). */
    kind: varchar('kind', { length: 32 }).notNull().default('personal'),
    /** The OAuth client that obtained it, when `kind` is 'oauth'. */
    clientId: varchar('client_id', { length: 255 }),
    expiresAt: timestamp('expires_at'),
    /** Soft revocation: a revoked token answers 401 like an expired one. */
    revokedAt: timestamp('revoked_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('app_tokens_user_id_idx').on(table.userId),
    index('app_tokens_project_id_idx').on(table.projectId),
  ],
);

export type AppToken = typeof appTokens.$inferSelect;
export type NewAppToken = typeof appTokens.$inferInsert;
