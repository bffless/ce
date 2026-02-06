import supertokens from 'supertokens-node';
import Session from 'supertokens-node/recipe/session';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import EmailVerification from 'supertokens-node/recipe/emailverification';
import Multitenancy from 'supertokens-node/recipe/multitenancy';
import { createEmailDeliveryConfig } from './email-delivery.service';

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
      appName: 'Static Asset Hosting Platform',
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

export { supertokens };
