import { ForbiddenException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull, or } from 'drizzle-orm';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { db } from '../db/client';
import {
  appTokens,
  domainMappings,
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
  projects,
  users,
} from '../db/schema';
import { hashToken } from '../auth/app-token.util';
import { AppTokensService } from '../app-tokens/app-tokens.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SCOPE_PATTERN } from '../pipelines/types';
import { OAuthError } from './oauth.errors';
import { isValidVerifier, verifyS256 } from './pkce.util';
import {
  AuthorizationServerMetadata,
  PendingRequest,
  RegisterClientDto,
  TokenResponse,
} from './oauth.dto';

export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600_000;
export const CODE_TTL_MS = 10 * 60_000;
export const PENDING_REQUEST_TTL_S = 10 * 60;
const REFRESH_PREFIX = 'bfrt_';

/** What a fetch of the resource's protected-resource document must do (injected for tests). */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; json(): Promise<unknown> }>;

interface ResolvedResource {
  projectId: string;
  projectSlug: string;
  projectName: string;
  scopesSupported: string[];
}

/**
 * CE's built-in OAuth 2.1 authorization server (ADR-0005): dynamic client
 * registration for public clients, the authorization-code grant with PKCE
 * `S256`, RFC 8707 `resource` → the CE project the token is bound to, refresh
 * rotation with family revocation, RFC 7009 revocation. The access token *is*
 * an app token, minted through `AppTokensService`.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly appTokens: AppTokensService,
    private readonly permissions: PermissionsService,
  ) {}

  private get jwtSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is required for the OAuth authorization server');
    return secret;
  }

  /** The issuer: the admin host (`FRONTEND_URL`), no trailing slash. */
  issuer(): string {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/+$/, '');
  }

  metadata(): AuthorizationServerMetadata {
    const issuer = this.issuer();
    return {
      issuer,
      authorization_endpoint: `${issuer}/api/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      revocation_endpoint: `${issuer}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [],
      resource_indicators_supported: true,
    };
  }

  // ---------------------------------------------------------------------------
  // RFC 7591 — dynamic client registration
  // ---------------------------------------------------------------------------

  async registerClient(dto: RegisterClientDto): Promise<Record<string, unknown>> {
    const redirectUris = dto.redirect_uris ?? [];
    for (const uri of redirectUris) {
      if (!isAcceptableRedirect(uri)) {
        throw new OAuthError(
          'invalid_redirect_uri',
          `redirect_uri must be https, or http on localhost: ${uri}`,
        );
      }
    }
    if (dto.token_endpoint_auth_method !== undefined && dto.token_endpoint_auth_method !== 'none') {
      throw new OAuthError(
        'invalid_client_metadata',
        'only public clients (token_endpoint_auth_method: none) are registered',
      );
    }
    const grantTypes = dto.grant_types?.length
      ? dto.grant_types
      : ['authorization_code', 'refresh_token'];
    const [row] = await db
      .insert(oauthClients)
      .values({ clientName: dto.client_name?.trim() || 'Unnamed client', redirectUris, grantTypes })
      .returning();
    this.logger.log(`OAuth client ${row.clientId} registered (${row.clientName})`);
    return {
      client_id: row.clientId,
      client_id_issued_at: Math.floor(new Date(row.createdAt).getTime() / 1000),
      client_name: row.clientName,
      redirect_uris: row.redirectUris,
      grant_types: row.grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(dto.scope ? { scope: dto.scope } : {}),
      ...(dto.client_uri ? { client_uri: dto.client_uri } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Authorization request → consent → code
  // ---------------------------------------------------------------------------

  /**
   * Validate an authorize request; resolve `resource` to a project and its
   * scopes. Errors *before* the redirect_uri is trusted are thrown (400); the
   * caller redirects the rest with `error=` (OAuth 2.1 §4.1.2.1).
   */
  async beginAuthorization(
    params: Record<string, unknown>,
    fetchImpl: FetchLike = defaultFetch,
  ): Promise<{ request: string; pending: PendingRequest }> {
    const clientId = str(params.client_id);
    const redirectUri = str(params.redirect_uri);
    if (!clientId) throw new OAuthError('invalid_request', 'client_id is required');
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1);
    if (!client) throw new OAuthError('invalid_client', 'unknown client_id', 401);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
    }
    // From here on errors may be redirected — the controller does that; we still throw typed errors.
    if (str(params.response_type) !== 'code')
      throw new OAuthError('unsupported_grant_type', 'response_type must be code');
    const challenge = str(params.code_challenge);
    if (!challenge) throw new OAuthError('invalid_request', 'code_challenge is required (PKCE)');
    if (str(params.code_challenge_method) !== 'S256')
      throw new OAuthError('invalid_request', 'code_challenge_method must be S256');
    const resource = str(params.resource);
    if (!resource) throw new OAuthError('invalid_target', 'resource is required (RFC 8707)');
    const resolved = await this.resolveResource(resource, fetchImpl);
    const requested = str(params.scope).split(/\s+/).filter(Boolean);
    const scopes = requested.length ? requested : resolved.scopesSupported;
    for (const scope of scopes) {
      if (!SCOPE_PATTERN.test(scope) || !resolved.scopesSupported.includes(scope)) {
        throw new OAuthError('invalid_scope', `the resource does not offer scope ${scope}`);
      }
    }
    if (scopes.length === 0) throw new OAuthError('invalid_scope', 'the resource offers no scopes');
    const now = Math.floor(Date.now() / 1000);
    const pending: PendingRequest = {
      clientId,
      clientName: client.clientName,
      redirectUri,
      codeChallenge: challenge,
      ...(str(params.state) ? { state: str(params.state) } : {}),
      scopes,
      resource,
      projectId: resolved.projectId,
      projectSlug: resolved.projectSlug,
      projectName: resolved.projectName,
      iat: now,
      exp: now + PENDING_REQUEST_TTL_S,
    };
    const request = jwt.sign({ ...pending, kind: 'oauth_pending' }, this.jwtSecret, {
      algorithm: 'HS256',
    });
    return { request, pending };
  }

  readPending(request: string): PendingRequest {
    try {
      const decoded = jwt.verify(request, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as PendingRequest & { kind?: string };
      if (decoded.kind !== 'oauth_pending') throw new Error('not a pending request');
      return decoded;
    } catch {
      throw new OAuthError(
        'invalid_request',
        'the authorization request is invalid or has expired',
      );
    }
  }

  /** The member decided. Approve → an authorization code bound to the (possibly narrowed) scopes. */
  /**
   * The pending request as the consent page may show it — only to a member of
   * the project it names. Any other signed-in user gets `access_denied` (403)
   * and learns nothing about the project or the client.
   */
  async pendingFor(
    userId: string,
    userRole: string | undefined,
    request: string,
  ): Promise<PendingRequest> {
    const pending = this.readPending(request);
    await this.assertMember(userId, userRole, pending.projectId);
    return pending;
  }

  async consent(
    userId: string,
    userRole: string | undefined,
    request: string,
    decision: { approve: boolean; scopes?: string[] },
  ): Promise<{ redirectTo: string }> {
    const pending = this.readPending(request);
    const url = new URL(pending.redirectUri);
    if (pending.state) url.searchParams.set('state', pending.state);
    if (!decision.approve) {
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'the member declined');
      return { redirectTo: url.toString() };
    }
    await this.assertMember(userId, userRole, pending.projectId);
    const granted = (decision.scopes ?? pending.scopes).filter((scope) =>
      pending.scopes.includes(scope),
    );
    if (granted.length === 0)
      throw new OAuthError('invalid_scope', 'at least one scope must be granted');
    const code = randomBytes(32).toString('base64url');
    await db.insert(oauthAuthorizationCodes).values({
      codeHash: hashToken(code),
      clientId: pending.clientId,
      userId,
      projectId: pending.projectId,
      scopes: granted,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      resource: pending.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    url.searchParams.set('code', code);
    return { redirectTo: url.toString() };
  }

  // ---------------------------------------------------------------------------
  // The token endpoint
  // ---------------------------------------------------------------------------

  async token(body: Record<string, unknown>): Promise<TokenResponse> {
    const grant = str(body.grant_type);
    if (grant === 'authorization_code') return this.exchangeCode(body);
    if (grant === 'refresh_token') return this.refresh(body);
    throw new OAuthError(
      'unsupported_grant_type',
      `grant_type ${grant || '(none)'} is not supported`,
    );
  }

  private async exchangeCode(body: Record<string, unknown>): Promise<TokenResponse> {
    const code = str(body.code);
    const verifier = body.code_verifier;
    const clientId = str(body.client_id);
    if (!code || !clientId)
      throw new OAuthError('invalid_request', 'code and client_id are required');
    if (!isValidVerifier(verifier))
      throw new OAuthError('invalid_grant', 'code_verifier is missing or malformed');
    const [row] = await db
      .select()
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.codeHash, hashToken(code)))
      .limit(1);
    if (!row || row.clientId !== clientId) throw new OAuthError('invalid_grant', 'unknown code');
    if (row.usedAt) {
      // Replay: revoke what the first exchange issued (OAuth 2.1 §4.1.2 / RFC 6749 §4.1.2).
      await this.revokeFamilyOfCode(row.codeHash);
      throw new OAuthError('invalid_grant', 'code already used');
    }
    if (new Date(row.expiresAt).getTime() < Date.now())
      throw new OAuthError('invalid_grant', 'code expired');
    if (str(body.redirect_uri) !== row.redirectUri)
      throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
    if (!verifyS256(verifier, row.codeChallenge))
      throw new OAuthError('invalid_grant', 'PKCE verification failed');
    // Consume atomically: the UPDATE carries the not-yet-used condition, so of two
    // concurrent exchanges exactly one gets the row back; the other is a replay.
    const consumed = await db
      .update(oauthAuthorizationCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(oauthAuthorizationCodes.codeHash, row.codeHash),
          isNull(oauthAuthorizationCodes.usedAt),
        ),
      )
      .returning({ codeHash: oauthAuthorizationCodes.codeHash });
    if (!Array.isArray(consumed) || consumed.length === 0) {
      await this.revokeFamilyOfCode(row.codeHash);
      throw new OAuthError('invalid_grant', 'code already used');
    }
    return this.issue({
      clientId: row.clientId,
      userId: row.userId,
      projectId: row.projectId,
      scopes: row.scopes,
      familyId: familyOfCode(row.codeHash),
    });
  }

  private async refresh(body: Record<string, unknown>): Promise<TokenResponse> {
    const presented = str(body.refresh_token);
    if (!presented.startsWith(REFRESH_PREFIX))
      throw new OAuthError('invalid_grant', 'unknown refresh_token');
    const [row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, hashToken(presented)))
      .limit(1);
    if (!row) throw new OAuthError('invalid_grant', 'unknown refresh_token');
    if (str(body.client_id) && str(body.client_id) !== row.clientId)
      throw new OAuthError('invalid_grant', 'client mismatch');
    if (row.rotatedAt) {
      // A rotated token presented again: the family is compromised — revoke it all (OAuth 2.1 §4.3.1).
      await this.revokeFamily(row.familyId);
      throw new OAuthError('invalid_grant', 'refresh_token was already used; the grant is revoked');
    }
    if (new Date(row.expiresAt).getTime() < Date.now())
      throw new OAuthError('invalid_grant', 'refresh_token expired');
    const requested = str(body.scope).split(/\s+/).filter(Boolean);
    const scopes = requested.length ? requested.filter((s) => row.scopes.includes(s)) : row.scopes;
    if (scopes.length === 0) throw new OAuthError('invalid_scope', 'no granted scope requested');
    // Rotate atomically (same shape as the code exchange): a second concurrent
    // presentation finds no un-rotated row and is treated as the replay it is.
    const rotated = await db
      .update(oauthRefreshTokens)
      .set({ rotatedAt: new Date() })
      .where(
        and(eq(oauthRefreshTokens.tokenHash, row.tokenHash), isNull(oauthRefreshTokens.rotatedAt)),
      )
      .returning({ tokenHash: oauthRefreshTokens.tokenHash });
    if (!Array.isArray(rotated) || rotated.length === 0) {
      await this.revokeFamily(row.familyId);
      throw new OAuthError('invalid_grant', 'refresh_token was already used; the grant is revoked');
    }
    if (row.appTokenId) {
      await db
        .update(appTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(appTokens.id, row.appTokenId)));
    }
    return this.issue({
      clientId: row.clientId,
      userId: row.userId,
      projectId: row.projectId,
      scopes,
      familyId: row.familyId,
    });
  }

  private async issue(grant: {
    clientId: string;
    userId: string;
    projectId: string;
    scopes: string[];
    familyId: string;
  }): Promise<TokenResponse> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, grant.projectId))
      .limit(1);
    if (!project) throw new OAuthError('invalid_grant', 'the project no longer exists');
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, grant.clientId))
      .limit(1);
    const [user] = await db.select().from(users).where(eq(users.id, grant.userId)).limit(1);
    if (!user || user.disabled)
      throw new OAuthError('invalid_grant', 'the member no longer exists');
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000);
    // The same mint a member does by hand: the membership check applies (a token never elevates).
    let minted: Awaited<ReturnType<AppTokensService['create']>>;
    try {
      minted = await this.appTokens.create(
        grant.userId,
        user.role,
        {
          name: `OAuth: ${client?.clientName ?? grant.clientId}`,
          project: `${project.owner}/${project.name}`,
          scopes: grant.scopes,
        },
        { kind: 'oauth', clientId: grant.clientId, expiresAt },
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw new OAuthError('invalid_grant', 'the member no longer belongs to the project');
      }
      throw error;
    }
    const { view, raw } = minted;
    const refreshRaw = REFRESH_PREFIX + randomBytes(32).toString('hex');
    await db.insert(oauthRefreshTokens).values({
      tokenHash: hashToken(refreshRaw),
      familyId: grant.familyId,
      clientId: grant.clientId,
      userId: grant.userId,
      projectId: grant.projectId,
      scopes: grant.scopes,
      appTokenId: view.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    await db
      .update(oauthClients)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthClients.clientId, grant.clientId));
    return {
      access_token: raw,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshRaw,
      scope: grant.scopes.join(' '),
    };
  }

  // ---------------------------------------------------------------------------
  // RFC 7009 — revocation (always 200 to the caller)
  // ---------------------------------------------------------------------------

  async revoke(token: string): Promise<void> {
    if (token.startsWith(REFRESH_PREFIX)) {
      const [row] = await db
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, hashToken(token)))
        .limit(1);
      if (row) await this.revokeFamily(row.familyId);
      return;
    }
    await db
      .update(appTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(appTokens.tokenHash, hashToken(token)), eq(appTokens.kind, 'oauth')));
  }

  private async revokeFamily(familyId: string): Promise<void> {
    const rows = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.familyId, familyId));
    const now = new Date();
    for (const row of rows) {
      if (row.appTokenId)
        await db.update(appTokens).set({ revokedAt: now }).where(eq(appTokens.id, row.appTokenId));
    }
    await db
      .update(oauthRefreshTokens)
      .set({ rotatedAt: now, expiresAt: now })
      .where(eq(oauthRefreshTokens.familyId, familyId));
  }

  /** A replayed code revokes everything its first exchange issued: the family id is derived from the code. */
  /** The same membership rule `AppTokensService.create` applies at mint time, RFC-shaped. */
  private async assertMember(
    userId: string,
    userRole: string | undefined,
    projectId: string,
  ): Promise<void> {
    if (userRole === 'admin') return;
    const role = await this.permissions.getUserProjectRole(userId, projectId);
    if (!role || role === 'guest') {
      throw new OAuthError(
        'access_denied',
        'you are not a member of this project',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async revokeFamilyOfCode(codeHash: string): Promise<void> {
    await this.revokeFamily(familyOfCode(codeHash));
  }

  // ---------------------------------------------------------------------------
  // RFC 8707 — resource → project (+ the resource's own scope vocabulary)
  // ---------------------------------------------------------------------------

  private async resolveResource(resource: string, fetchImpl: FetchLike): Promise<ResolvedResource> {
    let url: URL;
    try {
      url = new URL(resource);
    } catch {
      throw new OAuthError('invalid_target', 'resource must be an absolute URL');
    }
    const host = url.hostname;
    const [primary, alternate] = resourceHosts(host);
    const [mapping] = await db
      .select()
      .from(domainMappings)
      .where(or(eq(domainMappings.domain, primary), eq(domainMappings.domain, alternate)))
      .limit(1);
    if (!mapping || !mapping.isActive || !mapping.projectId || mapping.domainType === 'redirect') {
      throw new OAuthError('invalid_target', `no deployment answers ${host}`);
    }
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, mapping.projectId))
      .limit(1);
    if (!project) throw new OAuthError('invalid_target', `no deployment answers ${host}`);
    const alias = mapping.alias || 'production';
    const base = `${(mapping.path || '').replace(/\/+$/, '')}`;
    const prmPath = '/.well-known/oauth-protected-resource';
    const inProcess = `http://localhost:3000/public/${project.owner}/${project.name}/alias/${alias}${base}${prmPath}`;
    let scopesSupported: string[] = [];
    try {
      const res = await fetchImpl(inProcess, {
        headers: {
          'x-forwarded-host': host,
          'x-original-uri': prmPath,
          accept: 'application/json',
        },
      });
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const doc = (await res.json()) as { resource?: unknown; scopes_supported?: unknown };
      scopesSupported = Array.isArray(doc.scopes_supported)
        ? doc.scopes_supported.filter((s): s is string => typeof s === 'string')
        : [];
    } catch (error) {
      this.logger.debug(`protected-resource document for ${host}: ${String(error)}`);
      throw new OAuthError('invalid_target', `${host} publishes no protected-resource document`);
    }
    return {
      projectId: project.id,
      projectSlug: `${project.owner}/${project.name}`,
      projectName: project.displayName || project.name,
      scopesSupported,
    };
  }
}

/** The refresh-token family a code's exchange starts — a UUID carved from the code's hash, so a replay can find it. */
export function familyOfCode(codeHash: string): string {
  const h = codeHash.padEnd(32, '0').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isAcceptableRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, json: () => res.json() };
};

/**
 * A resource's host and its www/non-www alternate — a primary domain with
 * "redirect to www" stores one variant in `domain_mappings` while clients present
 * the other (the same rule `VisibilityService` and `TrafficRoutingService` apply).
 */
export function resourceHosts(host: string): [string, string] {
  const normalized = host.toLowerCase();
  return [normalized, normalized.startsWith('www.') ? normalized.slice(4) : `www.${normalized}`];
}
