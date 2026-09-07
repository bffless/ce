import { Request, Response } from 'express';

jest.mock('supertokens-node/framework/express', () => ({
  middleware: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  decode: jest.fn(),
}));

import { middleware as supertokensMiddleware } from 'supertokens-node/framework/express';
import * as jwt from 'jsonwebtoken';
import { AuthMiddleware } from './auth.middleware';
import { VisibilityService } from '../domains/visibility.service';

const mockSupertokensMiddleware = supertokensMiddleware as jest.Mock;
const mockDecode = jwt.decode as jest.Mock;

describe('AuthMiddleware', () => {
  let authMiddleware: AuthMiddleware;
  let visibilityService: { resolveAccessControlByDomain: jest.Mock };
  let supertokensHandler: jest.Mock;
  let next: jest.Mock;

  const request = (
    originalUrl: string,
    headers: Record<string, string> = {},
    cookies: Record<string, string> = { sAccessToken: 'jwt' },
  ): Request =>
    ({
      originalUrl,
      path: originalUrl.split('?')[0],
      method: 'GET',
      headers,
      cookies,
    }) as unknown as Request;

  const response = (): Response =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    supertokensHandler = jest.fn((_req, _res, nextFn) => nextFn());
    mockSupertokensMiddleware.mockReturnValue(supertokensHandler);
    next = jest.fn();
    visibilityService = { resolveAccessControlByDomain: jest.fn().mockResolvedValue(null) };
    authMiddleware = new AuthMiddleware(visibilityService as unknown as VisibilityService);
    // Expired one hour ago
    mockDecode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 3600 });
  });

  describe('expired access token: browser vs. API classification (issue #778)', () => {
    it('answers a request with no Accept header at all with 401 "try refresh token"', async () => {
      // The admin SPA's fetchBaseQuery and an app's own fetch() send no Accept
      // header. They must get the SuperTokens-format 401 that
      // baseQueryWithReauth keys on to refresh and retry.
      const req = request('/api/projects');
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
      expect(supertokensHandler).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect((req as any).tokenExpired).toBe(true);
    });

    it("answers the SPA's fetch() profile (Accept: */*, Sec-Fetch-Mode: cors) with 401", async () => {
      const req = request('/api/projects', { accept: '*/*', 'sec-fetch-mode': 'cors' });
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
    });

    it('lets a browser navigation (Accept: text/html) continue so the guards can redirect', async () => {
      const req = request('/dashboard', {
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'sec-fetch-mode': 'navigate',
      });
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(supertokensHandler).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).tokenExpired).toBe(true);
    });

    it('lets an API request through to the controller on a /public/* route of a public domain', async () => {
      visibilityService.resolveAccessControlByDomain.mockResolvedValue({ isPublic: true });
      const req = request('/public/owner/repo/alias/production/app.js', {
        host: 'site.example.com',
      });
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('answers an API request on a /public/* route of a private domain with 401', async () => {
      visibilityService.resolveAccessControlByDomain.mockResolvedValue({ isPublic: false });
      const req = request('/public/owner/repo/alias/production/data.json', {
        host: 'site.example.com',
      });
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
    });
  });

  describe('pass-through cases', () => {
    it('skips the expiry check on auth endpoints', async () => {
      const req = request('/api/auth/session/refresh');
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(mockDecode).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('continues when the token is still valid', async () => {
      mockDecode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
      const req = request('/api/projects');
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).tokenExpired).toBeUndefined();
    });

    it('continues when there is no access token cookie at all', async () => {
      const req = request('/api/projects', {}, {});
      const res = response();

      await authMiddleware.use(req, res, next);

      expect(mockDecode).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
