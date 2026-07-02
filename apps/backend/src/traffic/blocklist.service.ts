import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { blocklists, blocklistEntries, Blocklist, BlocklistEntry } from '../db/schema';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import {
  BlocklistPatternEntry,
  CompiledBlocklistMatcher,
  buildBlocklistMatcher,
  validateBlocklistValue,
} from './blocklist-compiler';
import { BASELINE_BLOCKLIST_ENTRIES } from './blocklist-baseline';

/** Master toggle flag key (DB > file > env > default-on, see FLAG_DEFINITIONS). */
export const BOT_PROTECTION_FLAG = 'BOT_PROTECTION_ENABLED';

/** How often the compiled matcher re-syncs with the database (covers toggle
 *  flips made through the generic feature-flags API and multi-replica drift). */
const REFRESH_INTERVAL_MS = 30_000;

export interface BlocklistWithEntries {
  id: string;
  name: string;
  description: string | null;
  entries: BlocklistPatternEntry[];
  allowlist: BlocklistPatternEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertBlocklistInput {
  name?: string;
  description?: string | null;
  entries?: BlocklistPatternEntry[];
  allowlist?: BlocklistPatternEntry[];
}

export interface BlocklistSettings {
  /** The master toggle: false disables ALL blocking (Baseline and lists) instantly. */
  enabled: boolean;
  /** Size of the code-shipped Baseline, for display. */
  baselineEntryCount: number;
}

/**
 * The compiled effective set, as consumed by edge enforcement (#392): the
 * same regex sources the in-memory matcher enforces app-side, plus the
 * toggle. Sources are null when there is nothing to block/allow.
 */
export interface CompiledBlocklistState {
  enabled: boolean;
  blockSource: string | null;
  allowSource: string | null;
}

/**
 * The Blocklist library + app-side enforcement authority (issue #391).
 *
 * Owns the admin-global library of named Blocklists and keeps an in-memory
 * compiled matcher (Baseline + every list's block patterns, minus every
 * list's allowlist) that the traffic observer middleware consults
 * synchronously on EVERY request — so enforcement adds no I/O to the hot
 * path. The matcher is rebuilt after each mutation and re-synced on an
 * interval.
 *
 * Until #393 lands per-domain attachment, named Blocklists apply
 * instance-wide at the application layer, exactly like the Baseline.
 */
@Injectable()
export class BlocklistService implements OnModuleInit {
  private readonly logger = new Logger(BlocklistService.name);

  // Start protected-by-default: Baseline-only, toggle at its default. The
  // first refresh() replaces this with the real database state; if that
  // fails (e.g. the migration has not run yet), the Baseline still applies.
  private matcher: CompiledBlocklistMatcher = buildBlocklistMatcher(BASELINE_BLOCKLIST_ENTRIES, []);
  private enabled = true;

  /** Fingerprint of the last compiled state; null until the first refresh. */
  private lastFingerprint: string | null = null;
  private readonly changeListeners: Array<() => void> = [];

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /**
   * The compiled effective set for edge enforcement (#392). Same in-memory
   * state shouldBlock() enforces, so app and edge can never disagree about
   * what the effective rules are.
   */
  getCompiledState(): CompiledBlocklistState {
    return {
      enabled: this.enabled,
      blockSource: this.matcher.blockSource,
      allowSource: this.matcher.allowSource,
    };
  }

  /**
   * Register a listener fired whenever a refresh lands a DIFFERENT effective
   * set (toggle flip, list mutation, or interval re-sync picking up another
   * replica's change). Not fired for the initial load — startup config
   * regeneration reads the state directly. Listener errors are logged, never
   * propagated into refresh().
   */
  onEffectiveChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * Synchronous enforcement check for the observer middleware. Must never
   * throw — a matcher bug must not take down request serving.
   */
  shouldBlock(pathname: string): boolean {
    if (!this.enabled) {
      return false;
    }
    try {
      return this.matcher.isBlocked(pathname);
    } catch (error) {
      this.logger.error(`Blocklist match failed for ${pathname}: ${String(error)}`);
      return false;
    }
  }

