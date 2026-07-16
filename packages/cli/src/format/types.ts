export interface SchemaField { name: string; type: string; required?: boolean; [k: string]: unknown }
export interface ExportedSchema { id: string; name: string; fields: SchemaField[] }
export interface PipelineValidator { type: 'auth_required' | 'rate_limit'; config?: Record<string, unknown> }
/** `name` is an optional display label — the server treats it as optional, and dashboard-authored steps may omit it. */
export interface PipelineStep { id?: string; name?: string; handlerType: string; config: Record<string, unknown>; isEnabled?: boolean }
export interface PipelineConfig { name: string; description?: string; steps: PipelineStep[]; postSteps?: PipelineStep[]; validators?: PipelineValidator[] }
export interface HeaderConfig { forward?: string[]; strip?: string[]; add?: Record<string, string> }
export type ProxyType = 'external_proxy' | 'internal_rewrite' | 'email_form_handler' | 'pipeline';

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
  headerConfig?: HeaderConfig;
  authTransform?: Record<string, unknown>;
  internalRewrite?: boolean;
  proxyType?: ProxyType;
  emailHandlerConfig?: Record<string, unknown>;
  pipelineConfig?: PipelineConfig;
  isEnabled?: boolean;
  debugEnabled?: boolean;
  description?: string;
}

export interface RuleSetExport {
  version: 2;
  exportedAt: string;
  kind: 'bffless-proxy-rule-set';
  ruleSet: { name: string; description?: string; environment?: string };
  rules: ExportedRule[];
  schemas?: ExportedSchema[];
}

export const RULE_KEY_ORDER = ['pathPattern','method','methods','targetUrl','stripPrefix','order','timeout','preserveHost','forwardCookies','headerConfig','authTransform','internalRewrite','proxyType','emailHandlerConfig','pipelineConfig','isEnabled','debugEnabled','description'] as const;
export const ENVELOPE_KEY_ORDER = ['version','exportedAt','kind','ruleSet','rules','schemas'] as const;
