import { ENVELOPE_KEY_ORDER, RULE_KEY_ORDER } from './types.js';
import type { ExportedRule, ExportedSchema, PipelineStep, RuleSetExport } from './types.js';
import { applyRuleDefaults } from './defaults.js';

const STEP_KEY_ORDER = ['id', 'name', 'handlerType', 'config', 'isEnabled'] as const;

/**
 * Structural levels where null/undefined stripping applies: envelope keys, ruleSet keys,
 * rule top-level keys, pipeline-step top-level keys, pipelineConfig top-level keys, and
 * schemas[] entry top-level keys. Values nested *inside* those keys (headerConfig,
 * authTransform, emailHandlerConfig, steps[].config, schemas[].fields[], etc.) are
 * free-form user data and must pass through verbatim, nulls included.
 */
function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function assertKnownKeys(rawKeys: string[], known: readonly string[], label: string): void {
  const unknownKeys = rawKeys.filter((k) => !known.includes(k));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown ${label} key: "${unknownKeys[0]}"`);
  }
}

function normalizeStep(step: Record<string, unknown>): PipelineStep {
  assertKnownKeys(Object.keys(step), STEP_KEY_ORDER, 'step');
  const stripped = stripNulls(step);
  const out: Record<string, unknown> = {};
  for (const k of STEP_KEY_ORDER) {
    if (k in stripped) out[k] = structuredClone(stripped[k]);
  }
  return out as unknown as PipelineStep;
}

/** pipelineConfig keeps its own top-level key insertion order; only step key order is normalized. */
function normalizePipelineConfig(pc: Record<string, unknown>): Record<string, unknown> {
  const stripped = stripNulls(pc);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stripped)) {
    if ((k === 'steps' || k === 'postSteps') && Array.isArray(v)) {
      out[k] = v.map((s) => normalizeStep(s as Record<string, unknown>));
    } else {
      out[k] = structuredClone(v);
    }
  }
  return out;
}

function normalizeSchemaEntry(entry: Record<string, unknown>): ExportedSchema {
  const stripped = stripNulls(entry);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stripped)) {
    out[k] = structuredClone(v);
  }
  return out as unknown as ExportedSchema;
}

function normalizeRuleSet(ruleSet: Record<string, unknown>): Record<string, unknown> {
  const stripped = stripNulls(ruleSet);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stripped)) {
    out[k] = structuredClone(v);
  }
  return out;
}

function canonicalizeRule(rule: Record<string, unknown>): ExportedRule {
  // Unknown-key validation runs against the RAW pre-strip key set so a null-valued
  // unknown key (which stripNulls would otherwise silently drop) still throws.
  assertKnownKeys(Object.keys(rule), RULE_KEY_ORDER, 'rule');
  const stripped = stripNulls(rule);
  const out: Record<string, unknown> = {};
  for (const k of RULE_KEY_ORDER) {
    if (k in stripped) {
      out[k] =
        k === 'pipelineConfig'
          ? normalizePipelineConfig(stripped[k] as Record<string, unknown>)
          : structuredClone(stripped[k]);
    }
  }
  return out as unknown as ExportedRule;
}

function ruleSortKey(r: ExportedRule): [number, string, string] {
  return [r.order ?? 0, r.pathPattern, r.method ?? ''];
}

function sortRules(rules: ExportedRule[]): ExportedRule[] {
  return [...rules].sort((a, b) => {
    const [oa, pa, ma] = ruleSortKey(a);
    const [ob, pb, mb] = ruleSortKey(b);
    if (oa !== ob) return oa - ob;
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (ma !== mb) return ma < mb ? -1 : 1;
    return 0;
  });
}

function sortSchemas(schemas: ExportedSchema[]): ExportedSchema[] {
  return [...schemas].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function canonicalizeExport(e: RuleSetExport): RuleSetExport {
  const raw = e as unknown as Record<string, unknown>;
  // Unknown-key validation runs against the RAW pre-strip key set so a null-valued
  // unknown key still throws.
  assertKnownKeys(Object.keys(raw), ENVELOPE_KEY_ORDER, 'export');
  const stripped = stripNulls(raw);

  const rulesRaw = (stripped.rules as Record<string, unknown>[] | undefined) ?? [];
  const rules = sortRules(rulesRaw.map((r) => canonicalizeRule(r)));

  const schemasRaw = stripped.schemas as Record<string, unknown>[] | undefined;
  const schemas =
    schemasRaw && schemasRaw.length > 0 ? sortSchemas(schemasRaw.map((s) => normalizeSchemaEntry(s))) : undefined;

  const out: Record<string, unknown> = {};
  for (const k of ENVELOPE_KEY_ORDER) {
    if (k === 'rules') {
      out.rules = rules;
    } else if (k === 'schemas') {
      if (schemas) out.schemas = schemas;
    } else if (k === 'ruleSet') {
      if ('ruleSet' in stripped) out.ruleSet = normalizeRuleSet(stripped.ruleSet as Record<string, unknown>);
    } else if (k in stripped) {
      out[k] = stripped[k];
    }
  }
  return out as unknown as RuleSetExport;
}

export function stringifyExport(e: RuleSetExport): string {
  return JSON.stringify(canonicalizeExport(e), null, 2) + '\n';
}

function diffRulesArray(a: ExportedRule[], b: ExportedRule[], diffs: string[]): void {
  const keyOf = (r: ExportedRule) => `${r.pathPattern} ${r.method ?? ''}`;
  const mapA = new Map(a.map((r) => [keyOf(r), r] as const));
  const mapB = new Map(b.map((r) => [keyOf(r), r] as const));
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  for (const k of keys) {
    const path = `rules[${k}]`;
    const ra = mapA.get(k);
    const rb = mapB.get(k);
    if (ra === undefined) {
      diffs.push(`${path}: missing in a`);
      continue;
    }
    if (rb === undefined) {
      diffs.push(`${path}: missing in b`);
      continue;
    }
    diffValue(ra, rb, path, diffs);
  }
}

function diffValue(a: unknown, b: unknown, path: string, diffs: string[]): void {
  if (a === b) return;
  const aIsObj = a !== null && typeof a === 'object';
  const bIsObj = b !== null && typeof b === 'object';
  if (!aIsObj || !bIsObj) {
    diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr || bIsArr) {
    if (!aIsArr || !bIsArr) {
      diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
      return;
    }
    if (path === 'rules') {
      diffRulesArray(a as ExportedRule[], b as ExportedRule[], diffs);
      return;
    }
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diffValue((a as unknown[])[i], (b as unknown[])[i], `${path}[${i}]`, diffs);
    }
    return;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    const childPath = path ? `${path}.${k}` : k;
    diffValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], childPath, diffs);
  }
}

/**
 * Different exporter eras disagree on whether default-valued rule keys (e.g. `internalRewrite`,
 * `debugEnabled`) are emitted at all vs. explicit `false`. Absent-means-default is the DB import's
 * own semantics (Task 3), so equivalence must be judged on each rule's defaults-complete form, not
 * raw key presence.
 */
function normalizeRulesForComparison(rules: unknown): unknown {
  if (!Array.isArray(rules)) return rules;
  return rules.map((r) => applyRuleDefaults(r as Partial<ExportedRule> & { pathPattern: string }));
}

export function exportsEquivalent(a: RuleSetExport, b: RuleSetExport): { equal: boolean; diffs: string[] } {
  const ca = canonicalizeExport(a) as unknown as Record<string, unknown>;
  const cb = canonicalizeExport(b) as unknown as Record<string, unknown>;
  delete ca.exportedAt;
  delete cb.exportedAt;
  if ('rules' in ca) ca.rules = normalizeRulesForComparison(ca.rules);
  if ('rules' in cb) cb.rules = normalizeRulesForComparison(cb.rules);
  const diffs: string[] = [];
  diffValue(ca, cb, '', diffs);
  return { equal: diffs.length === 0, diffs };
}
