import { ENVELOPE_KEY_ORDER, RULE_KEY_ORDER } from './types.js';
import type { ExportedRule, ExportedSchema, PipelineStep, RuleSetExport } from './types.js';

const STEP_KEY_ORDER = ['id', 'name', 'handlerType', 'config', 'isEnabled'] as const;

/** Deep-clone `value`, dropping every null/undefined value (recursively), preserving insertion order. */
function prune(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const p = prune(item);
      if (p !== undefined) out.push(p);
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = prune(v);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return value;
}

function normalizeStep(step: Record<string, unknown>): PipelineStep {
  const out: Record<string, unknown> = {};
  for (const k of STEP_KEY_ORDER) {
    if (k in step) out[k] = step[k];
  }
  return out as unknown as PipelineStep;
}

/** pipelineConfig keeps its own top-level key insertion order; only step key order is normalized. */
function normalizePipelineConfig(pc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pc)) {
    if ((k === 'steps' || k === 'postSteps') && Array.isArray(v)) {
      out[k] = v.map((s) => normalizeStep(s as Record<string, unknown>));
    } else {
      out[k] = v;
    }
  }
  return out;
}

function canonicalizeRule(rule: Record<string, unknown>): ExportedRule {
  const unknownKeys = Object.keys(rule).filter((k) => !(RULE_KEY_ORDER as readonly string[]).includes(k));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown rule key: "${unknownKeys[0]}"`);
  }
  const out: Record<string, unknown> = {};
  for (const k of RULE_KEY_ORDER) {
    if (k in rule) {
      out[k] = k === 'pipelineConfig' ? normalizePipelineConfig(rule[k] as Record<string, unknown>) : rule[k];
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
  const pruned = prune(e) as Record<string, unknown>;

  const rulesRaw = (pruned.rules as Record<string, unknown>[] | undefined) ?? [];
  const rules = sortRules(rulesRaw.map((r) => canonicalizeRule(r)));

  const schemasRaw = pruned.schemas as ExportedSchema[] | undefined;
  const schemas = schemasRaw && schemasRaw.length > 0 ? sortSchemas(schemasRaw) : undefined;

  const out: Record<string, unknown> = {};
  for (const k of ENVELOPE_KEY_ORDER) {
    if (k === 'rules') {
      out.rules = rules;
    } else if (k === 'schemas') {
      if (schemas) out.schemas = schemas;
    } else if (k in pruned) {
      out[k] = pruned[k];
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

export function exportsEquivalent(a: RuleSetExport, b: RuleSetExport): { equal: boolean; diffs: string[] } {
  const ca = canonicalizeExport(a) as unknown as Record<string, unknown>;
  const cb = canonicalizeExport(b) as unknown as Record<string, unknown>;
  delete ca.exportedAt;
  delete cb.exportedAt;
  const diffs: string[] = [];
  diffValue(ca, cb, '', diffs);
  return { equal: diffs.length === 0, diffs };
}
