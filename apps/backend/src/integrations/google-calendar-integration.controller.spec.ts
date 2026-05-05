import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleCalendarIntegrationController } from './google-calendar-integration.controller';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

function makeController(): {
  controller: GoogleCalendarIntegrationController;
  integrationsService: any;
  oauthService: any;
} {
  const integrationsService = {
    getActiveConfig: jest.fn(),
    setConfig: jest.fn().mockResolvedValue(undefined),
    getStoredIntegration: jest.fn(),
  };
  const oauthService = {
    // Default: workspace creds are configured and the consent URL builds.
    // Tests that need the "not configured" branch override per-test.
    getAuthorizationUrlForProject: jest
      .fn()
      .mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?…'),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?…'),
    exchangeCodeForProject: jest.fn().mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      tokenExpiry: Date.now() + 3600_000,
      connectedEmail: 'owner@example.com',
    }),
    listCalendarsForProject: jest.fn().mockResolvedValue([
      { id: 'primary@x', summary: 'Primary', primary: true, timeZone: 'UTC' },
    ]),
    revokeToken: jest.fn().mockResolvedValue(undefined),
  };
  const configService = {
    get: (key: string) => (key === 'ENCRYPTION_KEY' ? Buffer.alloc(32, 7).toString('base64') : undefined),
  } as unknown as ConfigService;

  const controller = new GoogleCalendarIntegrationController(
    integrationsService as unknown as IntegrationsService,
    oauthService as unknown as GoogleCalendarOAuthService,
    configService,
  );
  return { controller, integrationsService, oauthService };
}

