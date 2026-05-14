import supertokens from 'supertokens-node';
import Session from 'supertokens-node/recipe/session';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import EmailVerification from 'supertokens-node/recipe/emailverification';
import ThirdParty from 'supertokens-node/recipe/thirdparty';
import Multitenancy from 'supertokens-node/recipe/multitenancy';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { oidcProviders, type OidcProvider, type OidcProviderConfig, type OidcProviderKind } from '../db/schema';
import { createEmailDeliveryConfig } from './email-delivery.service';

// CE always runs SuperTokens single-tenant; workspace isolation comes from
// per-workspace SuperTokens DB at the infra layer, NOT SuperTokens'
// Multitenancy recipe. The `isMultiTenant` branches below are dead code in
// practice — see [[feedback-supertokens-single-tenant]] in author notes.
// New OIDC code uses the `'public'` constant directly; do not reintroduce
// the ternary in new code.
const TENANT_ID = 'public';

// Multi-tenant mode is OPT-IN - requires explicit flag
// Note: The SuperTokens license key is configured on the SuperTokens core server,
// not in the backend. If multi-tenant is enabled without a valid license on core,
// SuperTokens API calls will fail with an appropriate error.
const isMultiTenant = process.env.SUPERTOKENS_MULTI_TENANT === 'true';

// ORGANIZATION_ID is the preferred env var (organization = SuperTokens tenant = auth boundary)
// TENANT_ID is supported for backward compatibility
// In single-tenant mode (default), always use 'public' tenant
const organizationId = isMultiTenant
  ? process.env.ORGANIZATION_ID || process.env.TENANT_ID || 'public'
  : 'public';

// Validate configuration for multi-tenant platform mode
if (isMultiTenant && !process.env.ORGANIZATION_ID && !process.env.TENANT_ID) {
  throw new Error('ORGANIZATION_ID (or TENANT_ID) is required when SUPERTOKENS_MULTI_TENANT=true');
}

export function initSuperTokens() {
  supertokens.init({
    framework: 'express',
    supertokens: {
      connectionURI: process.env.SUPERTOKENS_CONNECTION_URI || 'http://localhost:3567',
      apiKey: process.env.SUPERTOKENS_API_KEY,
    },
    appInfo: {
      appName: 'BFFless',
      // API_DOMAIN defaults to FRONTEND_URL since nginx proxies both on the same domain
      apiDomain: process.env.API_DOMAIN || process.env.FRONTEND_URL || 'http://localhost:3000',
      websiteDomain: process.env.FRONTEND_URL || 'http://localhost:5173',
      apiBasePath: '/api/auth', // Matches custom NestJS controller path
      websiteBasePath: '/auth',
    },
    // Note: We use custom NestJS auth controller at /api/auth/* for all authentication
    // Native SuperTokens signup/signin endpoints are disabled below via override
    recipeList: [
      // Only include Multitenancy recipe when multi-tenant mode is explicitly enabled
      // This requires SUPERTOKENS_MULTI_TENANT=true AND a valid license key
      ...(isMultiTenant ? [Multitenancy.init()] : []),

      ThirdParty.init({
        signInAndUpFeature: {
          providers: [], // Configured dynamically via Multitenancy core
        },
        override: {
          apis: (originalImplementation) => ({
            ...originalImplementation,
            // Disable native endpoints - use custom NestJS controller instead
            signInUpPOST: undefined,
            authorisationUrlGET: undefined,
            appleRedirectHandlerPOST: undefined,
          }),
        },
      }),

      EmailPassword.init({
        emailDelivery: createEmailDeliveryConfig(),
        override: {
          apis: (originalImplementation) => {
            return {
              ...originalImplementation,
              // Disable native signup endpoint - use /api/auth/signup instead
              signUpPOST: undefined,
              // Disable native signin endpoint - use /api/auth/signin instead
              signInPOST: undefined,
              // Keep other endpoints like password reset, email verification, etc.
            };
          },
          // Only override functions in multi-tenant mode for tenant-aware auth
          ...(isMultiTenant && {
            functions: (originalImplementation) => ({
              ...originalImplementation,
              // Override signUp to always use configured organization (SuperTokens tenant)
              signUp: async (input) => {
                return originalImplementation.signUp({
                  ...input,
                  tenantId: organizationId,
                });
              },
              // Override signIn to always use configured organization (SuperTokens tenant)
              signIn: async (input) => {
                return originalImplementation.signIn({
                  ...input,
                  tenantId: organizationId,
                });
              },
            }),
          }),
        },
      }),

      // OPTIONAL mode: enforcement handled by EmailVerificationGuard for control
      // over whitelisting, error responses, and graceful degradation
      EmailVerification.init({
        mode: 'OPTIONAL',
        emailDelivery: createEmailDeliveryConfig(),
      }),

      Session.init({
        // Allow override for local Docker testing (HTTP in production mode)
        cookieSecure:
          process.env.COOKIE_SECURE === 'false' ? false : process.env.NODE_ENV === 'production',
        cookieSameSite:
          process.env.COOKIE_SECURE === 'false'
            ? 'lax'
            : process.env.NODE_ENV === 'production'
              ? 'none'
              : 'lax',
        // Set cookie domain to work across subdomains (e.g., www.yourdomain.com and yourdomain.com)
        cookieDomain: process.env.COOKIE_DOMAIN,
        // Force cookie-based sessions (not header-based)
        getTokenTransferMethod: () => 'cookie',
        // Disable anti-CSRF for easier API integration (session hijacking protection via secure cookies)
        antiCsrf: 'NONE',
        // Enable JWT mode for external validation via JWKS
        // This exposes the access token as a JWT that can be validated externally
        // JWKS endpoint available at: /api/auth/jwt/jwks.json
        exposeAccessTokenToFrontendInCookieBasedAuth: true,
        // Only override session in multi-tenant mode for organization ID in payload
        ...(isMultiTenant && {
          override: {
            functions: (originalImplementation) => ({
              ...originalImplementation,
              // Add organization ID to session payload in multi-tenant mode
              createNewSession: async (input) => {
                return originalImplementation.createNewSession({
                  ...input,
                  accessTokenPayload: {
                    ...input.accessTokenPayload,
                    tenantId: organizationId, // tenantId key for SuperTokens compatibility
                  },
                });
              },
            }),
          },
        }),
      }),
    ],
  });
}

