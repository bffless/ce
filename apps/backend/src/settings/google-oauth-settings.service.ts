import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { db } from '../db/client';
import { systemConfig } from '../db/schema';

/**
 * Workspace-level Google OAuth credentials for **integrations** —
 * Calendar today, future Drive / Sheets / Gmail. Stored encrypted in
 * system_config (mirrors the email-settings pattern), edited via
 * /admin/settings/auth.
 *
 * Distinct from SIGN-IN credentials, which keep using env vars
 * (GOOGLE_OAUTH_CLIENT_ID / _SECRET, registered via
 * registerGoogleOAuthFromEnv() in auth/supertokens.config.ts). Sign-in
 * uses one shared Cloud client across all workspaces; integration creds
 * are workspace-distinct so each workspace can verify its own scopes
 * independently.
 *
 * Replaces the per-project clientId/clientSecret blob the calendar
 * integration used to maintain. Per-project storage keeps only the
 * refresh token + connected-account metadata.
 */
@Injectable()
export class GoogleOAuthSettingsService {
  private readonly logger = new Logger(GoogleOAuthSettingsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn(
        'No ENCRYPTION_KEY found. Generated temporary key — credentials will be unrecoverable across restarts.',
      );
    }
  }

  /**
   * Public status — never returns the secret. clientId is masked.
   * Used by `/admin/settings/auth` to render the credentials card.
   */
  async getStatus(): Promise<GoogleOAuthStatus> {
    const config = await this.getRow();
    if (!config?.googleOauthConfigured || !config?.googleOauthConfig) {
      return { isConfigured: false };
    }
    const decoded = this.decryptCreds(config.googleOauthConfig);
    if (!decoded) return { isConfigured: false };
    return {
      isConfigured: true,
      clientIdMasked: this.maskClientId(decoded.clientId),
      hasSecret: !!decoded.clientSecret,
    };
  }

  /**
   * Returns the full plaintext credentials. Internal use only — callers
   * are SuperTokens registration + the calendar OAuth handler.
   */
  async getCredentials(): Promise<GoogleOAuthCredentials | null> {
    const config = await this.getRow();
    if (!config?.googleOauthConfigured || !config?.googleOauthConfig) return null;
    return this.decryptCreds(config.googleOauthConfig);
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.getRow();
    return !!config?.googleOauthConfigured;
  }

  async update(input: { clientId: string; clientSecret: string }): Promise<void> {
    const clientId = (input.clientId ?? '').trim();
    const clientSecret = (input.clientSecret ?? '').trim();
    if (!clientId || !clientSecret) {
      throw new BadRequestException('clientId and clientSecret are required.');
    }
    const encrypted = this.encryptData(JSON.stringify({ clientId, clientSecret }));
    await this.upsert({ googleOauthConfig: encrypted, googleOauthConfigured: true });
  }

  async clear(): Promise<void> {
    await this.upsert({ googleOauthConfig: null, googleOauthConfigured: false });
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private async getRow() {
    const rows = await db.select().from(systemConfig).limit(1);
    return rows.length > 0 ? rows[0] : null;
  }

  private async upsert(patch: Partial<typeof systemConfig.$inferInsert>): Promise<void> {
    try {
      const existing = await this.getRow();
      if (existing) {
        await db
          .update(systemConfig)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(systemConfig.id, existing.id));
      } else {
        // First-run case — settings.controller / setup wizard normally seeds
        // this row; defensive fallback so the wizard isn't a hard prereq.
        await db.insert(systemConfig).values({
          isSetupComplete: false,
          allowPublicSignups: false,
          ...patch,
        });
      }
    } catch (err) {
      this.logger.error('Failed to persist Google OAuth credentials', err as Error);
      throw new InternalServerErrorException('Failed to persist Google OAuth credentials.');
    }
  }

  private decryptCreds(encrypted: string): GoogleOAuthCredentials | null {
    try {
      const json = this.decryptData(encrypted);
      const parsed = JSON.parse(json) as Partial<GoogleOAuthCredentials>;
      if (!parsed.clientId || !parsed.clientSecret) return null;
      return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
    } catch (err) {
      this.logger.error('Failed to decrypt Google OAuth credentials', err as Error);
      return null;
    }
  }

  private maskClientId(clientId: string): string {
    if (clientId.length <= 8) return '****';
    return clientId.substring(0, 6) + '...' + clientId.substring(clientId.length - 4);
  }

  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptData(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export interface GoogleOAuthStatus {
  isConfigured: boolean;
  clientIdMasked?: string;
  hasSecret?: boolean;
}

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}