  /** Rebuild the compiled matcher from the toggle + Baseline + all lists. */
  @Interval(REFRESH_INTERVAL_MS)
  async refresh(): Promise<void> {
    try {
      const enabled = await this.featureFlags.isEnabled(BOT_PROTECTION_FLAG);
      let lists: BlocklistWithEntries[] = [];
      try {
        lists = await this.listBlocklists();
      } catch (error) {
        // Pre-migration or transient DB failure: enforce the Baseline alone
        // rather than dropping protection.
        this.logger.warn(`Could not load Blocklists; enforcing Baseline only: ${String(error)}`);
      }

      const blockEntries = [
        ...BASELINE_BLOCKLIST_ENTRIES,
        ...lists.flatMap((list) => list.entries),
      ];
      const allowEntries = lists.flatMap((list) => list.allowlist);

      this.matcher = buildBlocklistMatcher(blockEntries, allowEntries);
      this.enabled = enabled;

      const fingerprint = `${enabled}|${this.matcher.blockSource ?? ''}|${this.matcher.allowSource ?? ''}`;
      const changed = this.lastFingerprint !== null && this.lastFingerprint !== fingerprint;
      this.lastFingerprint = fingerprint;
      if (changed) {
        this.notifyEffectiveChange();
      }
    } catch (error) {
      // Keep the last good matcher; never let a refresh failure break serving.
      this.logger.error(`Blocklist refresh failed: ${String(error)}`);
    }
  }

