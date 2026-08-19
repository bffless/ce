import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { projectSecrets } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import * as crypto from 'crypto';

/**
 * Secret name rule (GitHub-style): uppercase letters, digits, underscores;
 * may not start with a digit. Referenced in pipelines as `secrets.<NAME>`.
 */
const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const MAX_SECRET_NAME_LENGTH = 100;
const MAX_SECRET_VALUE_LENGTH = 8192;

/**
 * Metadata for a single secret (never includes the value).
 */
export interface SecretSummary {
  name: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretsListResponse {
  secrets: SecretSummary[];
}

/**
 * Manages per-project secrets: named, encrypted values that pipelines reference
 * as `secrets.<NAME>`.
 *
 * Mirrors the AES-256-GCM encryption scheme used by ProjectAISettingsService so
 * the same ENCRYPTION_KEY protects all sensitive project data. Values are
 * write-only from the API's perspective — once stored, only names + metadata are
 * ever returned. Decryption happens solely for runtime use via
 * {@link getDecryptedSecrets}.
 */
@Injectable()
export class ProjectSecretsService {
  private readonly logger = new Logger(ProjectSecretsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(private configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn('No ENCRYPTION_KEY found. Generated temporary key.');
    }
  }

  /**
   * List secret names + metadata for a project. NEVER returns values.
   */
  async listSecrets(projectId: string): Promise<SecretsListResponse> {
    const rows = await db
      .select({
        name: projectSecrets.name,
        createdBy: projectSecrets.createdBy,
        createdAt: projectSecrets.createdAt,
        updatedAt: projectSecrets.updatedAt,
      })
      .from(projectSecrets)
      .where(eq(projectSecrets.projectId, projectId))
      .orderBy(projectSecrets.name);

    return {
      secrets: rows.map((r) => ({
        name: r.name,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Create or rotate a secret. Overwrites the value if the name already exists.
   * Returns the updated list (names + metadata only).
   */
  async setSecret(
    projectId: string,
    name: string,
    value: string,
    createdBy?: string,
  ): Promise<SecretsListResponse> {
    const normalizedName = (name ?? '').trim();
    if (!normalizedName || normalizedName.length > MAX_SECRET_NAME_LENGTH) {
      throw new BadRequestException(
        `Secret name is required and must be at most ${MAX_SECRET_NAME_LENGTH} characters`,
      );
    }
    if (!SECRET_NAME_PATTERN.test(normalizedName)) {
      throw new BadRequestException(
        'Secret name must contain only uppercase letters, digits and underscores, and may not start with a digit (e.g. HF_TOKEN)',
      );
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException('Secret value is required');
    }
    if (value.length > MAX_SECRET_VALUE_LENGTH) {
      throw new BadRequestException(
        `Secret value must be at most ${MAX_SECRET_VALUE_LENGTH} characters`,
      );
    }

    const encryptedValue = this.encryptData(value);
    const now = new Date();

    await db
      .insert(projectSecrets)
      .values({ projectId, name: normalizedName, encryptedValue, createdBy: createdBy ?? null })
      .onConflictDoUpdate({
        target: [projectSecrets.projectId, projectSecrets.name],
        set: { encryptedValue, updatedAt: now },
      });

    return this.listSecrets(projectId);
  }

  /**
   * Delete a secret by name. Throws if it does not exist.
   */
  async deleteSecret(projectId: string, name: string): Promise<SecretsListResponse> {
    const deleted = await db
      .delete(projectSecrets)
      .where(and(eq(projectSecrets.projectId, projectId), eq(projectSecrets.name, name)))
      .returning({ id: projectSecrets.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    return this.listSecrets(projectId);
  }

  /**
   * Decrypt all secrets for a project into a { name: value } map for runtime use.
   * Only ever called inside pipeline execution — never exposed via the API.
   */
  async getDecryptedSecrets(projectId: string): Promise<Record<string, string>> {
    const rows = await db
      .select({ name: projectSecrets.name, encryptedValue: projectSecrets.encryptedValue })
      .from(projectSecrets)
      .where(eq(projectSecrets.projectId, projectId));

    const result: Record<string, string> = {};
    for (const row of rows) {
      try {
        result[row.name] = this.decryptData(row.encryptedValue);
      } catch (error) {
        // A single corrupt/undecryptable secret should not break the whole run;
        // skip it and log. The referencing expression resolves to null.
        this.logger.error(`Failed to decrypt secret '${row.name}' for project ${projectId}`, error);
      }
    }
    return result;
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
