import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Pluggable OIDC sign-in providers (Google, Okta, Azure AD, generic OIDC).
 * Each row maps to one SuperTokens ThirdParty provider registered against the
 * single 'public' tenant — workspace isolation comes from per-workspace
 * SuperTokens DB at the infra layer, not SuperTokens multi-tenancy.
 *
 * `kind` selects the SuperTokens built-in provider. `providerId` is the
 * URL-safe slug used as :providerId in /api/auth/oauth/:providerId/url and
 * also as the SuperTokens thirdPartyId for non-google kinds (so two Okta
 * tenants can coexist as okta-acme and okta-vendor). For kind='google' the
 * thirdPartyId is forced to 'google' to keep already-issued sessions working.
 *
 * `source='env'` rows are auto-backfilled from GOOGLE_OAUTH_CLIENT_ID/_SECRET
 * env vars on backend boot and are overwritten on every boot from env vars;
 * 'admin' rows are managed via /api/settings/sso/providers.
 */
export const oidcProviders = pgTable(
  'oidc_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: varchar('provider_id', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(), // 'google' | 'okta' | 'azure-ad' | 'oidc'

    // AES-256-GCM-encrypted JSON:
    //   { clientId, clientSecret,
    //     oidcDiscoveryEndpoint?,   // 'oidc'
    //     oktaDomain?,              // 'okta'
    //     directoryId?,             // 'azure-ad'
    //     scope?: string[]          // optional override of kind defaults
    //   }
    configEncrypted: text('config_encrypted').notNull(),

    enabled: boolean('enabled').default(false).notNull(),
    source: varchar('source', { length: 16 }).default('admin').notNull(), // 'admin' | 'env'

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdByUserId: uuid('created_by_user_id'),
  },
  (t) => ({
    providerIdUnique: uniqueIndex('oidc_providers_provider_id_unique').on(t.providerId),
  }),
);

export type OidcProvider = typeof oidcProviders.$inferSelect;
export type NewOidcProvider = typeof oidcProviders.$inferInsert;

export type OidcProviderKind = 'google' | 'okta' | 'azure-ad' | 'oidc';

/**
 * Decrypted provider configuration. Fields are kind-specific; not every
 * field is set for every kind. The OidcProvidersService validates kind ↔
 * field consistency on write.
 */
export interface OidcProviderConfig {
  clientId: string;
  clientSecret: string;
  oidcDiscoveryEndpoint?: string; // kind='oidc'
  oktaDomain?: string; // kind='okta'
  directoryId?: string; // kind='azure-ad'
  scope?: string[];
}
