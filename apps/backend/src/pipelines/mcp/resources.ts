import type { McpHandlerConfig, McpToolDecl } from '../execution/step-handler.interface';

/**
 * `ui://` resources and the listed tools of an `mcp_handler` (Phase 3 plan,
 * Decisions 13/16): URI templates (RFC 6570 level 1 — `{var}` one segment,
 * `{var+}` a slash-carrying tail), the generated `_meta.ui` CSP, and the
 * `tools/list` projection (never the `rule` mapping, never a `scope`).
 */

export const DEFAULT_RESOURCE_MIME = 'text/html;profile=mcp-app';

const VAR = /\{([a-zA-Z_][a-zA-Z0-9_]*)(\+?)\}/g;

interface Compiled {
  regex: RegExp;
  names: string[];
}

function compile(template: string): Compiled {
  const names: string[] = [];
  let source = '^';
  let last = 0;
  for (const match of template.matchAll(VAR)) {
    source += escapeRegex(template.slice(last, match.index));
    names.push(match[1]);
    source += match[2] === '+' ? '(.+)' : '([^/]+)';
    last = (match.index ?? 0) + match[0].length;
  }
  source += escapeRegex(template.slice(last)) + '$';
  return { regex: new RegExp(source), names };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The template's variables for `uri`, or null when it does not match. A `..` segment in any value is refused (null). */
export function matchTemplate(template: string, uri: string): Record<string, string> | null {
  const { regex, names } = compile(template);
  const match = uri.match(regex);
  if (!match) return null;
  const vars: Record<string, string> = {};
  names.forEach((name, i) => {
    vars[name] = match[i + 1];
  });
  for (const value of Object.values(vars)) {
    if (value.split('/').some((segment) => segment === '..' || segment === '.' || segment === ''))
      return null;
  }
  return vars;
}

/** `{var}` → encodeURIComponent(value); `{var+}` → the value with its slashes kept and each segment encoded. */
export function expandPath(pathTemplate: string, vars: Record<string, string>): string {
  return pathTemplate.replace(VAR, (_all, name: string, plus: string) => {
    const value = vars[name] ?? '';
    return plus === '+'
      ? value.split('/').map(encodeURIComponent).join('/')
      : encodeURIComponent(value);
  });
}

export interface UiMeta {
  ui: { csp: { connectDomains: string[]; resourceDomains: string[] }; prefersBorder: true };
}

/** `$app` → the request's public origin; `$storage` → the storage backend's; empties dropped. */
export function uiMeta(
  csp: NonNullable<McpHandlerConfig['resources']>['csp'] | undefined,
  origins: { app: string; storage: string },
): UiMeta {
  const resolve = (entries: string[] | undefined) =>
    (entries ?? [])
      .map((entry) =>
        entry === '$app' ? origins.app : entry === '$storage' ? origins.storage : entry,
      )
      .filter((origin) => origin !== '');
  return {
    ui: {
      csp: {
        connectDomains: resolve(csp?.connectDomains),
        resourceDomains: resolve(csp?.resourceDomains),
      },
      prefersBorder: true,
    },
  };
}

/** The `tools/list` projection of a declaration: never `rule`, `visibility: ['app']` as `_meta.ui.visibility`. */
export function listedTools(tools: McpToolDecl[]): Array<Record<string, unknown>> {
  return tools.map((tool) => {
    const meta: Record<string, unknown> = { ...(tool._meta ?? {}) };
    if (tool.visibility && tool.visibility.includes('app')) {
      const ui = (meta.ui ?? {}) as Record<string, unknown>;
      meta.ui = { ...ui, visibility: tool.visibility };
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      ...(Object.keys(meta).length ? { _meta: meta } : {}),
    };
  });
}
