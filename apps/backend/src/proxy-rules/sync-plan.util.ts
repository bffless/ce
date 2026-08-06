import { mergeRuleThreeWay } from './three-way-merge.util';
import type {
  AuthTransformConfig,
  EmailHandlerConfig,
  PipelineConfig,
  ProxyHeaderConfig,
  ProxyType,
} from '../db/schema/proxy-rules.schema';

/**
 * The 18 portable rule fields shared with the export format (RULE_KEY_ORDER in
 * `packages/cli/src/format/types.ts`). Server-managed fields (`id`, `ruleSetId`,
 * timestamps) are deliberately excluded so they can never affect sync comparison.
 */
export interface SyncRuleInput {
  pathPattern: string;
  method?: string | null;
  methods?: string[] | null;
  targetUrl?: string | null;
  stripPrefix?: boolean | null;
  order?: number | null;
  timeout?: number | null;
  preserveHost?: boolean | null;
  forwardCookies?: boolean | null;
  headerConfig?: ProxyHeaderConfig | null;
  authTransform?: AuthTransformConfig | null;
  internalRewrite?: boolean | null;
  proxyType?: string | null;
  emailHandlerConfig?: EmailHandlerConfig | null;
  pipelineConfig?: PipelineConfig | null;
  isEnabled?: boolean | null;
  debugEnabled?: boolean | null;
  description?: string | null;
}

/**
 * A live DB rule row, already DECRYPTED (`headerConfig.add` holds plaintext,
 * as returned by `ProxyRulesService.getRulesByRuleSetId`). Extra server-managed
 * fields (ruleSetId, createdAt, ...) are tolerated and ignored; `id`, when
 * present, is threaded onto matching `toUpdate` entries for the executor.
 */
export interface LiveSyncRule extends SyncRuleInput {
  id?: string;
  [serverManaged: string]: unknown;
}

/**
 * A rule with the DB import defaults applied (absent-means-default), matching
 * the defaults table in `ProxyRuleSetsService.importRuleSet`. Every portable
 * field is present; nullable fields are explicitly `null`.
 */
export interface NormalizedSyncRule {
  pathPattern: string;
  method: string | null;
  methods: string[] | null;
  targetUrl: string;
  stripPrefix: boolean;
  order: number;
  timeout: number;
  preserveHost: boolean;
  forwardCookies: boolean;
  headerConfig: ProxyHeaderConfig | null;
  authTransform: AuthTransformConfig | null;
  internalRewrite: boolean;
  proxyType: ProxyType;
  emailHandlerConfig: EmailHandlerConfig | null;
  pipelineConfig: PipelineConfig | null;
  isEnabled: boolean;
  debugEnabled: boolean;
  description: string | null;
}

/** The (pathPattern, method) match key identifying a rule within a set. */
export interface SyncRuleRef {
  pathPattern: string;
  method: string | null;
}

/** One field both sides changed differently, with each side's value so a
 *  caller can offer a choice without recomputing the merge. */
export interface SyncFieldConflict {
  /** Dotted path, e.g. `pipelineConfig.steps.draft.config.skills.enabled`. */
  field: string;
  /** The live (locally-edited) value. */
  ours: unknown;
  /** The value the incoming payload wanted. */
  theirs: unknown;
}

/** A rule whose merge left at least one genuinely contested field. */
export interface SyncPlanConflict extends SyncRuleRef {
  fields: SyncFieldConflict[];
  /** The live row's id, when the caller provided one — lets a resolver
   *  address the rule directly instead of re-matching on (path, method). */
  liveId?: string;
}

/** Rules that carried a local edit forward while still taking the payload's
 *  other changes. Reported so a clean merge isn't silent either. */
export interface SyncPlanMerged extends SyncRuleRef {
  /** Dotted paths kept from the live rule. */
  keptFields: string[];
}

export interface SyncPlanCreate extends SyncRuleRef {
  /** Defaults-normalized incoming rule, ready for insert (blank `add` values intact). */
  rule: NormalizedSyncRule;
}