  private notifyEffectiveChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        this.logger.error(`Blocklist change listener failed: ${String(error)}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Settings (master toggle)
  // ---------------------------------------------------------------------

  async getSettings(): Promise<BlocklistSettings> {
    return {
      enabled: await this.featureFlags.isEnabled(BOT_PROTECTION_FLAG),
      baselineEntryCount: BASELINE_BLOCKLIST_ENTRIES.length,
    };
  }

  async setEnabled(enabled: boolean): Promise<BlocklistSettings> {
    await this.featureFlags.setFlag(BOT_PROTECTION_FLAG, enabled);
    await this.refresh();
    return this.getSettings();
  }

  /** The code-shipped Baseline, read-only (for display on the Traffic page). */
  getBaselineEntries(): BlocklistPatternEntry[] {
    return BASELINE_BLOCKLIST_ENTRIES;
  }

  // ---------------------------------------------------------------------
  // Library CRUD
  // ---------------------------------------------------------------------

  async listBlocklists(): Promise<BlocklistWithEntries[]> {
    const lists = await db.select().from(blocklists).orderBy(asc(blocklists.name));
    if (lists.length === 0) {
      return [];
    }
    const entries = await db
      .select()
      .from(blocklistEntries)
      .where(
        inArray(
          blocklistEntries.blocklistId,
          lists.map((list) => list.id),
        ),
      );
    return lists.map((list) =>
      this.toDto(
        list,
        entries.filter((entry) => entry.blocklistId === list.id),
      ),
    );
  }

  async getBlocklist(id: string): Promise<BlocklistWithEntries> {
    const [list] = await db.select().from(blocklists).where(eq(blocklists.id, id)).limit(1);
    if (!list) {
      throw new NotFoundException('Blocklist not found');
    }
    const entries = await db
      .select()
      .from(blocklistEntries)
      .where(eq(blocklistEntries.blocklistId, id));
    return this.toDto(list, entries);
  }

  async createBlocklist(input: UpsertBlocklistInput): Promise<BlocklistWithEntries> {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Blocklist name is required');
    }
    const entries = this.normalizeAndValidate(input.entries ?? [], 'entries');
    const allowlist = this.normalizeAndValidate(input.allowlist ?? [], 'allowlist');

    const [existing] = await db.select().from(blocklists).where(eq(blocklists.name, name)).limit(1);
    if (existing) {
      throw new ConflictException(`A Blocklist named "${name}" already exists`);
    }

    const [created] = await db
      .insert(blocklists)
      .values({ name, description: input.description ?? null })
      .returning();
    await this.replaceEntries(created.id, 'block', entries);
    await this.replaceEntries(created.id, 'allow', allowlist);

    await this.refresh();
    return this.getBlocklist(created.id);
  }

  async updateBlocklist(id: string, input: UpsertBlocklistInput): Promise<BlocklistWithEntries> {
    const [existing] = await db.select().from(blocklists).where(eq(blocklists.id, id)).limit(1);
    if (!existing) {
      throw new NotFoundException('Blocklist not found');
    }

    const updates: Partial<Blocklist> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new BadRequestException('Blocklist name cannot be empty');
      }
      const [clash] = await db.select().from(blocklists).where(eq(blocklists.name, name)).limit(1);
      if (clash && clash.id !== id) {
        throw new ConflictException(`A Blocklist named "${name}" already exists`);
      }
      updates.name = name;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }

    const entries =
      input.entries !== undefined ? this.normalizeAndValidate(input.entries, 'entries') : undefined;
    const allowlist =
      input.allowlist !== undefined
        ? this.normalizeAndValidate(input.allowlist, 'allowlist')
        : undefined;

    await db.update(blocklists).set(updates).where(eq(blocklists.id, id));
    if (entries !== undefined) {
      await this.replaceEntries(id, 'block', entries);
    }
    if (allowlist !== undefined) {
      await this.replaceEntries(id, 'allow', allowlist);
    }

    await this.refresh();
    return this.getBlocklist(id);
  }

  async deleteBlocklist(id: string): Promise<void> {
    const [deleted] = await db.delete(blocklists).where(eq(blocklists.id, id)).returning();
    if (!deleted) {
      throw new NotFoundException('Blocklist not found');
    }
    await this.refresh();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Trim, normalize, dedupe, and validate structured pattern entries.
   * Rejects the whole request with a per-pattern error list so the admin can
   * fix their textarea in one round trip.
   */
  private normalizeAndValidate(
    entries: BlocklistPatternEntry[],
    label: 'entries' | 'allowlist',
  ): BlocklistPatternEntry[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    const normalized: BlocklistPatternEntry[] = [];

    for (const entry of entries) {
      let value = entry.value?.trim() ?? '';
      // A path pattern that doesn't start with "/" would never match; treat
      // the leading slash as implied for path-anchored match types.
      if ((entry.matchType === 'prefix' || entry.matchType === 'exact') && value !== '' && !value.startsWith('/')) {
        value = `/${value}`;
      }
      const error = validateBlocklistValue(value);
      if (error) {
        errors.push(`${label}: "${entry.value}" — ${error}`);
        continue;
      }
      const key = `${entry.matchType}:${value.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push({ matchType: entry.matchType, value });
    }

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid blocklist patterns', errors });
    }
    return normalized;
  }

  private async replaceEntries(
    blocklistId: string,
    kind: 'block' | 'allow',
    entries: BlocklistPatternEntry[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(blocklistEntries)
        .where(and(eq(blocklistEntries.blocklistId, blocklistId), eq(blocklistEntries.kind, kind)));
      if (entries.length > 0) {
        await tx.insert(blocklistEntries).values(
          entries.map((entry) => ({
            blocklistId,
            kind,
            matchType: entry.matchType,
            value: entry.value,
          })),
        );
      }
    });
  }

  private toDto(list: Blocklist, entries: BlocklistEntry[]): BlocklistWithEntries {
    const pattern = (entry: BlocklistEntry): BlocklistPatternEntry => ({
      matchType: entry.matchType,
      value: entry.value,
    });
    return {
      id: list.id,
      name: list.name,
      description: list.description,
      entries: entries.filter((entry) => entry.kind === 'block').map(pattern),
      allowlist: entries.filter((entry) => entry.kind === 'allow').map(pattern),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }
}
