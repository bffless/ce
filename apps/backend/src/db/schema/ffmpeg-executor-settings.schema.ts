import { pgTable, uuid, boolean, varchar, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Instance-level configuration of the ffmpeg executors (Local server / Remote
 * Worker) edited in Admin Settings → Features → Server video ops → Executor.
 * Exactly one row (the service upserts; there is no natural key beyond "the
 * instance"). Env vars override individual fields — FFMPEG_EXECUTOR,
 * FFMPEG_REMOTE_URL, FFMPEG_REMOTE_AUTH, FFMPEG_REMOTE_SA_KEY_JSON — see
 * `pipelines/ffmpeg/ffmpeg-executor-settings.service.ts` (`resolved()`).
 *
 * The service-account key is AES-256-GCM encrypted with common/crypto/aes-gcm.ts
 * (same wire format as oidc_providers.config_encrypted) and is WRITE-ONLY: the
 * API reports only whether one is stored.
 *
 * Spec: docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §1.5.
 */
export const ffmpegExecutorSettings = pgTable('ffmpeg_executor_settings', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Local executor: ffmpeg spawned by this backend. Only meaningful when the
  // binaries are present; off lets an admin force Remote on a box that has ffmpeg.
  localEnabled: boolean('local_enabled').default(true).notNull(),

  // Remote executor: a Worker CE calls over HTTPS (Cloud Run is the reference).
  remoteEnabled: boolean('remote_enabled').default(false).notNull(),
  remoteUrl: text('remote_url'),
  // 'google_id_token' | 'none'
  remoteAuth: varchar('remote_auth', { length: 32 }).default('google_id_token').notNull(),
  // encryptString(<service-account JSON>) or null (= use ADC / no key)
  saKeyEncrypted: text('sa_key_encrypted'),

  // 'local' | 'remote' — which executor a step runs on unless it names one.
  defaultExecutor: varchar('default_executor', { length: 16 }).default('local').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedByUserId: uuid('updated_by_user_id'),
});

export type FfmpegExecutorSettingsRow = typeof ffmpegExecutorSettings.$inferSelect;
export type NewFfmpegExecutorSettingsRow = typeof ffmpegExecutorSettings.$inferInsert;
