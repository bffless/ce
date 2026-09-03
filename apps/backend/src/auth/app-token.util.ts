import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appTokens, users } from '../db/schema';

/**
 * App tokens (`Authorization: Bearer bfat_…`) — the one resolver every call
 * site shares: `OptionalAuthGuard` (the public controller's gate),
 * `ProxyMiddleware.getOptionalUser` (the proxy visibility gate + the pipeline
 * user) and `ApiKeyGuard` (the admin API). A token is the member, narrowed by
 * its scopes; see `app-tokens.schema.ts` and CONTEXT.md → *App token*.
 *
 * Deliberately a module of plain functions rather than an injectable: two of
 * the three call sites construct no services (`OptionalAuthGuard` has no DI),
 * and a lookup that is a hash-indexed select needs none.
 */

export const APP_TOKEN_PREFIX = 'bfat_';
export const APP_TOKEN_BYTES = 32;
/** `last_used_at` is written at most once per token per interval — an MCP host's burst must not become a write per call. */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface ResolvedAppToken {
  user: { id: string; email: string; role: string };
  token: { id: string; projectId: string; scopes: string[]; kind: string; clientId: string | null };
}

export interface AppTokenCredential {
  kind: 'app_token';
  appTokenId: string;
  projectId: string;
  scopes: string[];
}

export interface AppTokenRequestUser {
  id: string;
  email: string;
  role: string;
  credential: AppTokenCredential;
  appTokenId: string;
  /** Only when pinned like an API key (the admin API): fences the caller to the token's project. */
  apiKeyProjectId?: string;
}

/**
 * The raw app token a request carries, or null. Only the `bfat_` prefix is an
 * app token: CE never read `Authorization` before, so any other bearer (a
 * SuperTokens JWT, a third-party token) must keep falling through untouched.
 */
export function bearerAppToken(authorization: string | string[] | undefined): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  if (!match) return null;
  return match[1].startsWith(APP_TOKEN_PREFIX) ? match[1] : null;
}

/** sha256 hex. Deterministic on purpose: the token has 256 bits of entropy; bcrypt is for passwords. */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function mintToken(): { raw: string; hash: string; prefix: string } {
  const raw = APP_TOKEN_PREFIX + crypto.randomBytes(APP_TOKEN_BYTES).toString('hex');
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, APP_TOKEN_PREFIX.length + 7) };
}

const lastUsedWrites = new Map<string, number>();
/** Bound the throttle map: past this many distinct tokens the oldest entries are dropped (a dropped entry only costs one extra write). */
export const LAST_USED_MAP_MAX = 1000;

/** Test seam. */
export function resetLastUsedThrottle(): void {
  lastUsedWrites.clear();
}

/**
 * The member a bearer app token stands for, or null when the header carries no
 * app token, the token is unknown, expired or revoked, or its user is missing
 * or disabled. Never throws: every caller treats a failure as "not this credential".
 */
export async function resolveAppToken(
  authorization: string | string[] | undefined,
): Promise<ResolvedAppToken | null> {
  const raw = bearerAppToken(authorization);
  if (!raw) return null;
  try {
    const [row] = await db
      .select()
      .from(appTokens)
      .where(eq(appTokens.tokenHash, hashToken(raw)))
      .limit(1);
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return null;

    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.disabled) return null;

    await touchLastUsed(row.id);

    return {
      user: { id: user.id, email: user.email, role: user.role },
      token: {
        id: row.id,
        projectId: row.projectId,
        scopes: Array.isArray(row.scopes) ? row.scopes : [],
        kind: row.kind,
        clientId: row.clientId ?? null,
      },
    };
  } catch {
    return null;
  }
}

async function touchLastUsed(tokenId: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedWrites.get(tokenId);
  if (last !== undefined && now - last < LAST_USED_WRITE_INTERVAL_MS) return;
  lastUsedWrites.set(tokenId, now);
  if (lastUsedWrites.size > LAST_USED_MAP_MAX) {
    const oldest = lastUsedWrites.keys().next().value as string;
    lastUsedWrites.delete(oldest);
  }
  try {
    await db
      .update(appTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(appTokens.id, tokenId));
  } catch {
    // last_used_at is advisory; a failed touch must not fail the request
  }
}

/**
 * What a call site attaches to `request.user` for a token.
 *
 * - `pinRoleLikeApiKey: false` — pipelines and the visibility gate: the token
 *   is the member (real global role); the scope gate and the member's own
 *   project role narrow it.
 * - `pinRoleLikeApiKey: true` — the admin API (`ApiKeyGuard`): the token behaves
 *   as a project-scoped API key does — `apiKeyProjectId` fences it to its
 *   project and an admin is pinned to `user`, so a leaked token cannot reach
 *   `@Roles('admin')` endpoints or another project. A `member` stays a
 *   `member`: a token never elevates.
 */
export function requestUserFromAppToken(
  resolved: ResolvedAppToken,
  options: { pinRoleLikeApiKey: boolean },
): AppTokenRequestUser {
  const { user, token } = resolved;
  const role = options.pinRoleLikeApiKey && user.role === 'admin' ? 'user' : user.role;
  return {
    id: user.id,
    email: user.email,
    role,
    credential: {
      kind: 'app_token',
      appTokenId: token.id,
      projectId: token.projectId,
      scopes: token.scopes,
    },
    appTokenId: token.id,
    ...(options.pinRoleLikeApiKey ? { apiKeyProjectId: token.projectId } : {}),
  };
}
