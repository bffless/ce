import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Per-IP rollup over the Request log (issue #390): one row per client IP that
 * produced persisted (Unmatched/blocked) requests, aggregating request count,
 * first/last seen, and small samples of paths and user-agents. This is the
 * "worst offenders" view, and the surface a future Cloudflare-IP feed consumes.
 *
 * Maintained incrementally by RequestLogService as events are persisted; rows
 * whose lastSeenAt falls outside the retention window are pruned, and a hard
 * row cap bounds a distributed (many-IP) scan.
 */
export const trafficIpRollups = pgTable(
  'traffic_ip_rollups',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Client IP; IPv6 needs up to 45 chars */
    ip: varchar('ip', { length: 45 }).notNull(),

    /** Total persisted requests seen from this IP (within retention) */
    requestCount: bigint('request_count', { mode: 'number' }).notNull().default(0),

    firstSeenAt: timestamp('first_seen_at').notNull(),
    lastSeenAt: timestamp('last_seen_at').notNull(),

    /** First few distinct request paths seen from this IP (capped) */
    samplePaths: jsonb('sample_paths').$type<string[]>().notNull().default([]),

    /** First few distinct user-agents seen from this IP (capped) */
    sampleUserAgents: jsonb('sample_user_agents').$type<string[]>().notNull().default([]),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('traffic_ip_rollups_ip_unique').on(table.ip),
    // "Worst offenders" sort
    index('traffic_ip_rollups_request_count_idx').on(table.requestCount),
    // Retention pruning + recency sort
    index('traffic_ip_rollups_last_seen_idx').on(table.lastSeenAt),
  ],
);

export type TrafficIpRollup = typeof trafficIpRollups.$inferSelect;
export type NewTrafficIpRollup = typeof trafficIpRollups.$inferInsert;
