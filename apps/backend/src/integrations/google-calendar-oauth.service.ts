import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarIntegrationKeys } from './google-calendar.interface';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Token-refresh response surface. `tokenExpiry` is unix ms.
 */
export interface RefreshedTokens {
  accessToken: string;
  tokenExpiry: number;
}

/**
 * OAuth-exchange response surface (refresh token included).
 */
export interface ExchangedTokens extends RefreshedTokens {
  refreshToken: string;
  connectedEmail: string;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone: string;
}

/**
 * Shared Google Calendar OAuth service.
 *
 * Two flavors of helper:
 *   - `*ForCredentials(clientId, clientSecret, …)` — pure HTTP. Used by callers
 *     that already have decrypted credentials in hand (e.g. the AI-plugin
 *     `GoogleOAuthService` that stores creds in its own `settings.aiPlugins`
 *     namespace).
 *   - `*ForProject(projectId, env, …)` — fetches creds from
 *     `IntegrationsService` (the `'google-calendar'` integration) and calls the
 *     `ForCredentials` variant. Used by Phase B's `google_calendar` step
 *     handler and the scheduling pipelines.
 *
 * Token storage: only the `*ForProject` variants persist refreshed tokens back
 * via `IntegrationsService.setConfig`. The AI-plugin path does its own
 * persistence.
 */
@Injectable()
export class GoogleCalendarOAuthService {
  private readonly logger = new Logger(GoogleCalendarOAuthService.name);
  static readonly SCOPES = SCOPES;

  constructor(
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrationsService: IntegrationsService,
  ) {}

  // ===== ForCredentials (pure HTTP) =====

  /**
   * Build the consent URL given an explicit clientId. The caller is responsible
   * for opaque `state` (encryption / signing / replay protection).
   */
  buildAuthorizationUrl(clientId: string, state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /** Exchange an auth code for tokens using the supplied credentials. */
  async exchangeCodeForCredentials(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<ExchangedTokens> {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json().catch(() => ({}));
      this.logger.error(`Token exchange failed: ${JSON.stringify(error)}`);
      throw new Error(error.error_description || `Token exchange failed (HTTP ${tokenResponse.status})`);
    }

    const tokens = await tokenResponse.json();

    // Best-effort fetch of the user's email for owner display
    let connectedEmail = 'unknown';
    try {
      const userInfo = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfo.ok) {
        const data = await userInfo.json();
        connectedEmail = data.email || 'unknown';
      }
    } catch (err: any) {
      this.logger.warn(`Failed to fetch userinfo after token exchange: ${err.message}`);
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: Date.now() + tokens.expires_in * 1000,
      connectedEmail,
    };
  }

  /** Refresh an access token using the supplied credentials. */
  async refreshAccessTokenForCredentials(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<RefreshedTokens> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error_description || `Refresh failed (HTTP ${response.status})`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      tokenExpiry: Date.now() + data.expires_in * 1000,
    };
  }

  /** GET calendarList. Used at OAuth callback and the admin "list_calendars" pipeline. */
  async listCalendarsForToken(accessToken: string): Promise<CalendarSummary[]> {
    const response = await fetch(GOOGLE_CALENDAR_LIST_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `calendarList failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary || item.id,
      primary: item.primary || false,
      timeZone: item.timeZone || 'UTC',
    }));
  }

  /** Best-effort revoke. */
  async revokeToken(refreshToken: string): Promise<void> {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (err: any) {
      this.logger.warn(`Token revocation failed: ${err.message}`);
    }
  }

  // ===== ForProject (IntegrationsService-backed) =====

  /**
   * Build the consent URL using the project's stored clientId.
   * Returns null if the integration isn't configured.
   */
  async getAuthorizationUrlForProject(
    projectId: string,
    env: 'sandbox' | 'production',
    state: string,
    redirectUri: string,
  ): Promise<string | null> {
    const config = await this.getProjectConfig(projectId, env);
    if (!config?.clientId) return null;
    return this.buildAuthorizationUrl(config.clientId, state, redirectUri);
  }

  /**
   * Exchange auth code for tokens using the project's stored credentials and
   * persist tokens + connectedEmail back into the integration config.
   */
  async exchangeCodeForProject(
    projectId: string,
    env: 'sandbox' | 'production',
    code: string,
    redirectUri: string,
  ): Promise<ExchangedTokens> {
    const config = await this.getProjectConfig(projectId, env);
    if (!config?.clientId || !config?.clientSecret) {
      throw new Error('Google Calendar integration not configured');
    }
    const tokens = await this.exchangeCodeForCredentials(
      config.clientId,
      config.clientSecret,
      code,
      redirectUri,
    );

    // Persist tokens + email. Refresh availableCalendars snapshot too.
    let availableCalendars: CalendarSummary[] | undefined;
    try {
      availableCalendars = await this.listCalendarsForToken(tokens.accessToken);
    } catch (err: any) {
      this.logger.warn(`Could not fetch calendarList after exchange: ${err.message}`);
    }

    await this.integrationsService.setConfig(projectId, 'google-calendar', env, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      connectedEmail: tokens.connectedEmail,
      ...(availableCalendars ? { availableCalendars } : {}),
    });

    return tokens;
  }

  /**
   * Get a valid access token for a project, refreshing if within 60s of expiry.
   * Persists the refreshed token back to the integration config.
   * Returns null if the integration isn't configured or refresh fails.
   */
  async getValidAccessToken(
    projectId: string,
    env: 'sandbox' | 'production',
  ): Promise<string | null> {
    const config = await this.getProjectConfig(projectId, env);
    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
      return null;
    }

    const expiry = config.tokenExpiry ?? 0;
    if (config.accessToken && expiry > Date.now() + 60_000) {
      return config.accessToken;
    }

    try {
      const refreshed = await this.refreshAccessTokenForCredentials(
        config.clientId,
        config.clientSecret,
        config.refreshToken,
      );
      await this.integrationsService.setConfig(projectId, 'google-calendar', env, {
        accessToken: refreshed.accessToken,
        tokenExpiry: refreshed.tokenExpiry,
      });
      return refreshed.accessToken;
    } catch (err: any) {
      this.logger.warn(`Token refresh failed for project ${projectId}: ${err.message}`);
      return null;
    }
  }

  /**
   * List calendars for the connected project account.
   * Refreshes the token if needed and updates `availableCalendars`.
   */
  async listCalendarsForProject(
    projectId: string,
    env: 'sandbox' | 'production',
  ): Promise<CalendarSummary[]> {
    const accessToken = await this.getValidAccessToken(projectId, env);
    if (!accessToken) {
      throw new Error('Google Calendar not connected');
    }
    const calendars = await this.listCalendarsForToken(accessToken);
    await this.integrationsService.setConfig(projectId, 'google-calendar', env, {
      availableCalendars: calendars,
    });
    return calendars;
  }

  // ===== Internal =====

  private async getProjectConfig(
    projectId: string,
    env: 'sandbox' | 'production',
  ): Promise<GoogleCalendarIntegrationKeys | null> {
    const config = await this.integrationsService.getActiveConfig(
      projectId,
      'google-calendar',
      env,
    );
    return (config as GoogleCalendarIntegrationKeys | null) ?? null;
  }
}
