import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { StepHandler, McpHandlerConfig, McpToolDecl } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { INVOKE_DEPTH_KEY, RuleInvokerService } from '../../proxy-rules/rule-invoker.service';
import { answer } from '../mcp/protocol';
import { matchTemplate } from '../mcp/resources';

const STORAGE_ORIGIN_TTL_MS = 5 * 60 * 1000;
const VISIBILITY = new Set(['model', 'app']);

/**
 * MCP Handler
 *
 * One step that answers as a stateless Streamable-HTTP MCP server described by
 * its config: tools and `ui://` resources mapped to sibling rules of the same
 * alias, executed in-process as the caller (`RuleInvokerService`) with the
 * sibling's own validators — so a tool's scope is whatever `auth_required`
 * on its sibling says. App-agnostic: the rule set is the server. Never a CE
 * endpoint, never `/_bffless/*`, and not CE's own platform-admin MCP server
 * (apps#554 spec 10, D22).
 */
@Injectable()
export class McpHandler implements StepHandler<McpHandlerConfig> {
  readonly type = 'mcp_handler' as const;
  private readonly logger = new Logger(McpHandler.name);
  private readonly storageOrigins = new Map<string, { origin: string; expiry: number }>();

  constructor(
    private readonly registry: StepHandlerRegistry,
    @Inject(forwardRef(() => RuleInvokerService))
    private readonly invoker: RuleInvokerService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: McpHandlerConfig): void {
    const fail = (message: string): never => {
      throw new ConfigurationError(message, 'mcp_handler');
    };
    if (
      !config.serverInfo ||
      typeof config.serverInfo.name !== 'string' ||
      typeof config.serverInfo.version !== 'string'
    ) {
      fail('serverInfo.name and serverInfo.version are required strings');
    }
    if (config.instructions !== undefined && typeof config.instructions !== 'string')
      fail('instructions must be a string');
    if (
      config.protocolVersions !== undefined &&
      (!Array.isArray(config.protocolVersions) ||
        config.protocolVersions.some((v) => typeof v !== 'string'))
    ) {
      fail('protocolVersions must be an array of strings');
    }
    if (!Array.isArray(config.tools)) fail('tools must be an array');
    const names = new Set<string>();
    for (const tool of config.tools as McpToolDecl[]) {
      if (!tool || typeof tool.name !== 'string' || tool.name === '')
        fail('each tool needs a name');
      if (names.has(tool.name)) fail(`duplicate tool name: ${tool.name}`);
      names.add(tool.name);
      if (typeof tool.description !== 'string')
        fail(`tool ${tool.name}: description must be a string`);
      if (!tool.inputSchema || typeof tool.inputSchema !== 'object')
        fail(`tool ${tool.name}: inputSchema must be an object`);
      if (!tool.rule || typeof tool.rule.path !== 'string' || !tool.rule.path.startsWith('/'))
        fail(`tool ${tool.name}: rule.path must start with /`);
      if (
        tool.rule.method !== undefined &&
        tool.rule.method !== 'GET' &&
        tool.rule.method !== 'POST'
      )
        fail(`tool ${tool.name}: rule.method must be GET or POST`);
      if (
        tool.visibility !== undefined &&
        (!Array.isArray(tool.visibility) || tool.visibility.some((v) => !VISIBILITY.has(v)))
      ) {
        fail(`tool ${tool.name}: visibility must be a subset of [model, app]`);
      }
    }
    const resources = config.resources;
    if (resources !== undefined) {
      for (const r of resources.static ?? []) {
        if (
          typeof r.uri !== 'string' ||
          typeof r.name !== 'string' ||
          typeof r.rule?.path !== 'string'
        )
          fail('each static resource needs uri, name and rule.path');
      }
      for (const t of resources.templates ?? []) {
        if (typeof t.uriTemplate !== 'string' || typeof t.rule?.path !== 'string')
          fail('each resource template needs uriTemplate and rule.path');
        if (!/\{[a-zA-Z_][a-zA-Z0-9_]*\+?\}/.test(t.uriTemplate))
          fail(`resource template ${t.uriTemplate} declares no {variable}`);
        // A template must at least match its own literal shape — a syntax check.
        matchTemplate(t.uriTemplate, t.uriTemplate.replace(/\{[^}]+\}/g, 'x'));
      }
      if (resources.list !== undefined && typeof resources.list.rule?.path !== 'string')
        fail('resources.list.rule.path is required');
      const csp = resources.csp;
      if (csp !== undefined) {
        for (const key of ['connectDomains', 'resourceDomains'] as const) {
          const list = csp[key];
          if (
            list !== undefined &&
            (!Array.isArray(list) || list.some((v) => typeof v !== 'string'))
          )
            fail(`csp.${key} must be an array of strings`);
        }
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as McpHandlerConfig;
    const request = context.request as unknown as Record<string, unknown>;
    const parentDepth =
      typeof request[INVOKE_DEPTH_KEY] === 'number' ? (request[INVOKE_DEPTH_KEY] as number) : 0;
    const host =
      firstHeader(context.metadata.headers['x-forwarded-host']) ??
      firstHeader(context.metadata.headers.host) ??
      '';

    const result = await answer(
      config,
      { method: context.metadata.method, body: context.metadata.body },
      {
        invoke: (path, method, args) =>
          this.invoker.invoke({
            projectId: context.projectId,
            alias: context.deployment?.alias,
            deployment: context.deployment,
            path,
            method,
            query: method === 'GET' ? args : undefined,
            body: method === 'POST' ? args : undefined,
            user: context.user,
            parent: context.request,
            depth: parentDepth + 1,
          }),
        origins: async () => ({
          app: host === '' ? '' : `https://${host}`,
          storage: await this.storageOrigin(context.projectId),
        }),
      },
    );

    return {
      success: true,
      terminates: true,
      output: { status: result.status, body: result.body, headers: result.headers },
    };
  }

  /** The storage backend's public origin, from a presigned GET of a probe key; cached per project. */
  private async storageOrigin(projectId: string): Promise<string> {
    const cached = this.storageOrigins.get(projectId);
    if (cached && cached.expiry > Date.now()) return cached.origin;
    let origin = '';
    try {
      const url = await this.storageAdapter.getUrl(`.mcp-csp-probe/${projectId}`, 60);
      const match = url.match(/^(https?:\/\/[^/?#]+)/i);
      origin = match ? match[1] : '';
    } catch (error) {
      this.logger.debug(`storage origin probe failed: ${String(error)}`);
    }
    this.storageOrigins.set(projectId, { origin, expiry: Date.now() + STORAGE_ORIGIN_TTL_MS });
    return origin;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first.split(',')[0].trim() : undefined;
}
