/**
 * Bearer credentials CE issues itself, told apart by prefix: `wsa_` is an API
 * key (`ApiKeysService`), `bfat_` an app token (`app-token.util`). Any other
 * bearer — a SuperTokens JWT, a third-party token — is neither and must fall
 * through the guards untouched: CE never read `Authorization` before app
 * tokens existed, and an API key must never be bcrypt-compared against a JWT.
 */

export const API_KEY_PREFIX = 'wsa_';

/** The bearer token in an `Authorization` header, or null when there is none. */
export function bearerToken(authorization: string | string[] | undefined): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/** The bearer token when it carries `prefix`, else null. */
export function bearerWithPrefix(
  authorization: string | string[] | undefined,
  prefix: string,
): string | null {
  const token = bearerToken(authorization);
  return token && token.startsWith(prefix) ? token : null;
}

/**
 * The raw API key an `Authorization: Bearer wsa_…` header carries, or null.
 * An MCP client that can only send a bearer (Hermes, the MCP SDKs) reaches
 * the admin API with the same key `X-API-Key` carries (#802).
 */
export function bearerApiKey(authorization: string | string[] | undefined): string | null {
  return bearerWithPrefix(authorization, API_KEY_PREFIX);
}
