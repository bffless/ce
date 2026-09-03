export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** What an `mcp_handler` config declares, for the summary line: server name, tools, resources. */
export function summarizeMcpConfig(config: Record<string, unknown>): {
  server: string;
  tools: string[];
  staticResources: number;
  templates: number;
} {
  const serverInfo = isRecord(config.serverInfo) ? config.serverInfo : {};
  const tools = Array.isArray(config.tools)
    ? config.tools
        .map((t: unknown) => (isRecord(t) && typeof t.name === 'string' ? t.name : ''))
        .filter((n: string) => n !== '')
    : [];
  const resources = isRecord(config.resources) ? config.resources : {};
  return {
    server: typeof serverInfo.name === 'string' ? serverInfo.name : '',
    tools,
    staticResources: Array.isArray(resources.static) ? resources.static.length : 0,
    templates: Array.isArray(resources.templates) ? resources.templates.length : 0,
  };
}
