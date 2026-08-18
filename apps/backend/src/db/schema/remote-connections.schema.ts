import { integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Instance-level, admin-owned "remote connections": a named, credential-bearing
 * base URL of a service this CE instance calls with its own identity (Cloud Run
 * is the reference deployment). Referenced BY NAME from pipeline steps
 * (`remote_request.connection`) and by id from ffmpeg_executor_settings.
 * Env vars REMOTE_CONNECTION_<NAME>_{URL,AUTH,CREDENTIAL_JSON,MAX_INFLIGHT,HEALTH_PATH}
 * override individual fields (see remote-connections/remote-connections-env.ts).
 *
 * The credential is AES-256-GCM encrypted (common/crypto/aes-gcm.ts) and WRITE-ONLY.
 * Spec: docs/superpowers/specs/2026-08-18-remote-connections-design.md §1.1.
 */
export const remoteConnections = pgTable('remote_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** ^[a-z0-9][a-z0-9-]{0,63}$ — rules name it by this. */
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** Base URL, trimmed, trailing slash stripped; https unless auth = 'none'. */
  url: text('url').notNull(),
  /** 'google_id_token' | 'none' (free string so aws_sigv4/bearer_secret can be added later). */
  auth: varchar('auth', { length: 32 }).default('google_id_token').notNull(),
  /** encryptString(<credential>) — for google_id_token the SA JSON key; null = ADC / none. */
  credentialEncrypted: text('credential_encrypted'),
  /** Fuse: max concurrent in-flight requests from this instance to this connection. */
  maxInflight: integer('max_inflight').default(8).notNull(),
  /** GET <url><healthPath> for Test / readiness; null = no probe. */
  healthPath: varchar('health_path', { length: 255 }).default('/health'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedByUserId: uuid('updated_by_user_id'),
});

export type RemoteConnectionRow = typeof remoteConnections.$inferSelect;
export type NewRemoteConnectionRow = typeof remoteConnections.$inferInsert;
