import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Workspace-level Google OAuth client credentials, one row per Google API
 * surface. Today only `service='calendar'` is populated; future Drive /
 * Sheets / Gmail integrations add their own rows so each surface can have
 * a distinct Cloud project (separate audit trail, separate quota).
 *
 * Replaces the legacy `system_config.googleOauthConfig` / `googleOauthConfigured`
 * columns (dropped in story 0050), which collapsed every Google integration
 * into a single row.
 *
 * Workspace isolation comes from per-workspace databases (see
 * [[feedback-supertokens-single-tenant]]) — no `workspace_id` column.
 *
 * Per-project Google Calendar refresh tokens still live in
 * `projects.settings.integrations['google-calendar'][env]` — the project
 * owner connects their own calendar using the workspace's OAuth client.
 * This table only holds the client (clientId / clientSecret / scopes).
 */
export const googleIntegrationCredentials = pgTable(
  'google_integration_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Discriminator — which Google API surface these creds are for.
    // 'calendar' | 'drive' | 'sheets' | 'gmail'
    service: varchar('service', { length: 32 }).notNull(),

    // AES-256-GCM-encrypted JSON: { clientId, clientSecret, scopes?: string[] }
    // Same wire format as oidc_providers.config_encrypted; both go through
    // common/crypto/aes-gcm.ts.
    configEncrypted: text('config_encrypted').notNull(),

    // Redundant-with-NOT-NULL-row but kept for cheap "is configured?" reads
    // without touching configEncrypted. Set to true on insert; clearing creds
    // deletes the row rather than flipping this to false.
    configured: boolean('configured').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    // Nullable — migration-backfilled rows have no user attribution.
    createdByUserId: uuid('created_by_user_id'),
  },
  (t) => ({
    serviceUnique: uniqueIndex('google_integration_credentials_service_unique').on(t.service),
  }),
);

export type GoogleIntegrationCredentialsRow = typeof googleIntegrationCredentials.$inferSelect;
export type NewGoogleIntegrationCredentialsRow = typeof googleIntegrationCredentials.$inferInsert;

export type GoogleService = 'calendar' | 'drive' | 'sheets' | 'gmail';

export const GOOGLE_SERVICES: readonly GoogleService[] = ['calendar', 'drive', 'sheets', 'gmail'];

/**
 * Decrypted credential shape stored in `configEncrypted`.
 * `scopes` overrides the service-default scopes when present (null means
 * "use service default"). See `GoogleCalendarOAuthService.SCOPES` for the
 * Calendar service default.
 */
export interface GoogleIntegrationConfig {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}
