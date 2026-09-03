import 'reflect-metadata';
import { Request, Response } from 'express';
import { OAuthController, registerBodyPipe } from './oauth.controller';
import { RegisterClientDto } from './oauth.dto';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { OAuthError } from './oauth.errors';
import { PUBLIC_PROJECT_ACCESS_KEY } from '../auth/decorators/public-project-access.decorator';

jest.mock('supertokens-node/recipe/session', () => ({ getSession: jest.fn() }));
const { getSession: mockGetSession } = jest.requireMock('supertokens-node/recipe/session');

function make() {
  const service = {
    metadata: jest.fn().mockReturnValue({ issuer: 'https://admin.example' }),
    registerClient: jest.fn().mockResolvedValue({ client_id: 'c1' }),
    beginAuthorization: jest.fn().mockResolvedValue({ request: 'signed', pending: {} }),
    pendingFor: jest.fn().mockResolvedValue({
      clientName: 'Claude',
      scopes: ['a:b'],
      projectId: 'p1',
      projectSlug: 'o/r',
      projectName: 'R',
      redirectUri: 'https://claude.ai/cb',
      exp: 1700000000,
    }),
    consent: jest.fn().mockResolvedValue({ redirectTo: 'https://claude.ai/cb?code=x' }),
    token: jest.fn().mockResolvedValue({ access_token: 'bfat_x' }),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new OAuthController(service as never),
    metadata: new OAuthMetadataController(service as never),
    service,
  };
}
const res = () => ({ redirect: jest.fn(), set: jest.fn() }) as unknown as Response;

describe('registerBodyPipe (RFC 7591 leniency)', () => {
  const meta = { type: 'body' as const, metatype: RegisterClientDto };
  it('strips metadata CE does not model instead of refusing it — what claude.ai sends', async () => {
    const dto = (await registerBodyPipe().transform(
      {
        client_name: 'Claude',
        client_uri: 'https://claude.ai',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        logo_uri: 'https://claude.ai/logo.png',
        contacts: ['support@anthropic.com'],
        software_id: 'claude',
        token_endpoint_auth_method: 'client_secret_post',
      },
      meta,
    )) as Record<string, unknown>;
    expect(dto).toMatchObject({
      client_name: 'Claude',
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(dto).not.toHaveProperty('logo_uri');
    expect(dto).not.toHaveProperty('contacts');
  });
  it('answers what fails validation in the RFC error shape', async () => {
    await expect(registerBodyPipe().transform({ client_name: 42 }, meta)).rejects.toMatchObject({
      error: 'invalid_client_metadata',
    });
  });
});

describe('OAuth controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opt out of project-membership scoping; only the consent routes carry SessionAuthGuard', () => {
    expect(Reflect.getMetadata(PUBLIC_PROJECT_ACCESS_KEY, OAuthController)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_PROJECT_ACCESS_KEY, OAuthMetadataController)).toBe(true);
    const guards = (method: string) =>
      (
        Reflect.getMetadata(
          '__guards__',
          OAuthController.prototype[method as keyof OAuthController],
        ) ?? []
      ).map((g: { name: string }) => g.name);
    expect(guards('pending')).toEqual(['SessionAuthGuard']);
    expect(guards('decide')).toEqual(['SessionAuthGuard']);
    expect(guards('token')).toEqual([]);
    expect(guards('register')).toEqual([]);
    expect(guards('authorize')).toEqual([]);
  });

  it('serves RFC 8414 metadata', () => {
    const { metadata, service } = make();
    expect(metadata.metadata()).toEqual({ issuer: 'https://admin.example' });
    expect(service.metadata).toHaveBeenCalled();
  });

  it('authorize: no session → the login with the full authorize URL to return to', async () => {
    const { controller } = make();
    mockGetSession.mockResolvedValueOnce(undefined);
    const r = res();
    await controller.authorize(
      { originalUrl: '/api/oauth/authorize?client_id=c1&state=s' } as Request,
      r,
      { client_id: 'c1', state: 's' },
    );
    expect(r.redirect).toHaveBeenCalledWith(
      302,
      '/login?redirect=%2Fapi%2Foauth%2Fauthorize%3Fclient_id%3Dc1%26state%3Ds&tryRefresh=true',
    );
  });

  it('authorize: a session → the consent page with the signed request', async () => {
    const { controller } = make();
    mockGetSession.mockResolvedValueOnce({ getUserId: () => 'u1' });
    const r = res();
    await controller.authorize({ originalUrl: '/x' } as Request, r, { client_id: 'c1' });
    expect(r.redirect).toHaveBeenCalledWith(302, '/oauth/consent?request=signed');
  });

  it('authorize: an error after the redirect_uri was trusted is redirected with error= and state; invalid_client is thrown', async () => {
    const { controller, service } = make();
    mockGetSession.mockResolvedValue({ getUserId: () => 'u1' });
    service.beginAuthorization.mockRejectedValueOnce(
      new OAuthError('invalid_target', 'no resource'),
    );
    const r = res();
    await controller.authorize({ originalUrl: '/x' } as Request, r, {
      client_id: 'c1',
      redirect_uri: 'https://claude.ai/cb',
      state: 'xyz',
    });
    expect(r.redirect).toHaveBeenCalledWith(
      302,
      'https://claude.ai/cb?error=invalid_target&error_description=no+resource&state=xyz',
    );
    service.beginAuthorization.mockRejectedValueOnce(
      new OAuthError('invalid_client', 'unknown', 401),
    );
    await expect(
      controller.authorize({ originalUrl: '/x' } as Request, res(), {
        client_id: 'nope',
        redirect_uri: 'https://claude.ai/cb',
      }),
    ).rejects.toMatchObject({ error: 'invalid_client' });
  });

  it('consent GET shapes the pending request; POST delegates the decision', async () => {
    const { controller, service } = make();
    await expect(controller.pending({ id: 'u1', role: 'user' }, 'signed')).resolves.toEqual({
      clientName: 'Claude',
      scopes: ['a:b'],
      project: { id: 'p1', slug: 'o/r', name: 'R' },
      redirectHost: 'claude.ai',
      expiresAt: '2023-11-14T22:13:20.000Z',
    });
    await expect(
      controller.decide({ id: 'u1' }, { request: 'signed', approve: true, scopes: ['a:b'] }),
    ).resolves.toEqual({ redirectTo: 'https://claude.ai/cb?code=x' });
    expect(service.pendingFor).toHaveBeenCalledWith('u1', 'user', 'signed');
    expect(service.consent).toHaveBeenCalledWith('u1', undefined, 'signed', {
      approve: true,
      scopes: ['a:b'],
    });
  });

  it('token and revoke read form or JSON bodies and set no-store; revoke never fails', async () => {
    const { controller, service } = make();
    const r = res();
    await expect(
      controller.token({ body: { grant_type: 'authorization_code' } } as unknown as Request, r),
    ).resolves.toEqual({ access_token: 'bfat_x' });
    expect(r.set).toHaveBeenCalledWith({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    expect(service.token).toHaveBeenCalledWith({ grant_type: 'authorization_code' });
    service.revoke.mockRejectedValueOnce(new Error('db down'));
    await expect(
      controller.revoke({ body: { token: 'bfat_x' } } as unknown as Request, res()),
    ).resolves.toEqual({});
    await expect(controller.revoke({ body: {} } as unknown as Request, res())).resolves.toEqual({});
    expect(service.revoke).toHaveBeenCalledTimes(1);
  });
});