/**
 * Sync all enabled `oidc_providers` rows into SuperTokens for the 'public'
 * tenant. Idempotent — safe to call repeatedly (used at boot and on every
 * admin SSO mutation so changes apply without a backend restart).
 *
 * Backfill: if `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` env vars are set and no row
 * with `providerId='google'` exists yet, insert one with `source: 'env'`
 * before syncing. On subsequent boots, `source: 'env'` rows are overwritten
 * from env vars (so an admin rotating the Cloud creds via env still picks up
 * changes); `source: 'admin'` rows are never touched by this function.
 *
 * Note: `Multitenancy.createOrUpdateThirdPartyConfig` works against the
 * 'public' tenant even though `Multitenancy.init()` isn't in our recipe list
 * (the SuperTokens core always exposes the public tenant). This is the same
 * trick the old `registerGoogleOAuthFromEnv` relied on.
 *
 * Replaces the previous `registerGoogleOAuthFromEnv()` — see story 0047.
 * INTEGRATION credentials (Calendar, etc.) keep using system_config via
 * GoogleOAuthSettingsService; only sign-in moved to oidc_providers.
 */
export async function syncOidcProviders(): Promise<void> {
  await backfillEnvGoogleProviderIfMissing();
  await rotateEnvGoogleProviderIfChanged();

  const rows = await db
    .select()
    .from(oidcProviders)
    .where(eq(oidcProviders.enabled, true));

  for (const row of rows) {
    const cfg = decryptConfig(row.configEncrypted);
    if (!cfg) {
      console.error(`[Auth] Skipping OIDC provider '${row.providerId}' — failed to decrypt config`);
      continue;
    }
    try {
      const config = buildSuperTokensConfig(row, cfg);
      await Multitenancy.createOrUpdateThirdPartyConfig(TENANT_ID, config);
      console.log(`[Auth] Registered OIDC provider '${row.providerId}' (kind=${row.kind})`);
    } catch (error) {
      console.error(`[Auth] Failed to register OIDC provider '${row.providerId}':`, error);
    }
  }
}

/**
 * Build the SuperTokens ThirdParty `ProviderConfig` shape from one row.
 * `thirdPartyId` is the row's `providerId` slug (so two Okta tenants can
 * coexist as okta-acme and okta-vendor) — except for `kind: 'google'` where
 * we keep the literal `'google'` thirdPartyId for back-compat with sessions
 * issued by the old code path.
 */
