/**
 * API keys as a bearer credential. Every API key CE mints starts with `wsa_`
 * (`ApiKeysService`), so `Authorization: Bearer wsa_…` is unambiguous — an
 * MCP client that can only send a bearer (Hermes, the MCP SDKs) reaches the
 * admin API with the same key `X-API-Key` carries (#802). Any other bearer —
 * a `bfat_` app token, a SuperTokens JWT, a third-party token — is not an API
 * key and must never be bcrypt-compared against the keys table.
 */

export const API_KEY_PREFIX = 'wsa_';

/** The raw API key an `Authorization: Bearer wsa_…` header carries, or null. */
export function bearerApiKey(authorization: string | string[] | undefined): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  if (!match) return null;
  return match[1].startsWith(API_KEY_PREFIX) ? match[1] : null;
}
