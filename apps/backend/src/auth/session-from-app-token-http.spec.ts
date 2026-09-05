import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// The real `resolveAppToken` runs against this: two `select … limit(1)` reads
// (token row, then user row) and the advisory `update … set({ lastUsedAt })`
// touch, whose `where` is terminal.
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  },
}));
jest.mock('supertokens-node', () => ({
  __esModule: true,
  getUser: jest.fn(),
  listUsersByAccountInfo: jest.fn(),
  RecipeUserId: jest.fn().mockImplementation((id: string) => ({ getAsString: () => id })),
}));
jest.mock('supertokens-node/recipe/emailverification', () => ({
  __esModule: true,
  default: { isEmailVerified: jest.fn().mockResolvedValue(true) },
}));
jest.mock('supertokens-node/recipe/emailpassword', () => ({
  __esModule: true,
  default: { signIn: jest.fn() },
}));
jest.mock('supertokens-node/recipe/session', () => ({
  __esModule: true,
  default: { createNewSession: jest.fn() },
}));

import Session from 'supertokens-node/recipe/session';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { DomainTokenService } from './domain-token.service';
import { ProjectResolverService } from './project-resolver.service';
import { resetLastUsedThrottle } from './app-token.util';
import { SetupService } from '../setup/setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { OnboardingExecutorService } from '../onboarding-rules/onboarding-executor.service';
import { ProjectInviteLinksService } from '../project-invite-links/project-invite-links.service';
import { PermissionsService } from '../permissions/permissions.service';
import { OidcProvidersService } from '../settings/oidc-providers.service';
import { GlobalExceptionFilter } from '../common/filters';

const mockDb = jest.requireMock('../db/client').db;
const limitMock = mockDb.limit as jest.Mock;
const createNewSessionMock = Session.createNewSession as jest.Mock;

const RAW_TOKEN = 'bfat_' + 'b'.repeat(64);
const userRow = { id: 'user-1', email: 'm@example.com', role: 'member', disabled: false };
const tokenRow = (scopes: string[]) => ({
  id: 'tok-1',
  userId: 'user-1',
  projectId: 'proj-1',
  scopes,
  kind: 'personal',
  clientId: null,
  expiresAt: null,
  revokedAt: null,
});

/**
 * The endpoint's error contract on the wire — through the same
 * `GlobalExceptionFilter` main.ts installs, which rebuilds every error body.
 * A unit test that inspects `exception.getResponse()` never proves that
 * `code` / `missingScopes` survive it; this does.
 */
describe('POST /api/auth/session/from-app-token over HTTP (GlobalExceptionFilter installed)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: SetupService, useValue: {} },
        {
          provide: FeatureFlagsService,
          useValue: { isEnabled: jest.fn().mockResolvedValue(false) },
        },
        { provide: OnboardingExecutorService, useValue: {} },
        { provide: DomainTokenService, useValue: {} },
        { provide: ProjectInviteLinksService, useValue: {} },
        {
          provide: ProjectResolverService,
          useValue: { resolveProjectFromRequest: jest.fn().mockResolvedValue(null) },
        },
        { provide: PermissionsService, useValue: {} },
        { provide: OidcProvidersService, useValue: {} },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetLastUsedThrottle();
    limitMock.mockReset().mockResolvedValue([]);
    createNewSessionMock.mockResolvedValue({});
  });

  it('401 with `code: unauthorized` on the wire when no app token is presented', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/session/from-app-token');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
      code: 'unauthorized',
      message: expect.stringContaining('app token'),
    });
    expect(createNewSessionMock).not.toHaveBeenCalled();
  });

  it('403 with `code: insufficient_scope` and `missingScopes` on the wire when the token lacks auth:session', async () => {
    limitMock.mockResolvedValueOnce([tokenRow(['workflow:read'])]).mockResolvedValueOnce([userRow]);
    const res = await request(app.getHttpServer())
      .post('/api/auth/session/from-app-token')
      .set('Authorization', `Bearer ${RAW_TOKEN}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      code: 'insufficient_scope',
      missingScopes: ['auth:session'],
    });
    expect(createNewSessionMock).not.toHaveBeenCalled();
  });

  it('200 with the sign-in body when the token carries auth:session', async () => {
    limitMock
      .mockResolvedValueOnce([tokenRow(['workflow:read', 'auth:session'])])
      .mockResolvedValueOnce([userRow]);
    const res = await request(app.getHttpServer())
      .post('/api/auth/session/from-app-token')
      .set('Authorization', `Bearer ${RAW_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Signed in successfully',
      user: { id: 'user-1', email: 'm@example.com', role: 'member' },
    });
    expect(createNewSessionMock).toHaveBeenCalledTimes(1);
    expect(createNewSessionMock.mock.calls[0][4]).toEqual({
      role: 'member',
      via: 'app_token',
      appTokenId: 'tok-1',
    });
  });
});
