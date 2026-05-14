import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { googleIntegrationCredentials, systemConfig } from '../db/schema';
import { decryptJson, encryptJson } from '../common/crypto/aes-gcm';

/**
 * One-shot startup migration: copy the legacy
 * `system_config.googleOauthConfig` blob into the per-service
 * `google_integration_credentials` table on `service='calendar'`, then NULL
 * the legacy column.
 *
 * Idempotent — safe to run every boot:
 *   1. SELECT system_config rows where googleOauthConfigured=true AND
 *      googleOauthConfig IS NOT NULL.
 *   2. Decrypt with the shared key. If decryption fails, log and skip the
 *      row (admin must re-enter creds — same blast radius as a wrong
 *      ENCRYPTION_KEY today).
 *   3. INSERT into google_integration_credentials with onConflictDoNothing
 *      on the (service) unique index — if a calendar row already exists,
 *      the new table is the source of truth and we leave it alone.
 *   4. NULL the legacy column + flip googleOauthConfigured=false so
 *      subsequent boots are no-ops and so accidental rollback to the old
 *      binary doesn't double-restore from a stale row.
 *
 * The legacy columns themselves stay in the schema for one minor version
 * (dropped in story 0050) so an operator can roll back the binary and
 * still see the system_config row, even if Calendar creds need to be
 * re-entered for the old read path. See story 0048 §Out of scope.
 */
@Injectable()
export class GoogleIntegrationBackfillService implements OnModuleInit {
  private readonly logger = new Logger(GoogleIntegrationBackfillService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.runBackfill();
    } catch (err) {
      // Non-fatal — backend still boots without Calendar working. The admin
      // can re-enter creds via /admin/settings/auth.
      this.logger.error(
        'Google Calendar credential backfill failed; Calendar may be unavailable until re-configured.',
        err as Error,
      );
    }
  }

  /** Exposed for unit tests. */
  async runBackfill(): Promise<BackfillResult> {
    const rows = await db
      .select({
        id: systemConfig.id,
        googleOauthConfig: systemConfig.googleOauthConfig,
      })
      .from(systemConfig)
      .where(
        and(
          eq(systemConfig.googleOauthConfigured, true),
          isNotNull(systemConfig.googleOauthConfig),
        ),
      );

    if (rows.length === 0) {
      return { migrated: 0, skipped: 0, alreadyPresent: 0 };
    }

    let migrated = 0;
    let skipped = 0;
    let alreadyPresent = 0;

    for (const row of rows) {
      if (!row.googleOauthConfig) continue;

      let decrypted: { clientId?: string; clientSecret?: string };
      try {
        decrypted = decryptJson<{ clientId?: string; clientSecret?: string }>(
          row.googleOauthConfig,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to decrypt legacy googleOauthConfig (system_config ${row.id}); skipping. Admin must re-enter Calendar credentials.`,
          (err as Error).message,
        );
        skipped += 1;
        continue;
      }

      if (!decrypted.clientId || !decrypted.clientSecret) {
        this.logger.warn(
          `Legacy googleOauthConfig missing clientId/clientSecret (system_config ${row.id}); skipping.`,
        );
        skipped += 1;
        continue;
      }

      const reEncrypted = encryptJson({
        clientId: decrypted.clientId,
        clientSecret: decrypted.clientSecret,
      });

      // onConflictDoNothing — if a calendar row already exists, the new
      // table is authoritative and we don't clobber it.
      const inserted = await db
        .insert(googleIntegrationCredentials)
        .values({
          service: 'calendar',
          configEncrypted: reEncrypted,
          configured: true,
        })
        .onConflictDoNothing({ target: googleIntegrationCredentials.service })
        .returning({ id: googleIntegrationCredentials.id });

      if (inserted.length > 0) {
        this.logger.log(
          `Backfilled Google Calendar credentials from system_config ${row.id} into google_integration_credentials.`,
        );
        migrated += 1;
      } else {
        alreadyPresent += 1;
      }

      // NULL the legacy column so re-runs are no-ops and a rolled-back
      // binary doesn't restore from stale data. Safe regardless of which
      // path succeeded above — the new table is now the source of truth.
      await db
        .update(systemConfig)
        .set({
          googleOauthConfig: null,
          googleOauthConfigured: false,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, row.id));
    }

    if (migrated || skipped || alreadyPresent) {
      this.logger.log(
        `Google Calendar backfill: migrated=${migrated}, alreadyPresent=${alreadyPresent}, skipped=${skipped}.`,
      );
    }
    return { migrated, skipped, alreadyPresent };
  }
}

export interface BackfillResult {
  migrated: number;
  skipped: number;
  alreadyPresent: number;
}
