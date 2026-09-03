import * as jwt from 'jsonwebtoken';
import { OAuthService, resourceHosts, familyOfCode } from './oauth.service';
import { OAuthError } from './oauth.errors';
import { challengeOf } from './pkce.util';
import { hashToken } from '../auth/app-token.util';

jest.mock('../db/client', () => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
  ])
    chain[m] = jest.fn();
  return { db: chain };
});
const mockDb = jest.requireMock('../db/client').db as Record<string, jest.Mock>;

const client = {
  clientId: 'c1',
  clientName: 'Claude',
  redirectUris: ['https://claude.ai/cb'],
  grantTypes: ['authorization_code', 'refresh_token'],
  createdAt: new Date('2026-09-03T00:00:00Z'),
  lastUsedAt: null,
};
const mapping = {
  id: 'm1',
  domain: 'workflow.j5s.dev',
  projectId: 'p1',
  alias: 'workflow',
  path: '/dist',
  isActive: true,
  domainType: 'subdomain',
};
const project = { id: 'p1', owner: 'bffless', name: 'workflow', displayName: 'Workflow' };
const user = { id: 'u1', email: 'm@example.com', role: 'user', disabled: false };
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const prm = async () => ({
  status: 200,
  json: async () => ({
    resource: 'https://workflow.j5s.dev/api/workflow/mcp',
    scopes_supported: ['workflow:read', 'workflow:run', 'workflow:files'],
  }),
});

function make(configOverrides: Record<string, string | undefined> = {}) {
  const config = {
    get: (k: string) =>
      ({
        JWT_SECRET: 'test-secret',
        FRONTEND_URL: 'https://www.j5s.dev',
        ADMIN_DOMAIN: 'admin.j5s.dev',
        ...configOverrides,
      })[k],
  };
  const appTokens = {
    create: jest.fn().mockResolvedValue({ view: { id: 'tok-1' }, raw: 'bfat_raw' }),
  };
  const permissions = { getUserProjectRole: jest.fn().mockResolvedValue('contributor') };
  return {
    service: new OAuthService(config as never, appTokens as never, permissions as never),
    appTokens,
    permissions,
  };
}

const authorizeParams = (over: Record<string, unknown> = {}) => ({
  response_type: 'code',
  client_id: 'c1',
  redirect_uri: 'https://claude.ai/cb',
  code_challenge: challengeOf(verifier),
  code_challenge_method: 'S256',
  state: 'xyz',
  resource: 'https://workflow.j5s.dev/api/workflow/mcp',
  ...over,
});

