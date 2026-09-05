/**
 * The form model behind the `mcp_handler` editor.
 *
 * `normalize` turns whatever the step holds into a shape every control can
 * bind to (every optional present, every list an array); `serialize` writes
 * it back as the config the backend validates (`McpHandler.validateConfig`),
 * dropping empty optionals and the default visibility. Keys the form does not
 * model are carried through untouched on the config, each tool and each
 * resource, so a code-authored rule saved from the dashboard loses nothing.
 */

export type McpMethod = 'GET' | 'POST';
export type McpVisibility = 'model' | 'app';

export interface McpToolRule {
  path: string;
  method?: McpMethod;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  visibility: McpVisibility[];
  _meta: Record<string, unknown>;
  rule: McpToolRule;
  [extra: string]: unknown;
}

export interface McpStaticResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  rule: { path: string; method?: 'GET' };
  [extra: string]: unknown;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  rule: { path: string };
  [extra: string]: unknown;
}

export interface McpCsp {
  connectDomains: string[];
  resourceDomains: string[];
}

export interface McpResources {
  static: McpStaticResource[];
  templates: McpResourceTemplate[];
  list?: { rule: { path: string; method?: 'GET' } };
  csp: McpCsp;
  [extra: string]: unknown;
}

export interface McpConfig {
  serverInfo: { name: string; version: string };
  instructions: string;
  protocolVersions: string[];
  tools: McpTool[];
  resources: McpResources;
  [extra: string]: unknown;
}

export interface Problem {
  path: (string | number)[];
  message: string;
}

export const PROTOCOL_VERSION_DEFAULTS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function emptyTool(): McpTool {
  return {
    name: '',
    description: '',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {},
    visibility: [],
    _meta: {},
    rule: { path: '', method: 'POST' },
  };
}

export function emptyStaticResource(): McpStaticResource {
  return { uri: '', name: '', rule: { path: '' } };
}

export function emptyTemplate(): McpResourceTemplate {
  return { uriTemplate: '', name: '', rule: { path: '' } };
}

function normalizeTool(raw: unknown): McpTool {
  const t = rec(raw);
  const rule = rec(t.rule);
  const method = rule.method === 'GET' || rule.method === 'POST' ? rule.method : undefined;
  return {
    ...t,
    name: str(t.name),
    description: str(t.description),
    inputSchema: isRecord(t.inputSchema) ? t.inputSchema : {},
    annotations: rec(t.annotations),
    visibility: strList(t.visibility).filter(
      (v): v is McpVisibility => v === 'model' || v === 'app',
    ),
    _meta: rec(t._meta),
    rule: { ...rule, path: str(rule.path), method },
  };
}

function normalizeStatic(raw: unknown): McpStaticResource {
  const r = rec(raw);
  const rule = rec(r.rule);
  return {
    ...r,
    uri: str(r.uri),
    name: str(r.name),
    description: typeof r.description === 'string' ? r.description : undefined,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : undefined,
    rule: { ...rule, path: str(rule.path), method: rule.method === 'GET' ? 'GET' : undefined },
  };
}

function normalizeTemplate(raw: unknown): McpResourceTemplate {
  const r = rec(raw);
  const rule = rec(r.rule);
  return {
    ...r,
    uriTemplate: str(r.uriTemplate),
    name: str(r.name),
    description: typeof r.description === 'string' ? r.description : undefined,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : undefined,
    rule: { ...rule, path: str(rule.path) },
  };
}

export function normalize(raw: Record<string, unknown>): McpConfig {
  const serverInfo = rec(raw.serverInfo);
  const resources = rec(raw.resources);
  const csp = rec(resources.csp);
  const list = isRecord(resources.list) ? rec(resources.list.rule) : undefined;
  return {
    ...raw,
    serverInfo: { name: str(serverInfo.name), version: str(serverInfo.version) },
    instructions: str(raw.instructions),
    protocolVersions: strList(raw.protocolVersions),
    tools: Array.isArray(raw.tools) ? raw.tools.map(normalizeTool) : [],
    resources: {
      ...resources,
      static: Array.isArray(resources.static) ? resources.static.map(normalizeStatic) : [],
      templates: Array.isArray(resources.templates)
        ? resources.templates.map(normalizeTemplate)
        : [],
      list: list
        ? {
            rule: {
              ...list,
              path: str(list.path),
              method: list.method === 'GET' ? 'GET' : undefined,
            },
          }
        : undefined,
      csp: {
        ...csp,
        connectDomains: strList(csp.connectDomains),
        resourceDomains: strList(csp.resourceDomains),
      },
    },
  };
}

