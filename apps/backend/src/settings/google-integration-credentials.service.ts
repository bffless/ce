import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  googleIntegrationCredentials,
  type GoogleIntegrationConfig,
  type GoogleService,
} from '../db/schema';
import { decryptJson, encryptJson } from '../common/crypto/aes-gcm';

/**
 * Workspace-level Google OAuth client credentials for **integrations** —
 * Calendar today, future Drive / Sheets / Gmail. One row per service in
 * `google_integration_credentials`, edited via /admin/settings/auth.
 *
 * Distinct from SIGN-IN credentials, which live in `oidc_providers`
 * (story 0047). Sign-in uses one shared Cloud client across all workspaces;
 * integration creds are workspace-distinct and can vary per service so each
 * Google API surface can have its own Cloud project.
 *
 * Project owners connect their own calendars using the workspace admin's
 * OAuth client — per-project refresh tokens live in
 * `projects.settings.integrations['google-calendar'][env]` and are managed
 * by `IntegrationsService`, not this service. This service only owns the
 * client credentials themselves.
 *
 * Replaces `GoogleOAuthSettingsService` (which read from the legacy
 * `system_config.googleOauthConfig` column dropped in story 0050).
 */
@Injectable()
export class GoogleIntegrationCredentialsService {
  private readonly logger = new Logger(GoogleIntegrationCredentialsService.name);

  /**
   * Public status — never returns the secret. clientId is masked.
   * Used by /admin/settings/auth to render the credentials card and by the
   * per-project Connect dialog to decide whether to show "Configure" or
   * "Connect" CTAs.
   */
  async getStatus(service: GoogleService): Promise<GoogleIntegrationStatus> {
    const row = await this.findRow(service);
    if (!row?.configured) return { service, isConfigured: false };
    const decoded = this.decryptRow(row.configEncrypted, service);
    if (!decoded) return { service, isConfigured: false };
    return {
      service,
      isConfigured: true,
      clientIdMasked: this.maskClientId(decoded.clientId),
      hasSecret: !!decoded.clientSecret,
    };
  }

  /**
   * List status for every known Google service. Missing rows render as
   * `{ isConfigured: false }`. Used by `GET /api/settings/google-integrations`.
   *
   * Today only `calendar` has a backend consumer — the controller filters
   * the visible service set down to those that ship handlers, so this
   * method's full output stays internal until more services land.
   */
  async listStatuses(services: readonly GoogleService[]): Promise<GoogleIntegrationStatus[]> {
    return Promise.all(services.map((s) => this.getStatus(s)));
  }

  /**
   * Returns the full plaintext credentials (clientId + clientSecret + optional
   * scopes override). Internal use only — callers are the
   * `GoogleCalendarOAuthService` (and future Drive/Sheets/Gmail equivalents).
   */
  async getCredentials(service: GoogleService): Promise<GoogleIntegrationConfig | null> {
    const row = await this.findRow(service);
    if (!row?.configured) return null;
    return this.decryptRow(row.configEncrypted, service);
  }

  async isConfigured(service: GoogleService): Promise<boolean> {
    const row = await this.findRow(service);
    return !!row?.configured;
  }

  /**
   * Insert-or-replace credentials for a service. Always provide both
   * clientId and clientSecret — partial updates of a credential pair are
   * a footgun (you can't rotate the secret without also re-sending the
   * id; trying to keeps stale halves in the DB).
   */
  async update(
    service: GoogleService,
    input: { clientId: string; clientSecret: string; scopes?: string[] },
    createdByUserId?: string,
  ): Promise<void> {
    const clientId = (input.clientId ?? '').trim();
    const clientSecret = (input.clientSecret ?? '').trim();
    if (!clientId || !clientSecret) {
      throw new BadRequestException('clientId and clientSecret are required.');
    }
    const scopes = this.normaliseScopes(input.scopes);
    const config: GoogleIntegrationConfig = scopes
      ? { clientId, clientSecret, scopes }
      : { clientId, clientSecret };
    const configEncrypted = encryptJson(config);

    try {
      const existing = await this.findRow(service);
      if (existing) {
        await db
          .update(googleIntegrationCredentials)
          .set({ configEncrypted, configured: true, updatedAt: new Date() })
          .where(eq(googleIntegrationCredentials.id, existing.id));
      } else {
        await db.insert(googleIntegrationCredentials).values({
          service,
          configEncrypted,
          configured: true,
          createdByUserId: createdByUserId ?? null,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to persist Google ${service} integration credentials`,
        err as Error,
      );
      throw new InternalServerErrorException(
        `Failed to persist Google ${service} integration credentials.`,
      );
    }
  }

  /**
   * Clear credentials for a service. Removes the row entirely — `configured`
   * isn't flipped to false because a stale encrypted blob hanging around is
   * worse than a missing row (the unique index makes re-insert trivial).
   */
  async clear(service: GoogleService): Promise<void> {
    const existing = await this.findRow(service);
    if (!existing) throw new NotFoundException(`Google ${service} credentials are not configured.`);
    await db
      .delete(googleIntegrationCredentials)
      .where(eq(googleIntegrationCredentials.id, existing.id));
  }

  // ─── internal ─────────────────────────────────────────────────────────────

  private async findRow(service: GoogleService) {
    const rows = await db
      .select()
      .from(googleIntegrationCredentials)
      .where(eq(googleIntegrationCredentials.service, service))
      .limit(1);
    return rows[0] ?? null;
  }

  private decryptRow(encrypted: string, service: GoogleService): GoogleIntegrationConfig | null {
    try {
      const parsed = decryptJson<Partial<GoogleIntegrationConfig>>(encrypted);
      if (!parsed.clientId || !parsed.clientSecret) return null;
      return {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        ...(parsed.scopes && parsed.scopes.length ? { scopes: parsed.scopes } : {}),
      };
    } catch (err) {
      this.logger.error(`Failed to decrypt Google ${service} credentials`, err as Error);
      return null;
    }
  }

  private normaliseScopes(scopes: string[] | undefined): string[] | undefined {
    if (!scopes) return undefined;
    const cleaned = scopes.map((s) => s.trim()).filter((s) => s.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  private maskClientId(clientId: string): string {
    if (clientId.length <= 8) return '****';
    return clientId.substring(0, 6) + '...' + clientId.substring(clientId.length - 4);
  }
}

export interface GoogleIntegrationStatus {
  service: GoogleService;
  isConfigured: boolean;
  clientIdMasked?: string;
  hasSecret?: boolean;
}