export interface SyncPlanUpdate extends SyncRuleRef {
  /**
   * Defaults-normalized incoming rule. Blank (`''`) `headerConfig.add` values are
   * carried through as-is — the sync executor (Task 7) preserves the live value
   * for those header names and reports new-rule blanks in `missingSecrets[]`.
   */
  rule: NormalizedSyncRule;
  /** The live row's id, when the caller provided one. */
  liveId?: string;
}

export interface SyncPlan {
  toCreate: SyncPlanCreate[];
  toUpdate: SyncPlanUpdate[];
  unchanged: SyncRuleRef[];
  /** Live-only rules removed by this sync (only populated when `options.prune`). */
  toDelete: SyncRuleRef[];
  /** Live-only rules kept because `options.prune` is false. */
  pruneCandidates: SyncRuleRef[];
  /**
   * Locally-edited rules the incoming payload leaves untouched, kept as-is.
   * Only populated when `options.baseRules` is supplied and the policy is
   * `'preserve'` — otherwise such a rule is an ordinary update.
   */
  preserved: SyncRuleRef[];
  /**
   * Rules with at least one field both sides changed differently. `fields`
   * holds the dotted paths (e.g. `pipelineConfig.steps.draft.config.skills`).
   * Everything outside those paths is merged automatically, so a conflict here
   * means a genuine same-field disagreement, not merely "the rule changed".
   */
  conflicts: SyncPlanConflict[];
  /**
   * Rules where the payload's changes and a local edit landed in different
   * fields, so both were applied. The outcome is what you'd want, but it still
   * means the live rule isn't the one the app shipped — so it's reported.
   */
  merged: SyncPlanMerged[];
}

export interface SyncPlanOptions {
  /** When true, live-only rules go to `toDelete`; otherwise to `pruneCandidates`. */
  prune: boolean;
  /**
   * What this sync last wrote — the rules from the most recent `sync`-trigger
   * revision. Supplying it turns the two-way comparison (live vs incoming) into
   * a three-way one, which is the only way to tell "the app changed this" from
   * "the user changed this". Omit for today's two-way behaviour, which is what
   * rules-as-code CI wants: the repo is the single source of truth there.
   */
  baseRules?: SyncRuleInput[];
  /**
   * How to resolve a rule changed on both sides. `'overwrite'` (the default)
   * keeps today's behaviour — the payload wins. `'preserve'` keeps the local
   * edit. Ignored without `baseRules`.
   */
  conflictPolicy?: 'overwrite' | 'preserve';
}

/** Mirrors `PIPELINE_TARGET_URL_DEFAULT` in `packages/cli/src/format/defaults.ts`. */
const PIPELINE_TARGET_URL_DEFAULT = 'http://internal/pipeline';

/**
 * CLI-parity proxyType inference (`inferProxyType` in
 * `packages/cli/src/format/defaults.ts`): explicit proxyType always wins;
 * otherwise config-shape presence decides. Without this, a canonical payload
 * with elided defaults (the CLI decompiler strips an inferable `proxyType`)
 * would normalize a working pipeline rule to a dead `external_proxy`.
 */
function inferProxyType(rule: SyncRuleInput): ProxyType {
  if (rule.proxyType) return rule.proxyType as ProxyType;
  if (rule.pipelineConfig) return 'pipeline';
  if (rule.emailHandlerConfig) return 'email_form_handler';
  return 'external_proxy';
}

/**
 * Apply the DB import defaults (import parity: see `importRuleSet`) to a rule.
 * `??` intentionally treats explicit `null` like absent for fields whose DB
 * default is non-null, exactly as import does.
 *
 * Two deliberate divergences from import's raw defaults, both CLI-parity
 * (`applyRuleDefaults`): `proxyType` is inferred from config shape when absent,
 * and an absent `targetUrl` on a pipeline rule defaults to the internal
 * pipeline URL instead of `''`. One semantic smoothing: `methods: []` means
 * "fall back to `method`" (see the column comment in proxy-rules.schema.ts),
 * so it normalizes to `null` — a dashboard-created `[]` never registers as
 * drift against a git-authored absence.
 */
