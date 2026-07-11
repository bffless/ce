import type { ExportedRule, ProxyType } from './types.js';

export const PIPELINE_TARGET_URL_DEFAULT = 'http://internal/pipeline';

/** Boilerplate defaults injected by the compiler and elided by the decompiler. */
export const RULE_DEFAULTS = {
  stripPrefix: true,
  timeout: 30000,
  preserveHost: false,
  forwardCookies: false,
  internalRewrite: false,
  isEnabled: true,
  debugEnabled: false,
  proxyType: 'external_proxy' as ProxyType,
} as const;

type DefaultKey = Exclude<keyof typeof RULE_DEFAULTS, 'proxyType'>;
const DEFAULT_KEYS = (Object.keys(RULE_DEFAULTS) as (keyof typeof RULE_DEFAULTS)[]).filter(
  (k): k is DefaultKey => k !== 'proxyType',
);

/** proxyType inferred from config-shape presence alone; explicit proxyType always wins over this. */
function inferProxyType(rule: { proxyType?: ProxyType; pipelineConfig?: unknown; emailHandlerConfig?: unknown }): ProxyType {
  if (rule.proxyType) return rule.proxyType;
  if (rule.pipelineConfig) return 'pipeline';
  if (rule.emailHandlerConfig) return 'email_form_handler';
  return RULE_DEFAULTS.proxyType;
}

export function applyRuleDefaults(partial: Partial<ExportedRule> & { pathPattern: string }): ExportedRule {
  const proxyType = inferProxyType(partial);
  const out: Record<string, unknown> = { ...partial, proxyType };
  for (const k of DEFAULT_KEYS) {
    if (out[k] === undefined) out[k] = RULE_DEFAULTS[k];
  }
  if (out.targetUrl === undefined && proxyType === 'pipeline') {
    out.targetUrl = PIPELINE_TARGET_URL_DEFAULT;
  }
  return out as unknown as ExportedRule;
}

export function elideRuleDefaults(rule: ExportedRule): Partial<ExportedRule> {
  const out: Partial<ExportedRule> = { ...rule };
  for (const k of DEFAULT_KEYS) {
    if (out[k] === RULE_DEFAULTS[k]) delete out[k];
  }

  const derivedProxyType = inferProxyType({ pipelineConfig: rule.pipelineConfig, emailHandlerConfig: rule.emailHandlerConfig });
  if (rule.proxyType === derivedProxyType) delete out.proxyType;

  const effectiveProxyType = rule.proxyType ?? derivedProxyType;
  if (effectiveProxyType === 'pipeline' && rule.targetUrl === PIPELINE_TARGET_URL_DEFAULT) delete out.targetUrl;

  return out;
}
