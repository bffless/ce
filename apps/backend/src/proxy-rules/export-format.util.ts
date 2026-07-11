import type {
  AuthTransformConfig,
  EmailHandlerConfig,
  PipelineConfig,
  ProxyHeaderConfig,
  ProxyRule,
  ProxyType,
} from '../db/schema/proxy-rules.schema';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';

/**
 * Canonical proxy-rule-set export format (server side).
 *
 * GROUND TRUTH: `packages/cli/src/format/types.ts` — the key-order constants and
 * exported shapes below must stay byte-identical with the CLI's `RULE_KEY_ORDER` /
 * `ENVELOPE_KEY_ORDER` so a server export is accepted verbatim by the CLI
 * canonicalizer. The types are duplicated (not imported) because the backend must
 * not depend on the CLI package at runtime.
 *
 * Null/undefined stripping applies at structural levels only (rule top level,
 * ruleSet keys, envelope keys). Values nested *inside* those keys (headerConfig
 * internals, authTransform, emailHandlerConfig, pipelineConfig, step configs) are
 * free-form user data and pass through verbatim, nulls included — mirroring
 * `packages/cli/src/format/canonical.ts`.
 */

/** Exported rule key order. 18 keys — `methods` inclusion is the #448 fix. */
export const RULE_KEY_ORDER = [
  'pathPattern',
  'method',
  'methods',
  'targetUrl',
  'stripPrefix',
  'order',
  'timeout',
  'preserveHost',
  'forwardCookies',
  'headerConfig',
  'authTransform',
  'internalRewrite',
  'proxyType',
  'emailHandlerConfig',
  'pipelineConfig',
  'isEnabled',
  'debugEnabled',
  'description',
] as const;

/** Envelope key order. `schemas` is last and omitted entirely when empty. */
export const ENVELOPE_KEY_ORDER = [
  'version',
  'exportedAt',
  'kind',
  'ruleSet',
  'rules',
  'schemas',
] as const;

/** Bundled schema definition (name + fields only, no data rows). */
export interface ExportedSchema {
  id: string;
  name: string;
  fields: SchemaField[];
}

/**
 * A single rule in the export envelope. Mirrors the CLI's `ExportedRule`:
 * only portable config — server-managed fields (`id`, `ruleSetId`, timestamps)
 * never appear.
 */
export interface ExportedRule {
  pathPattern: string;
  method?: string;
  methods?: string[];
  targetUrl: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: ProxyHeaderConfig;
  authTransform?: AuthTransformConfig;
  internalRewrite?: boolean;
  proxyType?: ProxyType;
  emailHandlerConfig?: EmailHandlerConfig;
  pipelineConfig?: PipelineConfig;
  isEnabled?: boolean;
  debugEnabled?: boolean;
  description?: string;
}

/** The v2 export envelope. Mirrors the CLI's `RuleSetExport`. */
export interface RuleSetExport {
  version: 2;
  exportedAt: string;
  kind: 'bffless-proxy-rule-set';
  ruleSet: { name: string; description?: string; environment?: string };
  rules: ExportedRule[];
  schemas?: ExportedSchema[];
}

/**
 * Header `add` values can hold secrets (API keys, bearer tokens) and reach this
 * code DECRYPTED (`getRulesByRuleSetId` decrypts them). We deliberately do NOT
 * export their values — exports keep the header names but blank every value to
 * `''`, so the user re-enters secrets after import (sync preserves live values
 * for blanked entries — decision 1 in the Phase 1 plan). `forward`/`strip`
 * arrays pass through untouched; `null`/`undefined` input → `undefined` output
 * so the key is dropped at the rule top level.
 */
export function sanitizeHeaderConfigForExport(
  headerConfig: ProxyHeaderConfig | null | undefined,
): ProxyHeaderConfig | undefined {
  if (headerConfig === null || headerConfig === undefined) return undefined;
  if (!headerConfig.add) return headerConfig;
  const blankedAdd: Record<string, string> = {};
  for (const key of Object.keys(headerConfig.add)) {
    blankedAdd[key] = '';
  }
  return { ...headerConfig, add: blankedAdd };
}

