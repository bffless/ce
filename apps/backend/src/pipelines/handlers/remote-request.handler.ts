import { Inject, Injectable, Logger } from '@nestjs/common';
import { StepHandler, BaseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors/configuration.error';
import { PipelineError } from '../errors/pipeline.error';
import {
  REMOTE_CONNECTIONS,
  type RemoteConnectionsPort,
} from '../../remote-connections/remote-connections.tokens';
import { RemoteTransportError } from '../../remote-connections/remote-client';
import {
  RemoteBusyError,
  RemoteResponseTooLargeError,
} from '../../remote-connections/remote-errors';

/**
 * Configuration for the remote_request handler.
 *
 * Unlike http_request there is no `url`: the target is a *named* connection an
 * admin configured on this instance (Settings → Infrastructure → Remote
 * connections), which is what supplies the base URL and the identity. A step
 * can therefore never point CE's platform credentials at an arbitrary host, and
 * an operator can move a service without touching any pipeline.
 */
export interface RemoteRequestHandlerConfig extends BaseHandlerConfig {
  /** Name of an admin-configured remote connection. */
  connection: string;

  /**
   * Path on the remote, appended to the connection's URL. Expression or
   * `{{template}}`; must resolve to something starting with `/`.
   * @default '/'
   */
  path?: string;

  /** @default 'POST' */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /**
   * Request body — an expression resolving to the payload, or a map of
   * `{ field: expression }`. Never sent on GET.
   */
  body?: string | Record<string, string>;

  /**
   * Extra headers; values are expressions. `Authorization` is rejected: the
   * connection mints its own and the transport makes it win anyway.
   */
  headers?: Record<string, string>;

  /**
   * How long CE holds the request open, in SECONDS (a remote job is allowed to
   * be slow — that is the point of this handler).
   * @default 300
   */
  timeoutSeconds?: number;

  /** Treat a non-2xx response as a step failure. @default true */
  failOnError?: boolean;

  /** Condition expression — step only runs when this is truthy. */
  condition?: string;
}

/** Always the step output, whatever the status — a later step branches on `.ok`/`.status`. */
export interface RemoteRequestOutput {
  ok: boolean;
  status: number;
  body: unknown;
  latencyMs: number;
  connection: string;
  attempts: number;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** Expression roots the evaluator understands — a path may start with one. */
const EXPRESSION_ROOTS = ['user', 'steps', 'metadata', 'request', 'deployment', 'secrets'];

export const REMOTE_REQUEST_DEFAULT_TIMEOUT_S = 300;

/** Instance-wide ceiling on how long a single remote step may hold a request open. */
export function remoteRequestMaxSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.REMOTE_REQUEST_MAX_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3600;
}

/** Cap on the response CE will buffer — a remote answers with JSON, not a file. */
export function remoteRequestMaxResponseBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.REMOTE_REQUEST_MAX_RESPONSE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 16 * 1024 * 1024;
}

/**
 * remote_request — call a service THIS instance owns through a named remote
 * connection: the connection supplies the base URL and the identity (a Google
 * ID token minted per request, or none on a private network), the shared
 * per-connection fuse bounds concurrency, and the transport retries only a
 * request the remote demonstrably never received.
 *
 * Use http_request for public third-party APIs; use this for your own private
 * services, and for long jobs — the request is HELD OPEN for the whole call.
 */
