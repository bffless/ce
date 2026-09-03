import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Request } from 'express';
import { db } from '../db/client';
import { deploymentAliases, projects } from '../db/schema';
import { ProxyRule } from '../db/schema/proxy-rules.schema';
import { PipelineExecutionService } from '../pipelines/execution';
import { PipelineContext, PipelineUser } from '../pipelines/execution/pipeline-context.interface';
import { ProxyRulesService } from './proxy-rules.service';
import {
  insufficientScopeHeader,
  pipelineFromRule,
  statusForPipelineError,
} from './pipeline-from-rule';
import { findMatchingRule, resolveEffectiveRuleSetIds } from './rule-resolution';

export interface InvokeRequest {
  projectId: string;
  /** The alias whose rule sets are searched — the calling rule's own (`context.deployment.alias`). */
  alias: string | undefined;
  deployment: PipelineContext['deployment'];
  /** Public-relative, e.g. `/api/workflow/mcp-tools/status`. */
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  /** The caller — passed through unchanged; the sibling's validators judge it. */
  user: PipelineUser | undefined;
  /** The parent request: headers, cookies, ip, user-agent are copied onto the synthetic one. */
  parent: Request;
  /** The parent's depth + 1; beyond MAX_INVOKE_DEPTH is refused. */
  depth: number;
}

export interface InvokeAnswer {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  contentType: string;
}

export const MAX_INVOKE_DEPTH = 1;

export type InvokeFailure =
  | { kind: 'no_rule' }
  | { kind: 'unsupported'; proxyType: string }
  | { kind: 'recursion' }
  | { kind: 'error'; message: string };

export type InvokeResult =
  | { ok: true; answer: InvokeAnswer }
  | { ok: false; failure: InvokeFailure };

/** Marker the synthetic request carries so a sibling that is itself an `mcp_handler` can refuse to recurse. */
export const INVOKE_DEPTH_KEY = '__invokeDepth';

const RULE_CACHE_TTL = 10_000;
const DROPPED_HEADERS = new Set(['content-length', 'host', 'transfer-encoding']);

/**
 * Execute a sibling rule of the same alias in-process, as the caller (Phase 3
 * plan, Decision 14). The rule is resolved exactly as the edge resolves it
 * (`rule-resolution.ts`), its validators run, the visibility gate does not
 * (the caller already passed it for this alias), and the answer is the
 * `{ status, body, headers }` the edge would have sent.
 */
@Injectable()
export class RuleInvokerService {
  private readonly logger = new Logger(RuleInvokerService.name);
  private readonly ruleCache = new Map<string, { rules: ProxyRule[]; expiry: number }>();

  constructor(
    @Inject(forwardRef(() => ProxyRulesService))
    private readonly proxyRulesService: ProxyRulesService,
    @Inject(forwardRef(() => PipelineExecutionService))
    private readonly pipelineExecutionService: PipelineExecutionService,
  ) {}

  async invoke(req: InvokeRequest): Promise<InvokeResult> {
    if (req.depth > MAX_INVOKE_DEPTH) return { ok: false, failure: { kind: 'recursion' } };

    const rule = await this.resolveRule(req);
    if (!rule) return { ok: false, failure: { kind: 'no_rule' } };

    const proxyType =
      rule.proxyType && rule.proxyType !== 'external_proxy'
        ? rule.proxyType
        : rule.internalRewrite
          ? 'internal_rewrite'
          : 'external_proxy';

    if (proxyType === 'pipeline') return this.invokePipeline(rule, req);
    if (proxyType === 'external_proxy') return this.invokeExternal(rule, req);
    return { ok: false, failure: { kind: 'unsupported', proxyType } };
  }