/**
 * Serialize a DB proxy-rule row into its canonical exported form: emit exactly
 * the `RULE_KEY_ORDER` keys, in that order, dropping `null`/`undefined` at the
 * rule top level only. `headerConfig` goes through
 * {@link sanitizeHeaderConfigForExport}; all other nested objects
 * (`pipelineConfig`, `authTransform`, `emailHandlerConfig`) pass through
 * verbatim, including any nested nulls. Server-managed fields (`id`,
 * `ruleSetId`, `createdAt`, `updatedAt`) are never emitted.
 */
export function serializeRuleForExport(rule: Partial<ProxyRule>): ExportedRule {
  const out: Record<string, unknown> = {};
  for (const key of RULE_KEY_ORDER) {
    const value =
      key === 'headerConfig'
        ? sanitizeHeaderConfigForExport(rule.headerConfig)
        : (rule as Record<string, unknown>)[key];
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out as unknown as ExportedRule;
}

export interface BuildExportEnvelopeInput {
  /** Rule set metadata; `description`/`environment` may be null (DB shape) and are stripped. */
  ruleSet: { name: string; description?: string | null; environment?: string | null };
  /**
   * ALREADY-SERIALIZED rules — the caller runs each DB row through
   * {@link serializeRuleForExport} first (Task 2 needs the serialized form for
   * `collectSchemaIds` anyway). Passed through verbatim; raw DB rows are NOT
   * accepted here.
   */
  rules: ExportedRule[];
  /** Bundled schema definitions; the `schemas` key is omitted when empty/undefined. */
  schemas?: ExportedSchema[];
  /** ISO-8601 timestamp for the export. */
  exportedAt: string;
}

/**
 * Canonical rule sort — mirrors `sortRules` in `packages/cli/src/format/canonical.ts`:
 * `(order ?? 0, pathPattern, method ?? '')`. The DB query's `asc(order)` alone has no
 * tie-break, so without this the envelope byte-order would depend on insertion order.
 */
function canonicalRuleCompare(a: ExportedRule, b: ExportedRule): number {
  const oa = a.order ?? 0;
  const ob = b.order ?? 0;
  if (oa !== ob) return oa - ob;
  if (a.pathPattern !== b.pathPattern) return a.pathPattern < b.pathPattern ? -1 : 1;
  const ma = a.method ?? '';
  const mb = b.method ?? '';
  if (ma !== mb) return ma < mb ? -1 : 1;
  return 0;
}

/**
 * Build the v2 export envelope with keys in `ENVELOPE_KEY_ORDER`. `ruleSet`
 * keys with `null`/`undefined` values are stripped (structural level); the
 * `schemas` key is omitted entirely when the list is empty or undefined.
 *
 * The output is byte-canonical per the CLI canonicalizer: rules are sorted by
 * `(order, pathPattern, method)` and schemas by name, so
 * `canonicalizeExport(envelope)` is a no-op on it.
 */
export function buildExportEnvelope(input: BuildExportEnvelopeInput): RuleSetExport {
  const ruleSet: RuleSetExport['ruleSet'] = { name: input.ruleSet.name };
  if (input.ruleSet.description !== null && input.ruleSet.description !== undefined) {
    ruleSet.description = input.ruleSet.description;
  }
  if (input.ruleSet.environment !== null && input.ruleSet.environment !== undefined) {
    ruleSet.environment = input.ruleSet.environment;
  }

  const envelope: RuleSetExport = {
    version: 2,
    exportedAt: input.exportedAt,
    kind: 'bffless-proxy-rule-set',
    ruleSet,
    rules: [...input.rules].sort(canonicalRuleCompare),
  };
  if (input.schemas && input.schemas.length > 0) {
    // CLI canonical form sorts bundled schemas by name (sortSchemas).
    envelope.schemas = [...input.schemas].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }
  return envelope;
}