function normalizeRule(rule: SyncRuleInput, fallbackOrder: number): NormalizedSyncRule {
  const proxyType = inferProxyType(rule);
  return {
    pathPattern: rule.pathPattern,
    method: rule.method ?? null,
    methods: rule.methods && rule.methods.length > 0 ? rule.methods : null,
    targetUrl: rule.targetUrl ?? (proxyType === 'pipeline' ? PIPELINE_TARGET_URL_DEFAULT : ''),
    stripPrefix: rule.stripPrefix ?? true,
    order: rule.order ?? fallbackOrder,
    timeout: rule.timeout ?? 30000,
    preserveHost: rule.preserveHost ?? false,
    forwardCookies: rule.forwardCookies ?? false,
    headerConfig: rule.headerConfig ?? null,
    authTransform: rule.authTransform ?? null,
    internalRewrite: rule.internalRewrite ?? false,
    proxyType,
    emailHandlerConfig: rule.emailHandlerConfig ?? null,
    pipelineConfig: rule.pipelineConfig ?? null,
    isEnabled: rule.isEnabled ?? true,
    debugEnabled: rule.debugEnabled ?? false,
    description: rule.description ?? null,
  };
}

/**
 * Import-parity fallback order per rule: its index within the
 * `(order ?? 0)`-sorted list, keyed by object identity. Shared by
 * {@link computeSyncPlan} and {@link normalizeSyncRules} so both apply
 * identical defaults.
 */
function computeFallbackOrders(rules: SyncRuleInput[]): Map<SyncRuleInput, number> {
  const fallbackOrder = new Map<SyncRuleInput, number>();
  [...rules]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((rule, i) => fallbackOrder.set(rule, i));
  return fallbackOrder;
}

/**
 * Defaults-normalize a whole incoming payload, exactly as {@link computeSyncPlan}
 * does before comparison (same inference, same import-parity fallback `order`).
 * Used by the sync executor (Task 7) to compute the `source.contentHash` over
 * the plan-normalized rules — including the unchanged ones, which the plan
 * itself only returns as refs. Pure; inputs are not mutated.
 */
export function normalizeSyncRules(rules: SyncRuleInput[]): NormalizedSyncRule[] {
  const fallbackOrder = computeFallbackOrders(rules);
  return rules.map((rule) => normalizeRule(rule, fallbackOrder.get(rule)!));
}

/** Object keys whose value is not `undefined` (undefined-valued keys count as absent). */
function definedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined);
}

/**
 * Deep equality: key-order-insensitive for objects, order-sensitive for arrays,
 * value-exact otherwise (a nested `null` is NOT equal to an absent key; an
 * `undefined`-valued key IS treated as absent).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = definedKeys(aObj);
    if (aKeys.length !== definedKeys(bObj).length) return false;
    return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
  }
  return false;
}

/**
 * Compare `headerConfig.add` maps with blank-secret semantics (design decision 1):
 * the key sets must match exactly (a live header name missing from the incoming
 * map is a removal; an incoming name missing live is an addition — even when its
 * value is `''`), and per key an incoming `''` compares equal to ANY live value
 * (exports blank secrets, so a blanked value never makes a rule "changed").
 * Non-empty incoming values compare exactly.
 */
function addMapsEqual(live: Record<string, string>, incoming: Record<string, string>): boolean {
  const liveNames = Object.keys(live);
  const incomingNames = Object.keys(incoming);
  if (liveNames.length !== incomingNames.length) return false;
  return incomingNames.every(
    (name) => name in live && (incoming[name] === '' || incoming[name] === live[name]),
  );
}

/**
 * Compare header configs. `forward`/`strip` compare exactly and ORDER-SENSITIVELY —
 * they are emitted verbatim into the proxy/nginx layer, so a reorder is treated as
 * a real change rather than second-guessing downstream semantics. `add` uses
 * blank-secret semantics (see addMapsEqual). `null` vs an object is a change.
 */
