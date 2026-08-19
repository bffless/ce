import { Test, TestingModule } from '@nestjs/testing';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { IntegrationsService } from './integrations.service';
import { GoogleIntegrationCredentialsService } from '../settings/google-integration-credentials.service';
import { GoogleCalendarIntegrationKeys } from './google-calendar.interface';

describe('GoogleCalendarOAuthService', () => {
  let service: GoogleCalendarOAuthService;
  let integrationsService: {
    getActiveConfig: jest.Mock;
    setConfig: jest.Mock;
    getStoredIntegration: jest.Mock;
  };
  let credsService: {
    getCredentials: jest.Mock;
    isConfigured: jest.Mock;
  };
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    integrationsService = {
      getActiveConfig: jest.fn(),
      setConfig: jest.fn().mockResolvedValue(undefined),
      getStoredIntegration: jest.fn().mockResolvedValue({
        enabled: true,
        activeEnvironment: 'production',
      }),
    } as any;
    credsService = {
      // Default: workspace creds are configured. Tests that need the
      // "not configured" branch override per-test.
      getCredentials: jest
        .fn()
        .mockResolvedValue({ clientId: 'workspace-client-id', clientSecret: 'workspace-secret' }),
      isConfigured: jest.fn().mockResolvedValue(true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleCalendarOAuthService,
        { provide: IntegrationsService, useValue: integrationsService },
        { provide: GoogleIntegrationCredentialsService, useValue: credsService },
      ],
    }).compile();

    service = module.get(GoogleCalendarOAuthService);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mockFetch = (
    impl: (url: string, init?: any) => Promise<{ ok: boolean; status?: number; body: any }>,
  ) => {
    globalThis.fetch = jest.fn(async (url: any, init: any) => {
      const r = await impl(String(url), init);
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        json: async () => r.body,
      } as any;
    }) as any;
  };

  describe('buildAuthorizationUrl', () => {
    it('includes the project clientId, scopes, and state', () => {
      const url = service.buildAuthorizationUrl('cid.example', 'state-abc', 'https://site.test/cb');
      expect(url).toContain('client_id=cid.example');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fsite.test%2Fcb');
      expect(url).toContain('state=state-abc');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      // calendar.events scope should appear in the encoded scope param
      expect(url).toContain('calendar.events');
    });
  });

  describe('refreshAccessTokenForCredentials', () => {
    it('returns access token + absolute expiry on success', async () => {
      mockFetch(async () => ({ ok: true, body: { access_token: 'new-tok', expires_in: 3600 } }));

      const before = Date.now();
      const result = await service.refreshAccessTokenForCredentials('cid', 'sec', 'rt');
      const after = Date.now();

      expect(result.accessToken).toBe('new-tok');
      expect(result.tokenExpiry).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
      expect(result.tokenExpiry).toBeLessThanOrEqual(after + 3600 * 1000 + 50);
    });

    it('throws when Google returns non-2xx', async () => {
      mockFetch(async () => ({
        ok: false,
        status: 400,
        body: { error_description: 'invalid_grant' },
      }));

      await expect(service.refreshAccessTokenForCredentials('cid', 'sec', 'rt')).rejects.toThrow(
        'invalid_grant',
      );
    });
  });

  describe('listCalendarsForToken', () => {
    it('parses items into the expected tuple shape with timezone fallback', async () => {
      mockFetch(async () => ({
        ok: true,
        body: {
          items: [
            { id: 'a@x', summary: 'A', primary: true, timeZone: 'America/New_York' },
            { id: 'b@x' /* missing summary + tz */ },
          ],
        },
      }));

      const cals = await service.listCalendarsForToken('access-tok');

      expect(cals).toHaveLength(2);
      expect(cals[0]).toEqual({
        id: 'a@x',
        summary: 'A',
        primary: true,
        timeZone: 'America/New_York',
      });
      expect(cals[1]).toEqual({ id: 'b@x', summary: 'b@x', primary: false, timeZone: 'UTC' });
    });
  });

  describe('getValidAccessToken', () => {
    const baseConfig: GoogleCalendarIntegrationKeys = {
      clientId: 'cid',
      clientSecret: 'sec',
      accessToken: 'current-tok',
      refreshToken: 'rt',
      tokenExpiry: Date.now() + 5 * 60_000, // 5 min from now
    };

    it('returns the existing token when not within the 60s buffer', async () => {
      integrationsService.getActiveConfig.mockResolvedValue(baseConfig);
      const fetchSpy = jest.spyOn(globalThis, 'fetch' as any);

      const tok = await service.getValidAccessToken('proj', 'production');
      expect(tok).toBe('current-tok');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(integrationsService.setConfig).not.toHaveBeenCalled();
    });

    it('refreshes and persists when within the 60s buffer', async () => {
      integrationsService.getActiveConfig.mockResolvedValue({
        ...baseConfig,
        tokenExpiry: Date.now() + 30_000, // expires in 30s — inside buffer
      });
      mockFetch(async () => ({ ok: true, body: { access_token: 'fresh', expires_in: 3600 } }));

      const tok = await service.getValidAccessToken('proj', 'production');

      expect(tok).toBe('fresh');
      expect(integrationsService.setConfig).toHaveBeenCalledWith(
        'proj',
        'google-calendar',
        'production',
        expect.objectContaining({ accessToken: 'fresh' }),
      );
    });

    it('returns null without throwing when refresh fails', async () => {
      integrationsService.getActiveConfig.mockResolvedValue({
        ...baseConfig,
        tokenExpiry: 0,
      });
      mockFetch(async () => ({
        ok: false,
        status: 400,
        body: { error_description: 'invalid_grant' },
      }));

      const tok = await service.getValidAccessToken('proj', 'production');
      expect(tok).toBeNull();
      expect(integrationsService.setConfig).not.toHaveBeenCalled();
    });

    it('returns null when integration is not configured', async () => {
      integrationsService.getActiveConfig.mockResolvedValue(null);
      const tok = await service.getValidAccessToken('proj', 'production');
      expect(tok).toBeNull();
    });

    it('returns null when refreshToken is missing', async () => {
      integrationsService.getActiveConfig.mockResolvedValue({
        clientId: 'cid',
        clientSecret: 'sec',
      });
      const tok = await service.getValidAccessToken('proj', 'production');
      expect(tok).toBeNull();
    });

    it('falls back to active environment when env is omitted', async () => {
      integrationsService.getStoredIntegration.mockResolvedValue({
        enabled: true,
        activeEnvironment: 'sandbox',
      });
      integrationsService.getActiveConfig.mockResolvedValue(baseConfig);

      const tok = await service.getValidAccessToken('proj');
      expect(tok).toBe('current-tok');
      // resolved env should propagate to getActiveConfig
      expect(integrationsService.getActiveConfig).toHaveBeenCalledWith(
        'proj',
        'google-calendar',
        'sandbox',
      );
    });

    it('returns null when integration is not enabled and env omitted', async () => {
      integrationsService.getStoredIntegration.mockResolvedValue({
        enabled: false,
        activeEnvironment: 'production',
      });
      const tok = await service.getValidAccessToken('proj');
      expect(tok).toBeNull();
    });
  });

  describe('exchangeCodeForCredentials', () => {
    it('exchanges code, fetches user email, returns absolute expiry', async () => {
      const calls: string[] = [];
      mockFetch(async (url) => {
        calls.push(url);
        if (url.includes('/token')) {
          return { ok: true, body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } };
        }
        if (url.includes('userinfo')) {
          return { ok: true, body: { email: 'owner@example.com' } };
        }
        return { ok: false, body: {} };
      });

      const result = await service.exchangeCodeForCredentials(
        'cid',
        'sec',
        'auth-code',
        'https://cb.test',
      );
      expect(result.accessToken).toBe('a');
      expect(result.refreshToken).toBe('r');
      expect(result.connectedEmail).toBe('owner@example.com');
      expect(result.tokenExpiry).toBeGreaterThan(Date.now());
    });

    it('falls back to "unknown" email when userinfo fails', async () => {
      mockFetch(async (url) => {
        if (url.includes('/token')) {
          return { ok: true, body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } };
        }
        return { ok: false, status: 500, body: {} };
      });

      const result = await service.exchangeCodeForCredentials('cid', 'sec', 'code', 'https://cb');
      expect(result.connectedEmail).toBe('unknown');
    });
  });
});
