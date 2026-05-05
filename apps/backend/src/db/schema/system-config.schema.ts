import { pgTable, uuid, boolean, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const systemConfig = pgTable('system_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  isSetupComplete: boolean('is_setup_complete').default(false).notNull(),
  storageProvider: varchar('storage_provider', { length: 50 }), // 'local' | 'minio' | 's3' | 'gcs' | 'azure'

  // Storage Configuration (encrypted at rest)
  storageConfig: text('storage_config'), // JSON object stored as text (encrypted)

  // Email Provider Configuration (new - replaces smtpConfig)
  emailProvider: varchar('email_provider', { length: 50 }), // 'smtp' | 'sendgrid' | 'ses' | 'mailgun' | 'resend' | 'postmark'
  emailConfig: text('email_config'), // JSON object stored as text (encrypted)
  emailConfigured: boolean('email_configured').default(false).notNull(),

  // Legacy SMTP Configuration (kept for backwards compatibility/migration)
  // TODO: Remove after migration period
  smtpConfig: text('smtp_config'), // JSON object stored as text (encrypted)
  smtpConfigured: boolean('smtp_configured').default(false).notNull(),

  // Cache Configuration
  cacheConfig: text('cache_config'), // JSON object stored as text (encrypted)

  // Google OAuth client credentials (sign-in + calendar share one app).
  // Edited via /admin/settings/auth. AES-256-GCM encrypted JSON
  // { clientId, clientSecret }. Replaces the env-only GOOGLE_OAUTH_CLIENT_ID
  // / GOOGLE_OAUTH_CLIENT_SECRET pattern and the per-project clientId/secret
  // fields on `settings.integrations.google-calendar.production.config`.
  // Google creds for authenication are at the env level and the
  // same across all workspaces. these creds are for calendar and other
  // integration features and can be different across workspaces.
  googleOauthConfig: text('google_oauth_config'),
  googleOauthConfigured: boolean('google_oauth_configured').default(false).notNull(),

  // Security Settings
  jwtSecret: text('jwt_secret'),
  apiKeySalt: text('api_key_salt'),

  // Registration Settings
  allowPublicSignups: boolean('allow_public_signups').default(false).notNull(),

  // Branding Configuration (not encrypted - not sensitive)
  brandingConfig: text('branding_config'), // JSON: { siteName, headerLogoKey, authLogoKey }

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SystemConfig = typeof systemConfig.$inferSelect;
export type NewSystemConfig = typeof systemConfig.$inferInsert;
