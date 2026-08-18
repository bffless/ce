import { pgTable, uuid, boolean, varchar, text, timestamp } from 'drizzle-orm/pg-core';

import { remoteConnections } from './remote-connections.schema';

/**
 * Instance-level configuration of the ffmpeg executors (Local server / Remote
 * Worker) edited in Admin Settings → Features → Server video ops → Executor.
 * Exactly one row (the service upserts; there is no natural key beyond "the
 * instance"). The Remote executor's connection (URL, auth, credential) lives
 * in `remote_connections` (Plan 4); this row only points at it via
 * `remote_connection_id`. Env `FFMPEG_REMOTE_CONNECTION` (or legacy
 * `FFMPEG_REMOTE_URL`, which implies the connection named `ffmpeg`) and
 * `FFMPEG_EXECUTOR` override the row — see
 * `pipelines/ffmpeg/ffmpeg-executor-settings.service.ts` (`resolved()`).
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
  /** @deprecated Plan 4 moved this to remote_connections (backfilled by migration 0044); dropped in the next release. Not read by code. */
  remoteUrl: text('remote_url'),
  /** @deprecated Plan 4 moved this to remote_connections (backfilled by migration 0044); dropped in the next release. Not read by code. */
  remoteAuth: varchar('remote_auth', { length: 32 }).default('google_id_token').notNull(),
  /** @deprecated Plan 4 moved this to remote_connections (backfilled by migration 0044); dropped in the next release. Not read by code. */
  saKeyEncrypted: text('sa_key_encrypted'),

  // Which remote connection the Remote executor uses (Plan 4). Env
  // FFMPEG_REMOTE_CONNECTION / legacy FFMPEG_REMOTE_URL win over this.
  remoteConnectionId: uuid('remote_connection_id').references(() => remoteConnections.id, {
    onDelete: 'set null',
  }),

  // 'local' | 'remote' — which executor a step runs on unless it names one.
  defaultExecutor: varchar('default_executor', { length: 16 }).default('local').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedByUserId: uuid('updated_by_user_id'),
});

export type FfmpegExecutorSettingsRow = typeof ffmpegExecutorSettings.$inferSelect;
export type NewFfmpegExecutorSettingsRow = typeof ffmpegExecutorSettings.$inferInsert;
