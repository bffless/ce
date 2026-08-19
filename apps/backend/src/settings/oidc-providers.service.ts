import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client';
import {
  oidcProviders,
  type OidcProvider,
  type OidcProviderConfig,
  type OidcProviderKind,
} from '../db/schema';
import { decryptJson, encryptJson } from '../common/crypto/aes-gcm';

/**
 * CRUD + encryption for `oidc_providers` rows. Source of truth for which
 * SuperTokens ThirdParty providers are registered against the workspace's
 * 'public' tenant.
 *
 * Encryption uses the shared AES-256-GCM helper in `common/crypto/aes-gcm.ts`
 * (same wire format `iv:authTag:ciphertext`, same `ENCRYPTION_KEY` env var as
 * every other encrypted credential row).
 *
 * The `sync` step against SuperTokens lives in `auth/supertokens.config.ts`
 * (`syncOidcProviders`), not here, to avoid a circular module import — that
 * function reads directly from `db` without going through this service.
 */
@Injectable()
export class OidcProvidersService {
  private readonly logger = new Logger(OidcProvidersService.name);

  // ─── reads ────────────────────────────────────────────────────────────────

  /** All rows, including disabled. Used by admin UI. */
  async listAll(): Promise<OidcProviderStatus[]> {
    const rows = await db.select().from(oidcProviders).orderBy(asc(oidcProviders.createdAt));
    return rows.map((r) => this.toStatus(r));
  }

  /**
   * Enabled rows only, ordered by creation. Used by `/oauth/providers` and
   * `syncOidcProviders` at startup. Returns the safe public shape — no creds.
   */
  async listEnabled(): Promise<EnabledOidcProvider[]> {
    const rows = await db
      .select()
      .from(oidcProviders)
      .where(eq(oidcProviders.enabled, true))
      .orderBy(asc(oidcProviders.createdAt));
    return rows.map((r) => ({
      id: r.providerId,
      kind: r.kind as OidcProviderKind,
      displayName: r.displayName,
    }));
  }