describe('GoogleCalendarIntegrationController', () => {
  describe('initiateOAuth', () => {
    it('rejects when redirectUri is missing', async () => {
      const { controller } = makeController();
      await expect(controller.initiateOAuth('proj-1', '')).rejects.toThrow(BadRequestException);
    });

    it('rejects when workspace OAuth credentials are not configured', async () => {
      const { controller, oauthService } = makeController();
      oauthService.getAuthorizationUrlForProject.mockResolvedValueOnce(null);
      await expect(controller.initiateOAuth('proj-1', 'https://cb')).rejects.toThrow(
        /Workspace Google OAuth credentials/,
      );
    });

    it('returns authUrl from the oauth service', async () => {
      const { controller, oauthService } = makeController();

      const result = await controller.initiateOAuth('proj-1', 'https://cb');

      expect(result.authUrl).toContain('accounts.google.com');
      expect(oauthService.getAuthorizationUrlForProject).toHaveBeenCalledWith(
        'proj-1',
        undefined,
        expect.any(String), // encrypted state
        'https://cb',
      );
      // State should be a 3-segment AES-GCM payload (iv:tag:cipher)
      const stateArg = oauthService.getAuthorizationUrlForProject.mock.calls[0][2];
      expect(stateArg.split(':')).toHaveLength(3);
    });
  });

  describe('completeOAuth', () => {
    it('rejects missing fields', async () => {
      const { controller } = makeController();
      await expect(
        controller.completeOAuth('proj-1', { code: '', state: '', redirectUri: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects tampered state token', async () => {
      const { controller } = makeController();
      await expect(
        controller.completeOAuth('proj-1', {
          code: 'c',
          state: 'not:a:valid:token',
          redirectUri: 'https://cb',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects projectId mismatch', async () => {
      const { controller, oauthService } = makeController();
      // First initiate to get a state token bound to proj-A
      await controller.initiateOAuth('proj-A', 'https://cb');
      const state = oauthService.getAuthorizationUrlForProject.mock.calls[0][2];

      // Then attempt completion as proj-B
      await expect(
        controller.completeOAuth('proj-B', { code: 'c', state, redirectUri: 'https://cb' }),
      ).rejects.toThrow(/state mismatch/);
    });

    it('rejects expired state token', async () => {
      const { controller, oauthService } = makeController();

      // Freeze "now" 11 minutes in the past for state generation
      const realNow = Date.now;
      Date.now = () => realNow() - 11 * 60 * 1000;
      await controller.initiateOAuth('proj-1', 'https://cb');
      Date.now = realNow;

      const state = oauthService.getAuthorizationUrlForProject.mock.calls[0][2];
      await expect(
        controller.completeOAuth('proj-1', { code: 'c', state, redirectUri: 'https://cb' }),
      ).rejects.toThrow(/expired/);
    });

    it('exchanges code and returns connectedEmail on valid state', async () => {
      const { controller, oauthService } = makeController();
      await controller.initiateOAuth('proj-1', 'https://cb');
      const state = oauthService.getAuthorizationUrlForProject.mock.calls[0][2];

      const result = await controller.completeOAuth('proj-1', {
        code: 'auth-code',
        state,
        redirectUri: 'https://cb',
      });

      expect(result).toEqual({ success: true, connectedEmail: 'owner@example.com' });
      expect(oauthService.exchangeCodeForProject).toHaveBeenCalledWith(
        'proj-1',
        undefined, // env auto-resolves
        'auth-code',
        'https://cb',
      );
    });
  });

  describe('disconnectOAuth', () => {
    it('throws when integration is not enabled', async () => {
      const { controller, integrationsService } = makeController();
      integrationsService.getStoredIntegration.mockResolvedValueOnce({ enabled: false });
      await expect(controller.disconnectOAuth('proj-1')).rejects.toThrow(NotFoundException);
    });

    it('revokes refresh token, clears tokens, keeps clientId/clientSecret', async () => {
      const { controller, integrationsService, oauthService } = makeController();
      integrationsService.getStoredIntegration.mockResolvedValueOnce({
        enabled: true,
        activeEnvironment: 'production',
      });
      integrationsService.getActiveConfig.mockResolvedValueOnce({
        clientId: 'cid',
        clientSecret: 'sec',
        accessToken: 'a',
        refreshToken: 'r-token',
        tokenExpiry: 9999999,
        connectedEmail: 'owner@example.com',
      });

      await controller.disconnectOAuth('proj-1');

      expect(oauthService.revokeToken).toHaveBeenCalledWith('r-token');
      expect(integrationsService.setConfig).toHaveBeenCalledWith(
        'proj-1',
        'google-calendar',
        'production',
        expect.objectContaining({
          accessToken: '',
          refreshToken: '',
          tokenExpiry: 0,
          connectedEmail: '',
          availableCalendars: [],
        }),
      );
      // Did NOT pass clientId / clientSecret in the clear payload — setConfig merges
      // and existing creds are preserved
      const cleared = integrationsService.setConfig.mock.calls[0][3];
      expect(cleared.clientId).toBeUndefined();
      expect(cleared.clientSecret).toBeUndefined();
    });

    it('handles disconnect when no refresh token is present (silently)', async () => {
      const { controller, integrationsService, oauthService } = makeController();
      integrationsService.getStoredIntegration.mockResolvedValueOnce({
        enabled: true,
        activeEnvironment: 'production',
      });
      integrationsService.getActiveConfig.mockResolvedValueOnce({
        clientId: 'cid',
        clientSecret: 'sec',
      });

      await controller.disconnectOAuth('proj-1');
      expect(oauthService.revokeToken).not.toHaveBeenCalled();
      expect(integrationsService.setConfig).toHaveBeenCalled();
    });
  });

  describe('listCalendars', () => {
    it('delegates to listCalendarsForProject and returns wrapped response', async () => {
      const { controller, oauthService } = makeController();

      const result = await controller.listCalendars('proj-1');

      expect(oauthService.listCalendarsForProject).toHaveBeenCalledWith('proj-1');
      expect(result.calendars).toHaveLength(1);
      expect(result.calendars[0]).toEqual({
        id: 'primary@x',
        summary: 'Primary',
        primary: true,
        timeZone: 'UTC',
      });
    });
  });
});
