/**
 * Decrypted Google Calendar integration config stored per-project in
 * `settings.integrations['google-calendar']`.
 *
 * Each project registers its own Google OAuth client (clientId + clientSecret)
 * for tenant isolation. The site owner then completes the consent flow which
 * populates the token fields and the `availableCalendars` snapshot.
 *
 * NEVER expose `clientSecret`, `accessToken`, or `refreshToken` through
 * `IntegrationsService.getPublicConfig` — see `PUBLIC_CONFIG_FIELDS`.
 */
export interface GoogleCalendarIntegrationKeys {
  /** Per-project Google OAuth Client ID (e.g. `xxxxx.apps.googleusercontent.com`). */
  clientId: string;
  /** Per-project Google OAuth Client Secret. */
  clientSecret: string;
  /** Current OAuth access token (short-lived). Empty until OAuth flow completes. */
  accessToken?: string;
  /** Long-lived refresh token issued by Google. Empty until OAuth flow completes. */
  refreshToken?: string;
  /** Unix ms; `getValidAccessToken` refreshes when within 60s. */
  tokenExpiry?: number;
  /** Email address of the Google account that authorized — for owner display. */
  connectedEmail?: string;
  /** Snapshot of sub-calendars on the connected account. Refreshed at OAuth callback. */
  availableCalendars?: Array<{
    id: string;
    summary: string;
    primary?: boolean;
    timeZone: string;
  }>;
}