  /** Single row by `providerId` slug. Used by callback endpoint. */
  async findByProviderId(providerId: string): Promise<OidcProvider | null> {
    const rows = await db
      .select()
      .from(oidcProviders)
      .where(eq(oidcProviders.providerId, providerId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<OidcProvider | null> {
    const rows = await db.select().from(oidcProviders).where(eq(oidcProviders.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async getStatus(id: string): Promise<OidcProviderStatus> {
    const row = await this.findById(id);
    if (!row) throw new NotFoundException(`OIDC provider ${id} not found`);
    return this.toStatus(row);
  }

  /** Decrypt creds for a row. Internal-use only — never returned over HTTP. */
  decryptConfig(row: OidcProvider): OidcProviderConfig | null {
    try {
      const parsed = decryptJson<Partial<OidcProviderConfig>>(row.configEncrypted);
      if (!parsed.clientId || !parsed.clientSecret) return null;
      return {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        oidcDiscoveryEndpoint: parsed.oidcDiscoveryEndpoint,
        oktaDomain: parsed.oktaDomain,
        directoryId: parsed.directoryId,
        scope: parsed.scope,
      };
    } catch (err) {
      this.logger.error(`Failed to decrypt OIDC provider ${row.providerId}`, err as Error);
      return null;
    }
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  async create(input: CreateOidcProviderInput): Promise<OidcProviderStatus> {
    this.validateInput(input.kind, input.config);
    this.validateProviderIdSlug(input.providerId);

    const existing = await this.findByProviderId(input.providerId);
    if (existing) {
      throw new ConflictException(
        `An SSO provider with id '${input.providerId}' already exists. Pick a different slug.`,
      );
    }

    const encrypted = encryptJson(input.config);
    try {
      const [row] = await db
        .insert(oidcProviders)
        .values({
          providerId: input.providerId,
          displayName: input.displayName,
          kind: input.kind,
          configEncrypted: encrypted,
          enabled: input.enabled ?? false,
          source: input.source ?? 'admin',
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      return this.toStatus(row);
    } catch (err) {
      this.logger.error('Failed to insert OIDC provider', err as Error);
      throw new InternalServerErrorException('Failed to save SSO provider.');
    }
  }

  async update(id: string, input: UpdateOidcProviderInput): Promise<OidcProviderStatus> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException(`OIDC provider ${id} not found`);

    // Merge config: undefined fields keep their current decrypted value, so
    // the admin UI can PATCH without re-sending clientSecret.
    let configEncrypted = existing.configEncrypted;
    if (input.config) {
      const current = this.decryptConfig(existing);
      if (!current) {
        throw new InternalServerErrorException(
          'Cannot update — existing credentials failed to decrypt. Delete and recreate the provider.',
        );
      }
      const merged: OidcProviderConfig = {
        clientId: input.config.clientId ?? current.clientId,
        clientSecret: input.config.clientSecret ?? current.clientSecret,
        oidcDiscoveryEndpoint: input.config.oidcDiscoveryEndpoint ?? current.oidcDiscoveryEndpoint,
        oktaDomain: input.config.oktaDomain ?? current.oktaDomain,
        directoryId: input.config.directoryId ?? current.directoryId,
        scope: input.config.scope ?? current.scope,
      };
      this.validateInput(existing.kind as OidcProviderKind, merged);
      configEncrypted = encryptJson(merged);
    }

    const [row] = await db
      .update(oidcProviders)
      .set({
        displayName: input.displayName ?? existing.displayName,
        enabled: input.enabled ?? existing.enabled,
        configEncrypted,
        updatedAt: new Date(),
      })
      .where(eq(oidcProviders.id, id))
      .returning();
    return this.toStatus(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException(`OIDC provider ${id} not found`);
    if (existing.source === 'env') {
      throw new ConflictException(
        `Cannot delete '${existing.providerId}' — it was provisioned from environment variables. Unset GOOGLE_OAUTH_CLIENT_ID/_SECRET (or the equivalent) and restart the backend instead.`,
      );
    }
    await db.delete(oidcProviders).where(eq(oidcProviders.id, id));
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private toStatus(row: OidcProvider): OidcProviderStatus {
    const cfg = this.decryptConfig(row);
    return {
      id: row.id,
      providerId: row.providerId,
      displayName: row.displayName,
      kind: row.kind as OidcProviderKind,
      enabled: row.enabled,
      source: row.source as 'admin' | 'env',
      clientIdMasked: cfg ? this.maskClientId(cfg.clientId) : null,
      hasSecret: !!cfg?.clientSecret,
      oktaDomain: cfg?.oktaDomain ?? null,
      directoryId: cfg?.directoryId ?? null,
      oidcDiscoveryEndpoint: cfg?.oidcDiscoveryEndpoint ?? null,
      scope: cfg?.scope ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private validateProviderIdSlug(slug: string): void {
    if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
      throw new BadRequestException(
        'providerId must be a URL-safe slug (lowercase letters, numbers, hyphens; 1-64 chars).',
      );
    }
  }

  private validateInput(kind: OidcProviderKind, config: Partial<OidcProviderConfig>): void {
    if (!config.clientId?.trim() || !config.clientSecret?.trim()) {
      throw new BadRequestException('clientId and clientSecret are required.');
    }
    if (kind === 'oidc') {
      if (!config.oidcDiscoveryEndpoint?.trim()) {
        throw new BadRequestException(
          "Generic OIDC providers require an oidcDiscoveryEndpoint (the IdP's issuer URL).",
        );
      }
      // SuperTokens unconditionally appends `/.well-known/openid-configuration`
      // to whatever we pass as oidcDiscoveryEndpoint. Users naturally paste
      // the full discovery URL from IdP docs (e.g. ".../.well-known/openid-configuration"),
      // which double-appends and 404s. Normalise: strip the suffix and any
      // trailing slash so either form works. The stored value is always the
      // issuer URL — what SuperTokens actually wants.
      config.oidcDiscoveryEndpoint = config.oidcDiscoveryEndpoint
        .trim()
        .replace(/\/+\.well-known\/openid-configuration\/*$/, '')
        .replace(/\/+$/, '');
    }
    if (kind === 'okta' && !config.oktaDomain?.trim()) {
      throw new BadRequestException('Okta providers require oktaDomain (e.g. dev-xxxx.okta.com).');
    }
    if (kind === 'azure-ad' && !config.directoryId?.trim()) {
      throw new BadRequestException(
        'Azure AD providers require directoryId (the tenant / directory ID).',
      );
    }
  }

  private maskClientId(clientId: string): string {
    if (clientId.length <= 8) return '****';
    return clientId.substring(0, 6) + '...' + clientId.substring(clientId.length - 4);
  }
}

// ─── DTOs / public response shapes ──────────────────────────────────────────

export interface CreateOidcProviderInput {
  providerId: string;
  displayName: string;
  kind: OidcProviderKind;
  config: OidcProviderConfig;
  enabled?: boolean;
  source?: 'admin' | 'env';
  createdByUserId?: string;
}

export interface UpdateOidcProviderInput {
  displayName?: string;
  enabled?: boolean;
  config?: Partial<OidcProviderConfig>;
}

export interface OidcProviderStatus {
  id: string;
  providerId: string;
  displayName: string;
  kind: OidcProviderKind;
  enabled: boolean;
  source: 'admin' | 'env';
  clientIdMasked: string | null;
  hasSecret: boolean;
  oktaDomain: string | null;
  directoryId: string | null;
  oidcDiscoveryEndpoint: string | null;
  scope: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnabledOidcProvider {
  id: string;
  kind: OidcProviderKind;
  displayName: string;
}
