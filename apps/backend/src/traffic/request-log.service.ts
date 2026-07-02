import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { SQL, and, count, desc, asc, eq, gte, ilike, inArray, lt, lte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  trafficRequests,
  trafficIpRollups,
  TrafficRequest,
  TrafficIpRollup,
  NewTrafficRequest,
} from '../db/schema';
import { TrafficEvent } from './traffic-event.interface';
import { TrafficEventsService } from './traffic-events.service';
import { formatAccessLogLine } from './access-log.util';

/** How often buffered events are written to the database. */
const FLUSH_INTERVAL_MS = 3_000;
/** Max events held in memory between flushes; beyond this a storm is dropped, not queued. */
const BUFFER_CAP = 5_000;
/** Rows per INSERT statement. */
const INSERT_CHUNK_SIZE = 500;
/** Rows per DELETE ... IN (...) statement when pruning. */
const DELETE_CHUNK_SIZE = 1_000;
/** Distinct sample paths / user-agents kept per IP rollup. */
const SAMPLE_PATHS_CAP = 10;
const SAMPLE_UAS_CAP = 5;
/** Re-check the hard row cap after this many inserts (a storm must not wait for the hourly prune). */
const CAP_CHECK_EVERY_ROWS = 5_000;

export interface RequestLogFilters {
  ip?: string;
  /** Substring match on the request path */
  path?: string;
  status?: number;
  classification?: 'unmatched' | 'blocked';
  /** ISO 8601 lower bound (inclusive) on the request timestamp */
  from?: string;
  /** ISO 8601 upper bound (inclusive) on the request timestamp */
  to?: string;
}

export interface IpRollupFilters {
  /** Substring match on the IP */
  ip?: string;
}

/** A persisted Request-log record plus its rendered access-log line. */
export type RequestLogEntry = Omit<TrafficRequest, 'timestamp' | 'createdAt'> & {
  timestamp: string;
  line: string;
};

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PruneSummary {
  requestsDeletedByAge: number;
  requestsDeletedOverCap: number;
  rollupsDeletedByAge: number;
  rollupsDeletedOverCap: number;
}

/**
 * The Request log (issue #390): persists the bot-signal subset of what the
 * application interceptor observes.
 *
 * Subscribes to TrafficEventsService.stream() and buffers every non-matched
 * event (Unmatched today; blocked once #391 lands), flushing to Postgres on an
 * interval so a scanner burst becomes a handful of batched INSERTs instead of
 * a write per request. Alongside the raw records it maintains the per-IP
 * rollup (count, first/last seen, sample paths/user-agents).
 *
 * Retention is bounded twice over: an age window and a hard row cap, both
 * enforced by prune() (called hourly by TrafficRetentionScheduler, and the cap
 * alone re-checked inline every CAP_CHECK_EVERY_ROWS inserts).
 *
 * Config (env):
 * - TRAFFIC_LOG_ENABLED   ('false' disables persistence entirely; default on)
 * - TRAFFIC_LOG_RETENTION_DAYS (default 14)
 * - TRAFFIC_LOG_MAX_ROWS  (hard cap on traffic_requests; default 100000)
 * - TRAFFIC_LOG_MAX_IPS   (hard cap on traffic_ip_rollups; default 50000)
 */
