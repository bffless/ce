import { pgTable, uuid, varchar, text, integer, bigint, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * The Request log (issue #383/#390): the admin-global, cross-project record of
 * requests the instance observed — the bot-signal subset only. The application
 * interceptor observes every request, but only Unmatched requests (and, once
 * Blocklist enforcement lands in #391, blocked ones) are persisted here.
 *
 * Retention is bounded: rows older than the configured window are pruned, and
 * a hard row cap keeps a scanner storm from filling the database (see
 * RequestLogService.prune).
 */
export const trafficRequests = pgTable(
  'traffic_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** When the response finished (from the observer's TrafficEvent) */
    timestamp: timestamp('timestamp').notNull(),

    /** Client IP (X-Forwarded-For aware); IPv6 needs up to 45 chars */
    ip: varchar('ip', { length: 45 }).notNull(),

    method: varchar('method', { length: 16 }).notNull(),

    /** Original request URL (path + query) */
    path: text('path').notNull(),

    httpVersion: varchar('http_version', { length: 16 }).notNull(),

    status: integer('status').notNull(),

    /** Response body bytes sent */
    bytes: bigint('bytes', { mode: 'number' }).notNull(),

    referer: text('referer'),
    userAgent: text('user_agent'),

    /** Host the client requested (X-Forwarded-Host aware) */
    host: varchar('host', { length: 255 }),

    /**
     * Why this request was persisted:
     * - unmatched: resolved to no deployment, alias, or asset
     * - blocked: refused by the Blocklist (arrives with #391)
     */
    classification: varchar('classification', { length: 20 })
      .$type<'unmatched' | 'blocked'>()
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Retention pruning, cap enforcement, and the default time-ordered listing
    index('traffic_requests_timestamp_idx').on(table.timestamp),
    // Per-IP filtering (drill-down from the rollup)
    index('traffic_requests_ip_idx').on(table.ip, table.timestamp),
    index('traffic_requests_status_idx').on(table.status),
    index('traffic_requests_classification_idx').on(table.classification),
  ],
);

export type TrafficRequest = typeof trafficRequests.$inferSelect;
export type NewTrafficRequest = typeof trafficRequests.$inferInsert;