function buildSuperTokensConfig(row: OidcProvider, cfg: OidcProviderConfig) {
  const kind = row.kind as OidcProviderKind;
  switch (kind) {
    case 'google':
      return {
        thirdPartyId: 'google',
        clients: [{ clientId: cfg.clientId, clientSecret: cfg.clientSecret }],
      };
    case 'okta':
      return {
        thirdPartyId: row.providerId,
        clients: [
          {
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            additionalConfig: { oktaDomain: cfg.oktaDomain },
          },
        ],
      };
    case 'azure-ad':
      return {
        thirdPartyId: row.providerId,
        clients: [
          {
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            additionalConfig: { directoryId: cfg.directoryId },
          },
        ],
      };
    case 'oidc':
      return {
        thirdPartyId: row.providerId,
        oidcDiscoveryEndpoint: cfg.oidcDiscoveryEndpoint,
        clients: [
          {
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            scope: cfg.scope ?? ['openid', 'email', 'profile'],
          },
        ],
      };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown OIDC provider kind: ${exhaustive}`);
    }
  }
}

async function backfillEnvGoogleProviderIfMissing(): Promise<void> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;

  const existing = await db
    .select()
    .from(oidcProviders)
    .where(eq(oidcProviders.providerId, 'google'))
    .limit(1);
  if (existing.length > 0) return;

  const encrypted = encryptData(JSON.stringify({ clientId, clientSecret }));
  await db.insert(oidcProviders).values({
    providerId: 'google',
    displayName: 'Google',
    kind: 'google',
    configEncrypted: encrypted,
    enabled: true,
    source: 'env',
  });
  console.log('[Auth] Backfilled Google OIDC provider from environment variables');
}

/**
 * If a `source='env'` Google row exists, refresh its encrypted creds from the
 * current env vars on every boot. This lets an operator rotate their Google
 * Cloud client by updating env and restarting the backend, without having to
 * touch the admin UI. `source='admin'` rows are never touched.
 */
async function rotateEnvGoogleProviderIfChanged(): Promise<void> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;

  const [row] = await db
    .select()
    .from(oidcProviders)
    .where(eq(oidcProviders.providerId, 'google'))
    .limit(1);
  if (!row || row.source !== 'env') return;

  const current = decryptConfig(row.configEncrypted);
  if (current && current.clientId === clientId && current.clientSecret === clientSecret) {
    return;
  }
  const encrypted = encryptData(JSON.stringify({ clientId, clientSecret }));
  await db
    .update(oidcProviders)
    .set({ configEncrypted: encrypted, updatedAt: new Date() })
    .where(eq(oidcProviders.id, row.id));
  console.log('[Auth] Refreshed env-sourced Google OIDC provider from updated env vars');
}

// ─── crypto (mirrors OidcProvidersService.encryptData/decryptData) ──────────
// Inlined here (not injected) because syncOidcProviders runs before the Nest
// DI graph is fully wired during onModuleInit. Same algorithm, same wire
// format, same ENCRYPTION_KEY env var as OidcProvidersService and
// GoogleOAuthSettingsService — to be unified into a shared util in story 0048.

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
let cachedEncryptionKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey) return cachedEncryptionKey;
  const key = process.env.ENCRYPTION_KEY;
  if (key) {
    cachedEncryptionKey = Buffer.from(key, 'base64');
  } else {
    cachedEncryptionKey = crypto.randomBytes(32);
    console.warn('[Auth] No ENCRYPTION_KEY found. Generated temporary key — OIDC creds unrecoverable across restarts.');
  }
  return cachedEncryptionKey;
}

function encryptData(data: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptConfig(encrypted: string): OidcProviderConfig | null {
  try {
    const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let json = decipher.update(ciphertext, 'hex', 'utf8');
    json += decipher.final('utf8');
    const parsed = JSON.parse(json) as Partial<OidcProviderConfig>;
    if (!parsed.clientId || !parsed.clientSecret) return null;
    return {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      oidcDiscoveryEndpoint: parsed.oidcDiscoveryEndpoint,
      oktaDomain: parsed.oktaDomain,
      directoryId: parsed.directoryId,
      scope: parsed.scope,
    };
  } catch (err) {
    console.error('[Auth] Failed to decrypt OIDC provider config:', err);
    return null;
  }
}

export { supertokens, TENANT_ID };