@Injectable()
export class RequestLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestLogService.name);

  readonly enabled = process.env.TRAFFIC_LOG_ENABLED !== 'false';
  readonly retentionDays = parsePositiveInt(process.env.TRAFFIC_LOG_RETENTION_DAYS, 14);
  readonly maxRows = parsePositiveInt(process.env.TRAFFIC_LOG_MAX_ROWS, 100_000);
  readonly maxIps = parsePositiveInt(process.env.TRAFFIC_LOG_MAX_IPS, 50_000);

  private buffer: TrafficEvent[] = [];
  private droppedSinceLastFlush = 0;
  private insertedSinceCapCheck = 0;
  private isFlushing = false;
  private subscription: Subscription | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly trafficEvents: TrafficEventsService) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log({ event: 'request_log_disabled', reason: 'TRAFFIC_LOG_ENABLED=false' });
      return;
    }
    this.subscription = this.trafficEvents.stream().subscribe((event) => this.observe(event));
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Buffer a single observed event (only the persisted subset). */
  observe(event: TrafficEvent): void {
    if (event.classification === 'matched') {
      return;
    }
    if (this.buffer.length >= BUFFER_CAP) {
      this.droppedSinceLastFlush++;
      return;
    }
    this.buffer.push(event);
  }

  /**
   * Write all buffered events: batched inserts into traffic_requests plus
   * per-IP rollup upserts (one per distinct IP in the batch).
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }
    this.isFlushing = true;
    const events = this.buffer.splice(0);
    const dropped = this.droppedSinceLastFlush;
    this.droppedSinceLastFlush = 0;
    try {
      if (dropped > 0) {
        this.logger.warn({ event: 'request_log_buffer_overflow', dropped });
      }

      const rows: NewTrafficRequest[] = events.map((e) => ({
        timestamp: new Date(e.timestamp),
        ip: e.ip,
        method: e.method,
        path: e.path,
        httpVersion: e.httpVersion,
        status: e.status,
        bytes: e.bytes,
        referer: e.referer,
        userAgent: e.userAgent,
        host: e.host,
        classification: e.classification as 'unmatched' | 'blocked',
      }));
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        await db.insert(trafficRequests).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
      }

      await this.updateRollups(events);

      this.insertedSinceCapCheck += rows.length;
      if (this.insertedSinceCapCheck >= CAP_CHECK_EVERY_ROWS) {
        this.insertedSinceCapCheck = 0;
        await this.enforceRequestRowCap();
      }
    } catch (error) {
      this.logger.error({ event: 'request_log_flush_failed', error: String(error) });
    } finally {
      this.isFlushing = false;
    }
  }

  private async updateRollups(events: TrafficEvent[]): Promise<void> {
    const groups = new Map<
      string,
      { count: number; firstSeen: Date; lastSeen: Date; paths: string[]; userAgents: string[] }
    >();
    for (const e of events) {
      const at = new Date(e.timestamp);
      const group = groups.get(e.ip);
      if (!group) {
        groups.set(e.ip, {
          count: 1,
          firstSeen: at,
          lastSeen: at,
          paths: [e.path],
          userAgents: e.userAgent ? [e.userAgent] : [],
        });
        continue;
      }
      group.count++;
      if (at < group.firstSeen) group.firstSeen = at;
      if (at > group.lastSeen) group.lastSeen = at;
      if (!group.paths.includes(e.path) && group.paths.length < SAMPLE_PATHS_CAP) {
        group.paths.push(e.path);
      }
      if (
        e.userAgent &&
        !group.userAgents.includes(e.userAgent) &&
        group.userAgents.length < SAMPLE_UAS_CAP
      ) {
        group.userAgents.push(e.userAgent);
      }
    }

    for (const [ip, group] of groups) {
      const [existing] = await db
        .select()
        .from(trafficIpRollups)
        .where(eq(trafficIpRollups.ip, ip))
        .limit(1);

      if (existing) {
        await db
          .update(trafficIpRollups)
          .set({
            requestCount: existing.requestCount + group.count,
            firstSeenAt: existing.firstSeenAt < group.firstSeen ? existing.firstSeenAt : group.firstSeen,
            lastSeenAt: existing.lastSeenAt > group.lastSeen ? existing.lastSeenAt : group.lastSeen,
            samplePaths: mergeSamples(existing.samplePaths, group.paths, SAMPLE_PATHS_CAP),
            sampleUserAgents: mergeSamples(existing.sampleUserAgents, group.userAgents, SAMPLE_UAS_CAP),
            updatedAt: new Date(),
          })
          .where(eq(trafficIpRollups.id, existing.id));
      } else {
        // Concurrent first-insert races (two flushes, or a future second
        // instance) collapse into an increment instead of a duplicate-key error.
        await db
          .insert(trafficIpRollups)
          .values({
            ip,
            requestCount: group.count,
            firstSeenAt: group.firstSeen,
            lastSeenAt: group.lastSeen,
            samplePaths: group.paths,
            sampleUserAgents: group.userAgents,
          })
          .onConflictDoUpdate({
            target: trafficIpRollups.ip,
            set: {
              requestCount: sql`${trafficIpRollups.requestCount} + ${group.count}`,
              lastSeenAt: group.lastSeen,
              updatedAt: new Date(),
            },
          });
      }
    }
  }

  /**
   * Enforce both retention bounds on both tables. Returns what was deleted.
   */
  async prune(): Promise<PruneSummary> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);

    const requestsDeletedByAge = await this.deleteWhereCount(
      db.delete(trafficRequests).where(lt(trafficRequests.timestamp, cutoff)),
    );
    const requestsDeletedOverCap = await this.enforceRequestRowCap();

    const rollupsDeletedByAge = await this.deleteWhereCount(
      db.delete(trafficIpRollups).where(lt(trafficIpRollups.lastSeenAt, cutoff)),
    );
    const rollupsDeletedOverCap = await this.enforceRollupRowCap();

    return { requestsDeletedByAge, requestsDeletedOverCap, rollupsDeletedByAge, rollupsDeletedOverCap };
  }

  /** Trim traffic_requests to maxRows, dropping the oldest first. */
  private async enforceRequestRowCap(): Promise<number> {
    const [{ value: total }] = await db.select({ value: count() }).from(trafficRequests);
    const excess = total - this.maxRows;
    if (excess <= 0) {
      return 0;
    }
    const victims = await db
      .select({ id: trafficRequests.id })
      .from(trafficRequests)
      .orderBy(asc(trafficRequests.timestamp))
      .limit(excess);
    await this.deleteByIds(trafficRequests, trafficRequests.id, victims.map((v) => v.id));
    return victims.length;
  }

  /** Trim traffic_ip_rollups to maxIps, dropping the least-recently-seen first. */
  private async enforceRollupRowCap(): Promise<number> {
    const [{ value: total }] = await db.select({ value: count() }).from(trafficIpRollups);
    const excess = total - this.maxIps;
    if (excess <= 0) {
      return 0;
    }
    const victims = await db
      .select({ id: trafficIpRollups.id })
      .from(trafficIpRollups)
      .orderBy(asc(trafficIpRollups.lastSeenAt))
      .limit(excess);
    await this.deleteByIds(trafficIpRollups, trafficIpRollups.id, victims.map((v) => v.id));
    return victims.length;
  }

  private async deleteByIds(
    table: typeof trafficRequests | typeof trafficIpRollups,
    idColumn: typeof trafficRequests.id | typeof trafficIpRollups.id,
    ids: string[],
  ): Promise<void> {
    for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
      await db.delete(table).where(inArray(idColumn, ids.slice(i, i + DELETE_CHUNK_SIZE)));
    }
  }

  private async deleteWhereCount(query: PromiseLike<unknown>): Promise<number> {
    const result = (await query) as { count?: number } | undefined;
    return result?.count ?? 0;
  }

  // ==================== Read API ====================

  async listRequests(
    filters: RequestLogFilters,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<RequestLogEntry>> {
    const where = buildRequestWhere(filters);
    const [{ value: total }] = await db.select({ value: count() }).from(trafficRequests).where(where);
    const rows = await db
      .select()
      .from(trafficRequests)
      .where(where)
      .orderBy(desc(trafficRequests.timestamp))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      data: rows.map(toRequestLogEntry),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async listIpRollups(
    filters: IpRollupFilters,
    sortBy: 'requestCount' | 'lastSeenAt' | 'firstSeenAt',
    sortOrder: 'asc' | 'desc',
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<TrafficIpRollup>> {
    const where = buildRollupWhere(filters);
    const [{ value: total }] = await db.select({ value: count() }).from(trafficIpRollups).where(where);
    const sortColumn = {
      requestCount: trafficIpRollups.requestCount,
      lastSeenAt: trafficIpRollups.lastSeenAt,
      firstSeenAt: trafficIpRollups.firstSeenAt,
    }[sortBy];
    const rows = await db
      .select()
      .from(trafficIpRollups)
      .where(where)
      .orderBy(sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async exportRequests(
    filters: RequestLogFilters,
    format: 'csv' | 'json',
    limit: number,
  ): Promise<string> {
    const rows = await db
      .select()
      .from(trafficRequests)
      .where(buildRequestWhere(filters))
      .orderBy(desc(trafficRequests.timestamp))
      .limit(limit);
    const entries = rows.map(toRequestLogEntry);

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }
    const headers = [
      'timestamp',
      'ip',
      'method',
      'path',
      'status',
      'bytes',
      'referer',
      'userAgent',
      'host',
      'classification',
    ];
    const lines = [headers.join(',')];
    for (const e of entries) {
      lines.push(
        [
          escapeCsv(e.timestamp),
          escapeCsv(e.ip),
          escapeCsv(e.method),
          escapeCsv(e.path),
          escapeCsv(String(e.status)),
          escapeCsv(String(e.bytes)),
          escapeCsv(e.referer ?? ''),
          escapeCsv(e.userAgent ?? ''),
          escapeCsv(e.host ?? ''),
          escapeCsv(e.classification),
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  async exportIpRollups(
    filters: IpRollupFilters,
    format: 'csv' | 'json',
    limit: number,
  ): Promise<string> {
    const rows = await db
      .select()
      .from(trafficIpRollups)
      .where(buildRollupWhere(filters))
      .orderBy(desc(trafficIpRollups.requestCount))
      .limit(limit);

    if (format === 'json') {
      return JSON.stringify(rows, null, 2);
    }
    const headers = ['ip', 'requestCount', 'firstSeenAt', 'lastSeenAt', 'samplePaths', 'sampleUserAgents'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        [
          escapeCsv(r.ip),
          escapeCsv(String(r.requestCount)),
          escapeCsv(r.firstSeenAt.toISOString()),
          escapeCsv(r.lastSeenAt.toISOString()),
          escapeCsv(r.samplePaths.join(' ')),
          escapeCsv(r.sampleUserAgents.join(' ')),
        ].join(','),
      );
    }
    return lines.join('\n');
  }
}

function buildRequestWhere(filters: RequestLogFilters) {
  const conditions: SQL<unknown>[] = [];
  if (filters.ip) conditions.push(eq(trafficRequests.ip, filters.ip));
  if (filters.path) conditions.push(ilike(trafficRequests.path, `%${escapeLike(filters.path)}%`));
  if (filters.status !== undefined) conditions.push(eq(trafficRequests.status, filters.status));
  if (filters.classification) conditions.push(eq(trafficRequests.classification, filters.classification));
  if (filters.from) conditions.push(gte(trafficRequests.timestamp, new Date(filters.from)));
  if (filters.to) conditions.push(lte(trafficRequests.timestamp, new Date(filters.to)));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildRollupWhere(filters: IpRollupFilters) {
  if (filters.ip) {
    return ilike(trafficIpRollups.ip, `%${escapeLike(filters.ip)}%`);
  }
  return undefined;
}

function toRequestLogEntry(row: TrafficRequest): RequestLogEntry {
  const { createdAt: _createdAt, ...rest } = row;
  const entry = { ...rest, timestamp: row.timestamp.toISOString() };
  return { ...entry, line: formatAccessLogLine(entry) };
}

/** Escape LIKE/ILIKE wildcards in user-supplied substrings. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Merge new samples into existing ones, deduped, capped, existing first. */
function mergeSamples(existing: string[], incoming: string[], cap: number): string[] {
  const merged = [...existing];
  for (const value of incoming) {
    if (merged.length >= cap) break;
    if (!merged.includes(value)) merged.push(value);
  }
  return merged;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