/** Drop keys whose value is `undefined`, and (when asked) empty objects. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

const isEmptyObject = (v: unknown) => isRecord(v) && Object.keys(v).length === 0;

/** `_meta` with empty sub-objects (`{ ui: {} }`) pruned; undefined when nothing is left. */
function pruneMeta(meta: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (isRecord(v)) {
      const inner = pruneMeta(v);
      if (inner) out[k] = inner;
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function serializeTool(t: McpTool): Record<string, unknown> {
  const { annotations, visibility, _meta, rule, ...rest } = t;
  return compact({
    ...rest,
    annotations: isEmptyObject(annotations) ? undefined : annotations,
    visibility: visibility.includes('app') ? visibility : undefined,
    _meta: pruneMeta(_meta),
    rule: compact({ ...rule }),
  });
}

function serializeResource(r: McpStaticResource | McpResourceTemplate): Record<string, unknown> {
  const { description, mimeType, rule, ...rest } = r;
  return compact({
    ...rest,
    description: description || undefined,
    mimeType: mimeType || undefined,
    rule: compact({ ...rule }),
  });
}

export function serialize(model: McpConfig): Record<string, unknown> {
  const { serverInfo, instructions, protocolVersions, tools, resources, ...rest } = model;
  const { static: statics, templates, list, csp, ...resourcesRest } = resources;
  const cspOut =
    csp.connectDomains.length || csp.resourceDomains.length
      ? compact({
          ...csp,
          connectDomains: csp.connectDomains.length ? csp.connectDomains : undefined,
          resourceDomains: csp.resourceDomains.length ? csp.resourceDomains : undefined,
        })
      : undefined;
  const resourcesOut = compact({
    ...resourcesRest,
    static: statics.length ? statics.map(serializeResource) : undefined,
    templates: templates.length ? templates.map(serializeResource) : undefined,
    list: list ? { rule: compact({ ...list.rule }) } : undefined,
    csp: cspOut,
  });
  return compact({
    ...rest,
    serverInfo: { ...serverInfo },
    instructions: instructions || undefined,
    protocolVersions: protocolVersions.length ? protocolVersions : undefined,
    tools: tools.map(serializeTool),
    resources: Object.keys(resourcesOut).length ? resourcesOut : undefined,
  });
}

const TEMPLATE_VAR = /\{[a-zA-Z_][a-zA-Z0-9_]*\+?\}/;

/** Mirrors `McpHandler.validateConfig` so the form can show what the run would refuse. */
export function validate(model: McpConfig): Problem[] {
  const problems: Problem[] = [];
  const fail = (path: Problem['path'], message: string) => problems.push({ path, message });

  if (!model.serverInfo.name || !model.serverInfo.version) {
    fail(['serverInfo'], 'serverInfo.name and serverInfo.version are required strings');
  }

  const names = new Set<string>();
  model.tools.forEach((tool, i) => {
    const label = tool.name || `#${i + 1}`;
    if (!tool.name) fail(['tools', i, 'name'], 'each tool needs a name');
    else if (names.has(tool.name)) fail(['tools', i, 'name'], `duplicate tool name: ${tool.name}`);
    names.add(tool.name);
    if (!isRecord(tool.inputSchema))
      fail(['tools', i, 'inputSchema'], `tool ${label}: inputSchema must be an object`);
    if (!tool.rule.path.startsWith('/'))
      fail(['tools', i, 'rule', 'path'], `tool ${label}: rule.path must start with /`);
  });

  model.resources.static.forEach((r, i) => {
    if (!r.uri || !r.name || !r.rule.path)
      fail(['resources', 'static', i], 'each static resource needs uri, name and rule.path');
  });
  model.resources.templates.forEach((t, i) => {
    if (!t.uriTemplate || !t.rule.path)
      fail(['resources', 'templates', i], 'each resource template needs uriTemplate and rule.path');
    else if (!TEMPLATE_VAR.test(t.uriTemplate))
      fail(
        ['resources', 'templates', i, 'uriTemplate'],
        `resource template ${t.uriTemplate} declares no {variable}`,
      );
  });
  if (model.resources.list && !model.resources.list.rule.path)
    fail(['resources', 'list', 'rule', 'path'], 'resources.list.rule.path is required');

  return problems;
}

/** The variables a template declares, in order (`{impl}`, `{path+}` → `impl`, `path`). */
export function templateVariables(template: string): string[] {
  return Array.from(template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\+?\}/g), (m) => m[1]);
}

/** Same semantics as the backend's `rule-resolution.ts` `matchesPattern`: exact or `*` glob. */
export function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (!pattern.includes('*')) return false;
  const source = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
  return new RegExp(source).test(path);
}

export interface SiblingRule {
  id: string;
  pathPattern: string;
  method: string | null;
  methods?: string[] | null;
  isEnabled: boolean;
}

/** The first enabled rule of a set that would answer `path` with `method`, as the edge resolves it. */
export function findSibling<R extends SiblingRule>(
  rules: R[],
  path: string,
  method: string = 'GET',
): R | undefined {
  const m = method.toUpperCase();
  return rules.find((rule) => {
    if (!rule.isEnabled || !matchesPattern(rule.pathPattern, path)) return false;
    if (rule.methods && rule.methods.length) return rule.methods.some((x) => x.toUpperCase() === m);
    if (rule.method) return rule.method.toUpperCase() === m;
    return true;
  });
}