describe('OAuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const m of Object.keys(mockDb)) mockDb[m].mockReturnValue(mockDb);
  });

  it('publishes RFC 8414 metadata on the issuer — the admin host, never the public site', () => {
    const { service } = make();
    const m = service.metadata();
    expect(m.issuer).toBe('https://admin.j5s.dev');
    // an installed instance: FRONTEND_URL is www.<domain> (a project's rules answer its /api/*), ADMIN_DOMAIN the admin host
    expect(
      make({
        FRONTEND_URL: 'https://www.example.com',
        ADMIN_DOMAIN: 'admin.example.com',
      }).service.issuer(),
    ).toBe('https://admin.example.com');
    // an explicit issuer wins; a scheme on ADMIN_DOMAIN is kept
    expect(make({ OAUTH_ISSUER: 'https://auth.example.com/' }).service.issuer()).toBe(
      'https://auth.example.com',
    );
    expect(make({ ADMIN_DOMAIN: 'http://admin.example.com/' }).service.issuer()).toBe(
      'http://admin.example.com',
    );
    // local dev: admin.localhost is not a host a client can reach — the frontend URL serves both
    expect(
      make({
        FRONTEND_URL: 'http://localhost:5173/',
        ADMIN_DOMAIN: 'admin.localhost',
      }).service.issuer(),
    ).toBe('http://localhost:5173');
    expect(
      make({ FRONTEND_URL: 'http://localhost:3000', ADMIN_DOMAIN: undefined }).service.issuer(),
    ).toBe('http://localhost:3000');
    expect(m.authorization_endpoint).toBe('https://admin.j5s.dev/api/oauth/authorize');
    expect(m.registration_endpoint).toBe('https://admin.j5s.dev/api/oauth/register');
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
    expect(m.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(m.resource_indicators_supported).toBe(true);
  });

  describe('registerClient', () => {
    it('registers a public client with https or localhost redirects and echoes the metadata', async () => {
      const { service } = make();
      mockDb.returning.mockResolvedValueOnce([client]);
      const out = await service.registerClient({
        redirect_uris: ['https://claude.ai/cb', 'http://localhost:8080/cb'],
        client_name: 'Claude',
      });
      expect(out).toMatchObject({
        client_id: 'c1',
        client_name: 'Claude',
        token_endpoint_auth_method: 'none',
        response_types: ['code'],
      });
      expect(out).not.toHaveProperty('client_secret');
      expect(mockDb.values.mock.calls[0][0]).toMatchObject({
        redirectUris: ['https://claude.ai/cb', 'http://localhost:8080/cb'],
      });
    });
    it('refuses a plain-http remote redirect', async () => {
      const { service } = make();
      await expect(
        service.registerClient({ redirect_uris: ['http://evil.example/cb'] }),
      ).rejects.toThrow(OAuthError);
    });
    it('registers a client that asked for a secret as a public client and says so (RFC 7591 §3.2.1); drops unsupported grant types', async () => {
      const { service } = make();
      mockDb.returning.mockResolvedValueOnce([
        {
          ...client,
          redirectUris: ['https://x/cb'],
          grantTypes: ['authorization_code'],
          createdAt: new Date(),
        },
      ]);
      const out = await service.registerClient({
        redirect_uris: ['https://x/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code', 'implicit'],
      });
      expect(out.token_endpoint_auth_method).toBe('none');
      expect(mockDb.values.mock.calls[0][0]).toMatchObject({ grantTypes: ['authorization_code'] });
    });
  });

  describe('beginAuthorization / readPending', () => {
    it('resolves the resource to its project and scopes, and signs a 10-minute pending request', async () => {
      const { service } = make();
      mockDb.limit
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([mapping])
        .mockResolvedValueOnce([project]);
      const fetchImpl = jest.fn(prm);
      const { request, pending } = await service.beginAuthorization(authorizeParams(), fetchImpl);
      expect(fetchImpl).toHaveBeenCalledWith(
        'http://localhost:3000/public/bffless/workflow/alias/workflow/dist/.well-known/oauth-protected-resource',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-forwarded-host': 'workflow.j5s.dev',
            'x-original-uri': '/.well-known/oauth-protected-resource',
          }),
        }),
      );
      expect(pending).toMatchObject({
        clientId: 'c1',
        projectId: 'p1',
        projectSlug: 'bffless/workflow',
        scopes: ['workflow:read', 'workflow:run', 'workflow:files'],
        state: 'xyz',
      });
      expect(pending.exp - pending.iat).toBe(600);
      expect(service.readPending(request)).toMatchObject({ clientId: 'c1', projectId: 'p1' });
    });
    it('resolves the www/non-www alternate of the resource host, like every other domain lookup', async () => {
      const { service } = make();
      expect(resourceHosts('www.Example.com')).toEqual(['www.example.com', 'example.com']);
      expect(resourceHosts('example.com')).toEqual(['example.com', 'www.example.com']);
      mockDb.limit
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([mapping])
        .mockResolvedValueOnce([project]);
      const fetchImpl = jest.fn(prm);
      const { pending } = await service.beginAuthorization(
        authorizeParams({ resource: 'https://www.workflow.j5s.dev/api/workflow/mcp' }),
        fetchImpl,
      );
      expect(pending.projectId).toBe('p1');
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-forwarded-host': 'www.workflow.j5s.dev' }),
        }),
      );
    });
    it('narrows to the requested scopes and refuses an unknown one', async () => {
      const { service } = make();
      mockDb.limit
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([mapping])
        .mockResolvedValueOnce([project]);
      const { pending } = await service.beginAuthorization(
        authorizeParams({ scope: 'workflow:read' }),
        prm,
      );
      expect(pending.scopes).toEqual(['workflow:read']);
      mockDb.limit
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([mapping])
        .mockResolvedValueOnce([project]);
      await expect(
        service.beginAuthorization(authorizeParams({ scope: 'workflow:admin' }), prm),
      ).rejects.toMatchObject({ error: 'invalid_scope' });
    });
    it('refuses before trusting the redirect: unknown client, unregistered redirect_uri; then invalid_target, missing PKCE', async () => {
      const { service } = make();
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.beginAuthorization(authorizeParams(), prm)).rejects.toMatchObject({
        error: 'invalid_client',
      });
      mockDb.limit.mockResolvedValueOnce([client]);
      await expect(
        service.beginAuthorization(authorizeParams({ redirect_uri: 'https://other/cb' }), prm),
      ).rejects.toMatchObject({ error: 'invalid_request' });
      mockDb.limit.mockResolvedValueOnce([client]);
      await expect(
        service.beginAuthorization(authorizeParams({ resource: undefined }), prm),
      ).rejects.toMatchObject({ error: 'invalid_target' });
      mockDb.limit.mockResolvedValueOnce([client]).mockResolvedValueOnce([]);
      await expect(service.beginAuthorization(authorizeParams(), prm)).rejects.toMatchObject({
        error: 'invalid_target',
      });
      mockDb.limit
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([mapping])
        .mockResolvedValueOnce([project]);
      await expect(
        service.beginAuthorization(authorizeParams(), async () => ({
          status: 404,
          json: async () => ({}),
        })),
      ).rejects.toMatchObject({ error: 'invalid_target' });
      mockDb.limit.mockResolvedValueOnce([client]);
      await expect(
        service.beginAuthorization(authorizeParams({ code_challenge_method: 'plain' }), prm),
      ).rejects.toMatchObject({ error: 'invalid_request' });
    });
    it('rejects a tampered or expired pending request', () => {
      const { service } = make();
      expect(() => service.readPending('nope')).toThrow(OAuthError);
      const expired = jwt.sign(
        { kind: 'oauth_pending', exp: Math.floor(Date.now() / 1000) - 5 },
        'test-secret',
      );
      expect(() => service.readPending(expired)).toThrow(OAuthError);
      const other = jwt.sign({ kind: 'other' }, 'test-secret');
      expect(() => service.readPending(other)).toThrow(OAuthError);
    });
  });

  describe('consent', () => {
    const pendingFor = (service: OAuthService, scopes = ['workflow:read', 'workflow:run']) =>
      jwt.sign(
        {
          kind: 'oauth_pending',
          clientId: 'c1',
          clientName: 'Claude',
          redirectUri: 'https://claude.ai/cb',
          codeChallenge: challengeOf(verifier),
          state: 'xyz',
          scopes,
          resource: 'https://workflow.j5s.dev/api/workflow/mcp',
          projectId: 'p1',
          projectSlug: 'bffless/workflow',
          projectName: 'Workflow',
          iat: 1,
          exp: Math.floor(Date.now() / 1000) + 600,
        },
        'test-secret',
      );

    it('denial redirects with access_denied and the state; approval stores a hashed code with the granted subset', async () => {
      const { service } = make();
      const denied = await service.consent('u1', 'user', pendingFor(service), { approve: false });
      expect(denied.redirectTo).toBe(
        'https://claude.ai/cb?state=xyz&error=access_denied&error_description=the+member+declined',
      );
      mockDb.values.mockReturnValueOnce(Promise.resolve());
      const ok = await service.consent('u1', 'user', pendingFor(service), {
        approve: true,
        scopes: ['workflow:read', 'workflow:admin'],
      });
      const url = new URL(ok.redirectTo);
      expect(url.searchParams.get('state')).toBe('xyz');
      const code = url.searchParams.get('code')!;
      expect(code.length).toBeGreaterThan(30);
      const stored = mockDb.values.mock.calls[0][0];
      expect(stored.codeHash).toBe(hashToken(code));
      expect(stored.scopes).toEqual(['workflow:read']);
      expect(stored.userId).toBe('u1');
      expect(stored.codeChallenge).toBe(challengeOf(verifier));
    });
    it('refuses an empty grant', async () => {
      const { service } = make();
      await expect(
        service.consent('u1', 'user', pendingFor(service), { approve: true, scopes: [] }),
      ).rejects.toMatchObject({ error: 'invalid_scope' });
    });
    it('shows and grants only to a member of the named project; an admin passes without a role row', async () => {
      const { service, permissions } = make();
      permissions.getUserProjectRole.mockResolvedValueOnce(null);
      await expect(service.pendingFor('u2', 'user', pendingFor(service))).rejects.toMatchObject({
        error: 'access_denied',
        status: 403,
      });
      permissions.getUserProjectRole.mockResolvedValueOnce('guest');
      await expect(
        service.consent('u2', 'user', pendingFor(service), { approve: true }),
      ).rejects.toMatchObject({ error: 'access_denied' });
      expect(mockDb.insert).not.toHaveBeenCalled();
      // a non-member's Deny still redirects — nothing about the project is revealed by it
      const denied = await service.consent('u2', 'user', pendingFor(service), { approve: false });
      expect(denied.redirectTo).toContain('error=access_denied');
      permissions.getUserProjectRole.mockClear();
      await expect(service.pendingFor('root', 'admin', pendingFor(service))).resolves.toMatchObject(
        {
          projectId: 'p1',
        },
      );
      expect(permissions.getUserProjectRole).not.toHaveBeenCalled();
    });
  });

  describe('token: authorization_code', () => {
    const codeRow = (over: Record<string, unknown> = {}) => ({
      codeHash: hashToken('the-code'),
      clientId: 'c1',
      userId: 'u1',
      projectId: 'p1',
      scopes: ['workflow:read'],
      codeChallenge: challengeOf(verifier),
      redirectUri: 'https://claude.ai/cb',
      resource: 'https://workflow.j5s.dev/api/workflow/mcp',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      ...over,
    });
    const body = (over: Record<string, unknown> = {}) => ({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: 'c1',
      redirect_uri: 'https://claude.ai/cb',
      code_verifier: verifier,
      ...over,
    });

    it('mints an app token (kind oauth, 1 h) and a refresh token in a family derived from the code', async () => {
      const { service, appTokens } = make();
      mockDb.limit
        .mockResolvedValueOnce([codeRow()])
        .mockResolvedValueOnce([project])
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([user]);
      mockDb.where.mockReturnValue(mockDb);
      mockDb.returning.mockResolvedValueOnce([{ codeHash: hashToken('the-code') }]);
      const out = await service.token(body());
      expect(out).toMatchObject({
        access_token: 'bfat_raw',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'workflow:read',
      });
      expect(out.refresh_token).toMatch(/^bfrt_[0-9a-f]{64}$/);
      expect(appTokens.create).toHaveBeenCalledWith(
        'u1',
        'user',
        { name: 'OAuth: Claude', project: 'bffless/workflow', scopes: ['workflow:read'] },
        expect.objectContaining({ kind: 'oauth', clientId: 'c1', expiresAt: expect.any(Date) }),
      );
      const refreshRow = mockDb.values.mock.calls.find((c) => c[0].familyId)![0];
      expect(refreshRow.familyId).toBe(familyOfCode(hashToken('the-code')));
      expect(refreshRow.appTokenId).toBe('tok-1');
      expect(refreshRow.tokenHash).toBe(hashToken(out.refresh_token));
    });
    it('refuses a wrong verifier, a mismatched redirect_uri, a used code (and revokes its family), an expired code', async () => {
      const { service } = make();
      mockDb.limit.mockResolvedValueOnce([codeRow()]);
      await expect(service.token(body({ code_verifier: 'x'.repeat(43) }))).rejects.toMatchObject({
        error: 'invalid_grant',
      });
      mockDb.limit.mockResolvedValueOnce([codeRow()]);
      await expect(
        service.token(body({ redirect_uri: 'https://claude.ai/other' })),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      mockDb.limit.mockResolvedValueOnce([codeRow({ usedAt: new Date() })]);
      mockDb.where.mockReturnValueOnce(mockDb).mockResolvedValueOnce([]);
      await expect(service.token(body())).rejects.toMatchObject({ error: 'invalid_grant' });
      mockDb.limit.mockResolvedValueOnce([codeRow({ expiresAt: new Date(Date.now() - 1) })]);
      await expect(service.token(body())).rejects.toMatchObject({ error: 'invalid_grant' });
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.token(body())).rejects.toMatchObject({ error: 'invalid_grant' });
      await expect(service.token({ grant_type: 'password' })).rejects.toMatchObject({
        error: 'unsupported_grant_type',
      });
    });
  });

  describe('token: single use is enforced by the consuming UPDATE, not the earlier read', () => {
    it('an exchange that finds the code consumed underneath it revokes the family', async () => {
      const { service, appTokens } = make();
      mockDb.limit.mockResolvedValueOnce([
        {
          codeHash: hashToken('the-code'),
          clientId: 'c1',
          userId: 'u1',
          projectId: 'p1',
          scopes: ['workflow:read'],
          codeChallenge: challengeOf(verifier),
          redirectUri: 'https://claude.ai/cb',
          resource: 'https://workflow.j5s.dev/api/workflow/mcp',
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      mockDb.returning.mockResolvedValueOnce([]); // the other exchange won
      mockDb.where
        .mockReturnValueOnce(mockDb)
        .mockReturnValueOnce(mockDb)
        .mockResolvedValueOnce([]);
      await expect(
        service.token({
          grant_type: 'authorization_code',
          code: 'the-code',
          client_id: 'c1',
          redirect_uri: 'https://claude.ai/cb',
          code_verifier: verifier,
        }),
      ).rejects.toMatchObject({ error: 'invalid_grant', description: 'code already used' });
      expect(appTokens.create).not.toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({
        rotatedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
    });
    it('a rotation that finds the token rotated underneath it revokes the family', async () => {
      const { service, appTokens } = make();
      mockDb.limit.mockResolvedValueOnce([
        {
          tokenHash: hashToken('bfrt_old'),
          familyId: 'fam-1',
          clientId: 'c1',
          userId: 'u1',
          projectId: 'p1',
          scopes: ['workflow:read'],
          appTokenId: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          rotatedAt: null,
        },
      ]);
      mockDb.returning.mockResolvedValueOnce([]);
      mockDb.where
        .mockReturnValueOnce(mockDb)
        .mockReturnValueOnce(mockDb)
        .mockResolvedValueOnce([]);
      await expect(
        service.token({ grant_type: 'refresh_token', refresh_token: 'bfrt_old', client_id: 'c1' }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      expect(appTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('token: refresh_token', () => {
    const refreshRow = (over: Record<string, unknown> = {}) => ({
      tokenHash: hashToken('bfrt_old'),
      familyId: 'fam-1',
      clientId: 'c1',
      userId: 'u1',
      projectId: 'p1',
      scopes: ['workflow:read', 'workflow:run'],
      appTokenId: 'tok-old',
      expiresAt: new Date(Date.now() + 60_000),
      rotatedAt: null,
      ...over,
    });

    it('rotates: marks the old token, revokes the old access token, issues a new pair in the same family', async () => {
      const { service } = make();
      mockDb.limit
        .mockResolvedValueOnce([refreshRow()])
        .mockResolvedValueOnce([project])
        .mockResolvedValueOnce([client])
        .mockResolvedValueOnce([user]);
      mockDb.where.mockReturnValue(mockDb);
      mockDb.returning.mockResolvedValueOnce([{ tokenHash: 'h1' }]);
      const out = await service.token({
        grant_type: 'refresh_token',
        refresh_token: 'bfrt_old',
        client_id: 'c1',
      });
      expect(out.refresh_token).not.toBe('bfrt_old');
      expect(mockDb.set).toHaveBeenCalledWith({ rotatedAt: expect.any(Date) });
      expect(mockDb.set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
      const newRow = mockDb.values.mock.calls.find((c) => c[0].familyId)![0];
      expect(newRow.familyId).toBe('fam-1');
    });
    it('a rotated token presented again revokes the family', async () => {
      const { service } = make();
      mockDb.limit.mockResolvedValueOnce([refreshRow({ rotatedAt: new Date() })]);
      mockDb.where
        .mockReturnValueOnce(mockDb)
        .mockResolvedValueOnce([
          refreshRow({ rotatedAt: new Date() }),
          refreshRow({ tokenHash: 'h2', appTokenId: 'tok-2' }),
        ]);
      await expect(
        service.token({ grant_type: 'refresh_token', refresh_token: 'bfrt_old' }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      // both access tokens revoked, whole family closed
      expect(mockDb.set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
      expect(mockDb.set).toHaveBeenCalledWith({
        rotatedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
    });
    it('refuses an unknown or expired refresh token', async () => {
      const { service } = make();
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(
        service.token({ grant_type: 'refresh_token', refresh_token: 'bfrt_nope' }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      await expect(
        service.token({ grant_type: 'refresh_token', refresh_token: 'not-a-refresh' }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      mockDb.limit.mockResolvedValueOnce([refreshRow({ expiresAt: new Date(Date.now() - 1) })]);
      await expect(
        service.token({ grant_type: 'refresh_token', refresh_token: 'bfrt_old' }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
    });
  });

  describe('revoke', () => {
    it('revokes an access token by hash and a refresh token by family, never throwing', async () => {
      const { service } = make();
      mockDb.where.mockResolvedValueOnce(undefined);
      await expect(service.revoke('bfat_x')).resolves.toBeUndefined();
      expect(mockDb.set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
      mockDb.limit.mockResolvedValueOnce([{ familyId: 'fam-9' }]);
      mockDb.where
        .mockReturnValueOnce(mockDb)
        .mockResolvedValueOnce([])
        .mockResolvedValue(undefined);
      await expect(service.revoke('bfrt_x')).resolves.toBeUndefined();
    });
  });
});
