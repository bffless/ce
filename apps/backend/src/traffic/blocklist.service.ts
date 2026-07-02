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
import {
  blocklists,
  blocklistEntries,
  domainBlocklists,
  domainMappings,
  Blocklist,
  BlocklistEntry,
} from '../db/schema';
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

/** How often the compiled matchers re-sync with the database (covers toggle
 *  flips made through the generic feature-flags API and multi-replica drift). */
const REFRESH_INTERVAL_MS = 30_000;

export interface AttachedDomainRef {
  id: string;
  domain: string;
}

export interface BlocklistWithEntries {
  id: string;
  name: string;
  description: string | null;
  /** True = applies to all domains (the optional all-domains default, #393). */
  isDefault: boolean;
  /** Domains this list is explicitly attached to (relevant when !isDefault). */
  attachedDomains: AttachedDomainRef[];
  entries: BlocklistPatternEntry[];
  allowlist: BlocklistPatternEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertBlocklistInput {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
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
 * A compiled effective set, as consumed by edge enforcement (#392): the same
 * regex sources the in-memory matcher enforces app-side, plus the toggle.
 * Sources are null when there is nothing to block/allow.
 */
export interface CompiledBlocklistState {
  enabled: boolean;
  blockSource: string | null;
  allowSource: string | null;
}

/** Normalize a Host/X-Forwarded-Host value for matcher lookup. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

/**
 * The Blocklist library + app-side enforcement authority (issues #391/#393).
 *
 * Owns the admin-global library of named Blocklists and their per-domain
 * attachments. A domain's effective set = the code-shipped Baseline + every
 * default (all-domains) list + the lists attached to that domain; allowlist
 * exceptions apply on the same per-domain scope. Requests whose host matches
 * no domain mapping (wildcard subdomain sites, the admin host, direct hits)
 * are enforced with the default set: Baseline + default lists.
 *
 * The compiled matchers live in memory and are consulted synchronously by the
 * traffic observer middleware on EVERY request — enforcement adds no I/O to
 * the hot path. They are rebuilt after each mutation and re-synced on an
 * interval; edge enforcement (#392) consumes the identical compiled sources
 * per domain, so app and edge can never disagree.
 */
@Injectable()
export class BlocklistService implements OnModuleInit {
  private readonly logger = new Logger(BlocklistService.name);

  // Start protected-by-default: Baseline-only, toggle at its default. The
  // first refresh() replaces this with the real database state; if that
  // fails (e.g. the migration has not run yet), the Baseline still applies.
  private defaultMatcher: CompiledBlocklistMatcher = buildBlocklistMatcher(
    BASELINE_BLOCKLIST_ENTRIES,
    [],
  );
  /** Matcher per normalized hostname (includes www/apex variants). */
  private hostMatchers = new Map<string, CompiledBlocklistMatcher>();
  /** Matcher per domain mapping id, for edge config generation. */
  private domainMatchers = new Map<string, CompiledBlocklistMatcher>();
  private enabled = true;

  /** Fingerprint of the last compiled state; null until the first refresh. */
  private lastFingerprint: string | null = null;
  private readonly changeListeners: Array<() => void> = [];

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /**
   * The compiled default set (Baseline + all-domains lists), used for
   * generated configs that serve no specific domain mapping (welcome page)
   * and as the fallback for hosts no mapping claims.
   */
  getCompiledState(): CompiledBlocklistState {
    return {
      enabled: this.enabled,
      blockSource: this.defaultMatcher.blockSource,
      allowSource: this.defaultMatcher.allowSource,
    };
  }

  /**
   * The compiled effective set for one domain mapping (#393), for edge
   * enforcement. Unknown ids (e.g. a mapping created since the last refresh)
   * fall back to the default set — the interval re-sync or the mutation-driven
   * refresh converges them.
   */
  getCompiledStateForDomain(domainMappingId: string): CompiledBlocklistState {
    const matcher = this.domainMatchers.get(domainMappingId) ?? this.defaultMatcher;
    return {
      enabled: this.enabled,
      blockSource: matcher.blockSource,
      allowSource: matcher.allowSource,
    };
  }

  /**
   * Every domain mapping whose compiled set DIFFERS from the default one, for
   * edge enforcement (#392/#393): the edge service validates each distinct
   * pair once and resolves per-domain rules at config-generation time.
   */
  getCompiledDomainStates(): Map<string, CompiledBlocklistState> {
    const states = new Map<string, CompiledBlocklistState>();
    for (const [id, matcher] of this.domainMatchers) {
      if (matcher !== this.defaultMatcher) {
        states.set(id, {
          enabled: this.enabled,
          blockSource: matcher.blockSource,
          allowSource: matcher.allowSource,
        });
      }
    }
    return states;
  }

  /**
   * Register a listener fired whenever a refresh lands a DIFFERENT effective
   * set (toggle flip, list/attachment mutation, or interval re-sync picking up
   * another replica's change). Not fired for the initial load — startup config
   * regeneration reads the state directly. Listener errors are logged, never
   * propagated into refresh().
   */
  onEffectiveChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * Synchronous enforcement check for the observer middleware. `host` is the
   * client-visible hostname (X-Forwarded-Host/Host) selecting the domain's
   * effective set; unknown or missing hosts use the default set. Must never
   * throw — a matcher bug must not take down request serving.
   */
  shouldBlock(pathname: string, host?: string | null): boolean {
    if (!this.enabled) {
      return false;
    }
    try {
      const matcher = (host && this.hostMatchers.get(normalizeHost(host))) || this.defaultMatcher;
      return matcher.isBlocked(pathname);
    } catch (error) {
      this.logger.error(`Blocklist match failed for ${pathname}: ${String(error)}`);
      return false;
    }
  }

  /** Rebuild all compiled matchers from the toggle + Baseline + lists + attachments. */
  @Interval(REFRESH_INTERVAL_MS)
  async refresh(): Promise<void> {
    try {
      const enabled = await this.featureFlags.isEnabled(BOT_PROTECTION_FLAG);
      let lists: BlocklistWithEntries[] = [];
      let domains: Array<{ id: string; domain: string }> = [];
      try {
        lists = await this.listBlocklists();
        domains = await db
          .select({ id: domainMappings.id, domain: domainMappings.domain })
          .from(domainMappings);
      } catch (error) {
        // Pre-migration or transient DB failure: enforce the Baseline alone
        // rather than dropping protection.
        this.logger.warn(`Could not load Blocklists; enforcing Baseline only: ${String(error)}`);
      }

      const byId = new Map(lists.map((list) => [list.id, list]));
      const defaultIds = lists.filter((list) => list.isDefault).map((list) => list.id);

      // Compile each distinct effective set once — most domains share the
      // default set, and scanners hammer many domains with the same paths.
      const compiled = new Map<string, CompiledBlocklistMatcher>();
      const compileSet = (ids: string[]): CompiledBlocklistMatcher => {
        // Dedupe: attaching a list that is already a default must compile to
        // the SAME set (and matcher) as the default, not a lookalike.
        const unique = [...new Set(ids)].sort();
        const key = unique.join(',');
        let matcher = compiled.get(key);
        if (!matcher) {
          const effective = unique.map((id) => byId.get(id)!).filter(Boolean);
          matcher = buildBlocklistMatcher(
            [...BASELINE_BLOCKLIST_ENTRIES, ...effective.flatMap((list) => list.entries)],
            effective.flatMap((list) => list.allowlist),
          );
          compiled.set(key, matcher);
        }
        return matcher;
      };

      const defaultMatcher = compileSet(defaultIds);

      const attachedByDomain = new Map<string, string[]>();
      for (const list of lists) {
        for (const ref of list.attachedDomains) {
          const existing = attachedByDomain.get(ref.id);
          if (existing) {
            existing.push(list.id);
          } else {
            attachedByDomain.set(ref.id, [list.id]);
          }
        }
      }

      const domainMatchers = new Map<string, CompiledBlocklistMatcher>();
      const hostMatchers = new Map<string, CompiledBlocklistMatcher>();
      const variantHosts = new Map<string, CompiledBlocklistMatcher>();
      for (const mapping of domains) {
        const attached = attachedByDomain.get(mapping.id) ?? [];
        const matcher = compileSet([...defaultIds, ...attached]);
        domainMatchers.set(mapping.id, matcher);

        // Register the exact host, plus its www/apex counterpart: wwwBehavior
        // routes both variants into this mapping's server blocks, and the
        // wildcard fallback path resolves mappings www-insensitively too.
        const host = normalizeHost(mapping.domain);
        hostMatchers.set(host, matcher);
        variantHosts.set(host.startsWith('www.') ? host.slice(4) : `www.${host}`, matcher);
      }
      // Variants must not shadow a host another mapping owns explicitly.
      for (const [host, matcher] of variantHosts) {
        if (!hostMatchers.has(host)) {
          hostMatchers.set(host, matcher);
        }
      }

      this.defaultMatcher = defaultMatcher;
      this.domainMatchers = domainMatchers;
      this.hostMatchers = hostMatchers;
      this.enabled = enabled;

      // Fingerprint the full effective state: toggle, default sources, and
      // every domain whose set differs from the default — so attachment and
      // entry mutations (and nothing else) trigger config regeneration.
      const domainPart = [...domainMatchers.entries()]
        .filter(([, matcher]) => matcher !== defaultMatcher)
        .map(([id, matcher]) => `${id}=${matcher.blockSource ?? ''}~${matcher.allowSource ?? ''}`)
        .sort()
        .join(';');
      const fingerprint = `${enabled}|${defaultMatcher.blockSource ?? ''}|${defaultMatcher.allowSource ?? ''}|${domainPart}`;
      const changed = this.lastFingerprint !== null && this.lastFingerprint !== fingerprint;
      this.lastFingerprint = fingerprint;
      if (changed) {
        this.notifyEffectiveChange();
      }
    } catch (error) {
      // Keep the last good matchers; never let a refresh failure break serving.
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
    const listIds = lists.map((list) => list.id);
    const entries = await db
      .select()
      .from(blocklistEntries)
      .where(inArray(blocklistEntries.blocklistId, listIds));
    const attachments = await this.loadAttachments(listIds);
    return lists.map((list) =>
      this.toDto(
        list,
        entries.filter((entry) => entry.blocklistId === list.id),
        attachments.get(list.id) ?? [],
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
    const attachments = await this.loadAttachments([id]);
    return this.toDto(list, entries, attachments.get(id) ?? []);
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
      .values({ name, description: input.description ?? null, isDefault: input.isDefault ?? true })
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
    if (input.isDefault !== undefined) {
      updates.isDefault = input.isDefault;
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

  /**
   * Append a single block pattern to a Blocklist — the inline
   * "add to blocklist" action from the Traffic views (#393). Duplicate
   * patterns are a silent no-op (the unique index already guarantees it).
   */
  async appendEntry(id: string, entry: BlocklistPatternEntry): Promise<BlocklistWithEntries> {
    const [existing] = await db.select().from(blocklists).where(eq(blocklists.id, id)).limit(1);
    if (!existing) {
      throw new NotFoundException('Blocklist not found');
    }
    const [normalized] = this.normalizeAndValidate([entry], 'entries');
    await db
      .insert(blocklistEntries)
      .values({ blocklistId: id, kind: 'block', matchType: normalized.matchType, value: normalized.value })
      .onConflictDoNothing();
    await db.update(blocklists).set({ updatedAt: new Date() }).where(eq(blocklists.id, id));

    await this.refresh();
    return this.getBlocklist(id);
  }

  // ---------------------------------------------------------------------
  // Per-domain attachment (#393)
  // ---------------------------------------------------------------------

  /** Blocklist ids attached to one domain mapping (excludes defaults). */
  async getDomainBlocklistIds(domainMappingId: string): Promise<string[]> {
    const rows = await db
      .select({ blocklistId: domainBlocklists.blocklistId })
      .from(domainBlocklists)
      .where(eq(domainBlocklists.domainMappingId, domainMappingId))
      .orderBy(asc(domainBlocklists.createdAt));
    return rows.map((row) => row.blocklistId);
  }

  /**
   * Replace the set of Blocklists attached to a domain mapping — the same
   * replace-all shape as alias↔proxy-rule-set attachment. Rebuilds matchers,
   * which triggers edge config regeneration when the effective set changed.
   */
  async syncDomainBlocklists(
    domainMappingId: string,
    blocklistIds: string[],
  ): Promise<{ domainMappingId: string; blocklistIds: string[] }> {
    const [mapping] = await db
      .select({ id: domainMappings.id })
      .from(domainMappings)
      .where(eq(domainMappings.id, domainMappingId))
      .limit(1);
    if (!mapping) {
      throw new NotFoundException('Domain mapping not found');
    }

    const unique = [...new Set(blocklistIds)];
    if (unique.length > 0) {
      const found = await db
        .select({ id: blocklists.id })
        .from(blocklists)
        .where(inArray(blocklists.id, unique));
      if (found.length !== unique.length) {
        const foundIds = new Set(found.map((row) => row.id));
        const missing = unique.filter((id) => !foundIds.has(id));
        throw new BadRequestException(`Unknown Blocklist id(s): ${missing.join(', ')}`);
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(domainBlocklists).where(eq(domainBlocklists.domainMappingId, domainMappingId));
      if (unique.length > 0) {
        await tx
          .insert(domainBlocklists)
          .values(unique.map((blocklistId) => ({ domainMappingId, blocklistId })));
      }
    });

    await this.refresh();
    return { domainMappingId, blocklistIds: unique };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /** Attached domains per blocklist id, resolved to {id, domain} refs. */
  private async loadAttachments(listIds: string[]): Promise<Map<string, AttachedDomainRef[]>> {
    const rows = await db
      .select({
        blocklistId: domainBlocklists.blocklistId,
        domainMappingId: domainBlocklists.domainMappingId,
        domain: domainMappings.domain,
      })
      .from(domainBlocklists)
      .innerJoin(domainMappings, eq(domainBlocklists.domainMappingId, domainMappings.id))
      .where(inArray(domainBlocklists.blocklistId, listIds));

    const byList = new Map<string, AttachedDomainRef[]>();
    for (const row of rows) {
      const ref: AttachedDomainRef = { id: row.domainMappingId, domain: row.domain };
      const existing = byList.get(row.blocklistId);
      if (existing) {
        existing.push(ref);
      } else {
        byList.set(row.blocklistId, [ref]);
      }
    }
    return byList;
  }

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

  private toDto(
    list: Blocklist,
    entries: BlocklistEntry[],
    attachedDomains: AttachedDomainRef[],
  ): BlocklistWithEntries {
    const pattern = (entry: BlocklistEntry): BlocklistPatternEntry => ({
      matchType: entry.matchType,
      value: entry.value,
    });
    return {
      id: list.id,
      name: list.name,
      description: list.description,
      isDefault: list.isDefault,
      attachedDomains,
      entries: entries.filter((entry) => entry.kind === 'block').map(pattern),
      allowlist: entries.filter((entry) => entry.kind === 'allow').map(pattern),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }
}