function headerConfigEqual(live: ProxyHeaderConfig | null, incoming: ProxyHeaderConfig | null): boolean {
  if (live === null || incoming === null) return live === incoming;
  const liveObj = live as Record<string, unknown>;
  const incomingObj = incoming as Record<string, unknown>;
  const liveKeys = definedKeys(liveObj);
  const incomingKeys = definedKeys(incomingObj);
  if (liveKeys.length !== incomingKeys.length) return false;
  return incomingKeys.every((key) => {
    if (!(key in liveObj) || liveObj[key] === undefined) return false;
    if (key === 'add') {
      // `add: null` passes DTO validation (@IsOptional skips null) and is stored
      // verbatim, so live and incoming maps must both tolerate it: null ≡ {}.
      return addMapsEqual(
        (liveObj[key] ?? {}) as Record<string, string>,
        (incomingObj[key] ?? {}) as Record<string, string>,
      );
    }
    return deepEqual(liveObj[key], incomingObj[key]);
  });
}

/** Portable fields compared with plain deep equality (headerConfig handled separately). */
const PLAIN_COMPARE_KEYS = [
  'pathPattern',
  'method',
  'methods',
  'targetUrl',
  'stripPrefix',
  'order',
  'timeout',
  'preserveHost',
  'forwardCookies',
  'authTransform',
  'internalRewrite',
  'proxyType',
  'emailHandlerConfig',
  'pipelineConfig',
  'isEnabled',
  'debugEnabled',
  'description',
] as const satisfies readonly (keyof NormalizedSyncRule)[];

function rulesEqual(live: NormalizedSyncRule, incoming: NormalizedSyncRule): boolean {
  return (
    PLAIN_COMPARE_KEYS.every((key) => deepEqual(live[key], incoming[key])) &&
    headerConfigEqual(live.headerConfig, incoming.headerConfig)
  );
}

function matchKeyOf(rule: SyncRuleInput): string {
  return JSON.stringify([rule.pathPattern, rule.method ?? null]);
}

function describeMethod(method: string | null | undefined): string {
  return method != null ? `"${method}"` : '(any)';
}

/**
 * Compute the idempotent sync plan between the live rules of a set and an
 * incoming rules-as-code payload.
 *
 * Pure and side-effect free: no DB access, inputs are not mutated. Rules match
 * on `(pathPattern, method ?? null)` — the set's DB unique key. Before
 * comparison both sides are normalized to the 18 portable export fields with
 * the DB import defaults applied, so absent-means-default payloads compare
 * equal to freshly-imported rows and server-managed fields never register as
 * drift. `order` differences DO count as changes (they affect evaluation
 * order). Incoming rules without `order` receive the same fallback import
 * uses: their index within the (order ?? 0)-sorted incoming list.
 *
 * Live rules must arrive DECRYPTED so blank-secret comparison (decision 1)
 * can work; see headerConfigEqual/addMapsEqual for those semantics.
 *
 * @throws Error when two incoming rules share a match key (the caller should
 *   surface this as a 400 — the DB unique index would reject it anyway).
 */