@Injectable()
export class RemoteRequestHandler implements StepHandler<RemoteRequestHandlerConfig> {
  readonly type = 'remote_request' as const;
  private readonly logger = new Logger(RemoteRequestHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    @Inject(REMOTE_CONNECTIONS) private readonly connections: RemoteConnectionsPort,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: RemoteRequestHandlerConfig): void {
    if (!config.connection || typeof config.connection !== 'string') {
      throw new ConfigurationError(
        'connection is required (the name of a remote connection configured on this instance)',
        'remote_request',
      );
    }

    if (config.method && !METHODS.includes(config.method)) {
      throw new ConfigurationError(
        `Invalid method '${config.method}'. Must be ${METHODS.join(', ')}`,
        'remote_request',
      );
    }

    if (config.path !== undefined) {
      if (typeof config.path !== 'string' || config.path.trim() === '') {
        throw new ConfigurationError('path must be a non-empty string', 'remote_request');
      }
      // A path that is neither literal-with-a-slash nor something the evaluator
      // can resolve can only ever produce a bad URL — reject it at save time.
      // Anything dynamic is checked again after evaluation (REMOTE_INVALID_PATH).
      const trimmed = config.path.trim();
      const dynamic =
        trimmed.includes('{{') ||
        EXPRESSION_ROOTS.some((root) => trimmed === root || trimmed.startsWith(`${root}.`));
      if (!trimmed.startsWith('/') && !dynamic) {
        throw new ConfigurationError(
          `path must start with '/', got: ${config.path}`,
          'remote_request',
        );
      }
    }

    if (config.timeoutSeconds !== undefined) {
      const max = remoteRequestMaxSeconds();
      if (
        typeof config.timeoutSeconds !== 'number' ||
        !Number.isFinite(config.timeoutSeconds) ||
        config.timeoutSeconds <= 0 ||
        config.timeoutSeconds > max
      ) {
        throw new ConfigurationError(
          `timeoutSeconds must be between 1 and ${max}`,
          'remote_request',
        );
      }
    }

    if (config.headers) {
      for (const key of Object.keys(config.headers)) {
        if (key.toLowerCase() === 'authorization') {
          throw new ConfigurationError(
            'headers must not set Authorization — the remote connection supplies the identity',
            'remote_request',
          );
        }
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as RemoteRequestHandlerConfig;
    const method = config.method || 'POST';

    const fail = (code: string, message: string, details?: unknown): StepResult => {
      this.logger.warn(
        `remote_request step ${step.name} failed [${code}] connection=${config.connection}: ${message}`,
      );
      return {
        success: false,
        error: details === undefined ? { code, message } : { code, message, details },
      };
    };

    const conn = this.connections.resolve(config.connection);
    if (!conn) {
      return fail(
        'REMOTE_CONNECTION_UNKNOWN',
        `No remote connection named '${config.connection}' on this instance (Admin Settings → Infrastructure → Remote connections).`,
      );
    }

    let release: () => void;
    try {
      release = this.connections.acquire(conn);
    } catch (error) {
      if (error instanceof RemoteBusyError) {
        return fail('REMOTE_BUSY', error.message);
      }
      throw error;
    }

    const timeoutMs =
      Math.min(
        config.timeoutSeconds ?? REMOTE_REQUEST_DEFAULT_TIMEOUT_S,
        remoteRequestMaxSeconds(),
      ) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const path = this.resolvePath(config.path, context, step.name);
      if (!path.startsWith('/')) {
        return fail(
          'REMOTE_INVALID_PATH',
          `path must resolve to a value starting with '/', got: ${path}`,
        );
      }

      const headers = this.buildHeaders(config, context, step.name);
      const body = this.buildBody(config, method, context, step.name);

      const response = await this.connections.client(conn).request({
        path,
        method,
        headers,
        body,
        signal: controller.signal,
        maxResponseBytes: remoteRequestMaxResponseBytes(),
      });

      const output: RemoteRequestOutput = {
        ok: response.ok,
        status: response.status,
        body: response.body,
        latencyMs: Date.now() - startedAt,
        connection: conn.name,
        attempts: response.attempts,
      };
      this.logger.log(
        `remote_request connection=${conn.name} ${method} ${path} -> ${response.status} in ${output.latencyMs}ms (attempts=${response.attempts})`,
      );

      if (!response.ok && config.failOnError !== false) {
        return fail('REMOTE_REQUEST_ERROR', `${conn.name} responded ${response.status}`, {
          status: response.status,
          body: response.body,
        });
      }

      return { success: true, output };
    } catch (error) {
      // A bad expression / bad config is the pipeline's own fault, not the
      // remote's — let it surface as itself rather than as REMOTE_UNAVAILABLE.
      if (error instanceof PipelineError) throw error;
      if (error instanceof RemoteResponseTooLargeError) {
        return fail('REMOTE_RESPONSE_TOO_LARGE', error.message);
      }
      if ((error as { name?: string } | null)?.name === 'AbortError' || controller.signal.aborted) {
        return fail(
          'REMOTE_TIMEOUT',
          `remote request to ${conn.name} timed out after ${timeoutMs} ms`,
        );
      }
      if (error instanceof RemoteTransportError) {
        return fail(
          'REMOTE_UNAVAILABLE',
          `remote connection '${conn.name}' unavailable: ${error.message}`,
          error.status !== undefined ? { status: error.status } : undefined,
        );
      }
      return fail('REMOTE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  /** `{{...}}` interpolates; anything else goes through the expression evaluator. */
  private resolvePath(raw: string | undefined, context: PipelineContext, stepName: string): string {
    if (raw === undefined || raw.trim() === '') return '/';
    if (raw.includes('{{')) {
      return this.expressionEvaluator.evaluateTemplate(raw, context, stepName);
    }
    return String(this.expressionEvaluator.evaluateExpression(raw, context, stepName));
  }

  private buildHeaders(
    config: RemoteRequestHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, expr] of Object.entries(config.headers ?? {})) {
      const resolved = this.expressionEvaluator.evaluateExpression(expr, context, stepName);
      if (resolved !== undefined && resolved !== null) {
        headers[key.toLowerCase()] = String(resolved);
      }
    }
    return headers;
  }

  private buildBody(
    config: RemoteRequestHandlerConfig,
    method: string,
    context: PipelineContext,
    stepName: string,
  ): string | undefined {
    if (method === 'GET' || config.body === undefined) return undefined;
    if (typeof config.body === 'string') {
      const resolved = this.expressionEvaluator.evaluateExpression(config.body, context, stepName);
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    }
    const resolved: Record<string, unknown> = {};
    for (const [key, expr] of Object.entries(config.body)) {
      resolved[key] = this.expressionEvaluator.evaluateExpression(expr, context, stepName);
    }
    return JSON.stringify(resolved);
  }
}