  private async resolveRule(req: InvokeRequest): Promise<ProxyRule | null> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, req.projectId))
      .limit(1);
    if (!project) return null;
    let alias: { id: string; proxyRuleSetId: string | null } | null = null;
    if (req.alias) {
      const [row] = await db
        .select()
        .from(deploymentAliases)
        .where(
          and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, req.alias)),
        )
        .limit(1);
      if (row) alias = { id: row.id, proxyRuleSetId: row.proxyRuleSetId };
    }
    const ids = await resolveEffectiveRuleSetIds(
      { id: project.id, defaultProxyRuleSetId: project.defaultProxyRuleSetId },
      alias,
    );
    if (ids.length === 0) return null;
    const rules = await this.cachedRules(ids);
    return findMatchingRule(rules, req.path, req.method);
  }

  private async cachedRules(ids: string[]): Promise<ProxyRule[]> {
    const key = ids.join(',');
    const cached = this.ruleCache.get(key);
    if (cached && cached.expiry > Date.now()) return cached.rules;
    const rules = await this.proxyRulesService.getEffectiveRulesForMultipleRuleSets(ids);
    this.ruleCache.set(key, { rules, expiry: Date.now() + RULE_CACHE_TTL });
    return rules;
  }

  private async invokePipeline(rule: ProxyRule, req: InvokeRequest): Promise<InvokeResult> {
    const pipeline = pipelineFromRule(rule, req.projectId);
    if (!pipeline)
      return { ok: false, failure: { kind: 'error', message: 'Pipeline configuration missing' } };
    if (pipeline.steps.some((step) => step.handlerType === 'mcp_handler')) {
      return { ok: false, failure: { kind: 'recursion' } };
    }

    const synthetic = this.syntheticRequest(req);
    const result = await this.pipelineExecutionService.executePipelineWithDebug(
      pipeline,
      synthetic,
      req.user,
      { deployment: req.deployment, captureDebug: false },
    );

    if (result.success && result.response) {
      const headers = { ...(result.response.headers ?? {}) };
      return {
        ok: true,
        answer: {
          status: result.response.status,
          body: result.response.body,
          headers,
          contentType: headers['Content-Type'] ?? headers['content-type'] ?? 'application/json',
        },
      };
    }
    const status = statusForPipelineError(result.error?.code);
    const headers: Record<string, string> = {};
    const scope = insufficientScopeHeader(result.error);
    if (scope) headers['WWW-Authenticate'] = scope;
    return {
      ok: true,
      answer: {
        status,
        body: { success: false, error: result.error },
        headers,
        contentType: 'application/json',
      },
    };
  }

  /**
   * An `external_proxy` sibling: the in-process fetch the forwarder would make,
   * with the caller's cookie and authorization carried onward and the two
   * headers CE's own routing reads (`x-forwarded-host`, `x-original-uri`).
   */
  private async invokeExternal(rule: ProxyRule, req: InvokeRequest): Promise<InvokeResult> {
    let target: URL;
    try {
      target = buildTargetUrl(rule, req.path);
    } catch (error) {
      return { ok: false, failure: { kind: 'error', message: `bad targetUrl: ${String(error)}` } };
    }
    for (const [key, value] of Object.entries(req.query ?? {})) {
      target.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    const parent = req.parent.headers;
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'x-forwarded-host': first(parent['x-forwarded-host']) ?? first(parent.host) ?? '',
      'x-original-uri': req.path,
    };
    const cookie = first(parent.cookie);
    if (cookie) headers.cookie = cookie;
    const authorization = first(parent.authorization);
    if (authorization) headers.authorization = authorization;
    const hasBody = req.body !== undefined && req.method !== 'GET';
    if (hasBody) headers['content-type'] = 'application/json';
    try {
      const res = await fetch(target, {
        method: req.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
        signal: AbortSignal.timeout(rule.timeout ?? 30_000),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const text = await res.text();
      let body: unknown = text;
      if (contentType.includes('json')) {
        try {
          body = text === '' ? null : JSON.parse(text);
        } catch {
          body = text;
        }
      }
      const answerHeaders: Record<string, string> = {};
      const wwwAuth = res.headers.get('www-authenticate');
      if (wwwAuth) answerHeaders['WWW-Authenticate'] = wwwAuth;
      return {
        ok: true,
        answer: { status: res.status, body, headers: answerHeaders, contentType },
      };
    } catch (error) {
      return {
        ok: false,
        failure: { kind: 'error', message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * The request a sibling pipeline sees: the parent's headers (minus the ones
   * that describe the parent's own body), cookies, ip and user agent, with the
   * sibling's path/method/query/body. Deliberately no `res`: a streaming
   * handler falls back to its non-streaming branch, and file serving refuses.
   */
  private syntheticRequest(req: InvokeRequest): Request {
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.parent.headers)) {
      if (!DROPPED_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
    }
    headers['content-type'] = 'application/json';
    const query = req.query ?? {};
    const qs = Object.keys(query).length
      ? '?' +
        Object.entries(query)
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`,
          )
          .join('&')
      : '';
    // The edge rewrites a domain request to `/public/<owner>/<repo>/alias/<a>/<dir><public path>`
    // and keeps the public path in `x-original-uri`; a sibling sees the same shape, so a
    // function that derives the alias's in-process base from `request.path` (the way the
    // Workflow prototype did) keeps working — and CE's routing reads the two headers.
    const prefix = publicPrefixOf(req.parent);
    headers['x-original-uri'] = `${req.path}${qs}`;
    const synthetic = {
      path: `${prefix}${req.path}`,
      method: req.method,
      url: `${prefix}${req.path}${qs}`,
      originalUrl: `${prefix}${req.path}${qs}`,
      headers,
      query,
      body: req.body ?? {},
      cookies: (req.parent as Request & { cookies?: unknown }).cookies ?? {},
      ip: req.parent.ip,
      socket: req.parent.socket,
      protocol: req.parent.protocol,
      secure: req.parent.secure,
      get: (name: string) => {
        const value = headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
      header: (name: string) => {
        const value = headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
      [INVOKE_DEPTH_KEY]: req.depth,
    };
    return synthetic as unknown as Request;
  }
}

/**
 * `/public/<owner>/<repo>/alias/<a>/<dir>` from the parent: its `path` minus the
 * public-relative path `x-original-uri` carries (query dropped). `''` when the
 * parent was not a rewritten domain request.
 */
export function publicPrefixOf(parent: Request): string {
  const path = typeof parent.path === 'string' ? parent.path : '';
  if (!path.startsWith('/public/')) return '';
  const original = first(parent.headers['x-original-uri']);
  const originalPath = original ? original.split('?')[0] : '';
  if (originalPath !== '' && path.endsWith(originalPath))
    return path.slice(0, -originalPath.length);
  return '';
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `ProxyService.buildTargetUrl`'s rule, restated for the invoker (that one is private and needs an Express request). */
export function buildTargetUrl(rule: ProxyRule, subpath: string): URL {
  const baseUrl = new URL(rule.targetUrl);
  const append = rule.stripPrefix ? stripMatchedPrefix(rule.pathPattern, subpath) : subpath;
  return new URL(joinPaths(baseUrl.pathname, append), baseUrl.origin);
}

function joinPaths(basePath: string, appendPath: string): string {
  if (appendPath === '') return basePath;
  const normalizedBase = basePath.replace(/\/+$/, '');
  const normalizedAppend = appendPath.startsWith('/') ? appendPath : '/' + appendPath;
  if (!normalizedBase) return normalizedAppend;
  return normalizedBase + normalizedAppend;
}

function stripMatchedPrefix(pattern: string, path: string): string {
  // Verbatim ProxyService.stripMatchedPrefix
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    if (path.startsWith(prefix + '/')) {
      return path.substring(prefix.length) || '/';
    }
    if (path === prefix) {
      return '/';
    }
  }
  if (path === pattern) {
    return '';
  }
  return path;
}