export function computeSyncPlan(
  liveRules: LiveSyncRule[],
  incomingRules: SyncRuleInput[],
  options: SyncPlanOptions,
): SyncPlan {
  // Import-parity fallback order: index within the (order ?? 0)-sorted list.
  const fallbackOrder = computeFallbackOrders(incomingRules);

  const liveByKey = new Map<string, { row: LiveSyncRule; normalized: NormalizedSyncRule }>();
  for (const row of liveRules) {
    const key = matchKeyOf(row);
    // PG's unique index treats NULL methods as distinct, so two live rules can
    // legally share (pathPattern, null) and differ only by their methods[]
    // lists. The plan addresses rules by (pathPattern, method) — a last-wins
    // map here would silently overwrite one variant and orphan the other, so
    // fail loudly instead. Folding a methods signature into the match key is
    // the Phase 2 fix.
    if (liveByKey.has(key)) {
      throw new Error(
        `Live rule set has multiple rules for path pattern "${row.pathPattern}" and method ${describeMethod(
          row.method,
        )} (method-list variants); sync cannot address them by (pathPattern, method) yet — ` +
          `edit this set via the dashboard, or give each variant a distinct method`,
      );
    }
    // Live rows always carry a concrete order (NOT NULL column); fallback is inert.
    liveByKey.set(key, { row, normalized: normalizeRule(row, 0) });
  }

  // The base is only consulted for rules present on BOTH sides; a live-only
  // rule the app never wrote follows the existing prune path, not this one.
  const baseByKey = new Map<string, NormalizedSyncRule>();
  if (options.baseRules) {
    const baseFallbackOrder = computeFallbackOrders(options.baseRules);
    for (const raw of options.baseRules) {
      baseByKey.set(matchKeyOf(raw), normalizeRule(raw, baseFallbackOrder.get(raw)!));
    }
  }
  const preserveOnConflict = options.conflictPolicy === 'preserve';

  const plan: SyncPlan = {
    toCreate: [],
    toUpdate: [],
    unchanged: [],
    toDelete: [],
    pruneCandidates: [],
    preserved: [],
    conflicts: [],
    merged: [],
  };

  const seenIncoming = new Set<string>();
  const matchedLive = new Set<string>();

  for (const raw of incomingRules) {
    const key = matchKeyOf(raw);
    if (seenIncoming.has(key)) {
      throw new Error(
        `Duplicate rule for path pattern "${raw.pathPattern}" and method ${describeMethod(
          raw.method,
        )}: each (pathPattern, method) pair must be unique within the payload`,
      );
    }
    seenIncoming.add(key);

    const rule = normalizeRule(raw, fallbackOrder.get(raw)!);
    const ref: SyncRuleRef = { pathPattern: rule.pathPattern, method: rule.method };
    const liveMatch = liveByKey.get(key);

    if (!liveMatch) {
      plan.toCreate.push({ ...ref, rule });
    } else {
      matchedLive.add(key);
      if (rulesEqual(liveMatch.normalized, rule)) {
        plan.unchanged.push(ref);
        continue;
      }

      // Three-way: with a base we can attribute the difference. `userEdited`
      // means live drifted from what this sync last wrote; `payloadChanged`
      // means the incoming payload moved too.
      const baseRule = baseByKey.get(key);
      let effectiveRule = rule;
      if (baseRule) {
        const userEdited = !rulesEqual(liveMatch.normalized, baseRule);
        const payloadChanged = !rulesEqual(rule, baseRule);

        if (userEdited && !payloadChanged) {
          // Only the user moved — overwriting would discard their edit for no
          // gain, since the payload still holds the value they started from.
          plan.preserved.push(ref);
          continue;
        }
        if (userEdited && payloadChanged) {
          // Both moved, but usually in different fields (the app rewrites a
          // prompt, the user repoints a skills source). Merge per field so both
          // land; only a same-field disagreement is a real conflict.
          const { merged, conflicts, keptFromOurs } = mergeRuleThreeWay(
            baseRule,
            liveMatch.normalized,
            rule,
            preserveOnConflict ? 'preserve' : 'overwrite',
          );
          if (conflicts.length > 0) {
            plan.conflicts.push({
              ...ref,
              fields: conflicts,
              ...(liveMatch.row.id !== undefined ? { liveId: liveMatch.row.id } : {}),
            });
          }
          if (rulesEqual(liveMatch.normalized, merged)) {
            // The merge resolved entirely to what's already live.
            plan.preserved.push(ref);
            continue;
          }
          // Both sides landed. Report which fields came from the local edit so
          // a clean merge isn't silent — the live rule still isn't the one the
          // app shipped.
          if (keptFromOurs.length > 0) plan.merged.push({ ...ref, keptFields: keptFromOurs });
          effectiveRule = merged;
        }
      }

      plan.toUpdate.push({
        ...ref,
        rule: effectiveRule,
        ...(liveMatch.row.id !== undefined ? { liveId: liveMatch.row.id } : {}),
      });
    }
  }

  for (const row of liveRules) {
    if (matchedLive.has(matchKeyOf(row))) continue;
    const ref: SyncRuleRef = { pathPattern: row.pathPattern, method: row.method ?? null };
    (options.prune ? plan.toDelete : plan.pruneCandidates).push(ref);
  }

  return plan;
}
