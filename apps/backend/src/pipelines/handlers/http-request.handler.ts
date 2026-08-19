import { Injectable, Logger } from '@nestjs/common';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

/**
 * Configuration for http_request handler
 */
export interface HttpRequestHandlerConfig {
  /**
   * Target URL (can be expression, e.g., "https://example.com/api/resource")
   */
  url: string;

  /**
   * HTTP method
   * @default 'GET'
   */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /**
   * Forward auth cookies from the original request to the target.
   * Sends the Cookie header from the incoming request.
   * @default false
   */
  forwardAuth?: boolean;

  /**
   * Request body - expression that resolves to the body payload.
   * For non-GET requests. Can be an object expression (e.g., "steps.validate")
   * or a static JSON string.
   */
  body?: string | Record<string, string>;

  /**
   * Additional headers to send with the request.
   * Values can be expressions (e.g., { "X-API-Key": "steps.config.apiKey" })
   * or static strings. Similar to proxy rule headerConfig.add.
   */
  headers?: Record<string, string>;

  /**
   * Headers to forward from the original request.
   * Similar to proxy rule headerConfig.forward.
   * Common: ['authorization', 'content-type']
   */
  forwardHeaders?: string[];

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Condition expression - if provided, step only runs if this evaluates to true
   */
  condition?: string;

  /**
   * Whether to treat non-2xx HTTP responses as step failures.
   *
   * - `true` (default, backward compat): a 4xx/5xx response halts the pipeline
   *   with an `HTTP_REQUEST_ERROR` step error. The client sees a 500.
   * - `false`: any HTTP response (including 4xx/5xx) is returned as a successful
   *   step output of shape `{ ok, status, statusText, body }`. The pipeline
   *   continues; the next step can branch on `steps.<name>.ok` or
   *   `steps.<name>.status`. Useful for health checks, polling probes, and any
   *   case where a non-2xx is a normal outcome rather than an error.
   *
   * Network errors (DNS, connection refused, TLS) and timeouts still fail the
   * step regardless of this flag — those are genuine errors, not response
   * outcomes.
   *
   * @default true
   */
  failOnError?: boolean;
}

/**
 * Output shape when `failOnError: false`. Always returned for any HTTP
 * response (2xx or otherwise) so subsequent steps can inspect status.
 */
export interface HttpRequestSafeOutput {
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
}

const DEFAULT_TIMEOUT = 30000;
const MAX_TIMEOUT = 120000;

/**
 * HTTP Request Handler
 *
 * Makes outbound HTTP requests from pipeline steps. Useful for calling
 * external APIs or endpoints on other projects (e.g., cross-project
 * credit checks, webhooks, third-party integrations).
 *
 * Supports forwarding auth cookies/headers from the original request
 * and adding custom headers (similar to proxy rule header config).
 */
@Injectable()
export class HttpRequestHandler implements StepHandler<HttpRequestHandlerConfig> {
  readonly type = 'http_request' as const;
  private readonly logger = new Logger(HttpRequestHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: HttpRequestHandlerConfig): void {
    if (!config.url) {
      throw new ConfigurationError('url is required', 'http_request');
    }

    if (config.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(config.method)) {
      throw new ConfigurationError(
        `Invalid method '${config.method}'. Must be GET, POST, PUT, PATCH, or DELETE`,
        'http_request',
      );
    }

    if (config.timeout !== undefined) {
      if (
        typeof config.timeout !== 'number' ||
        config.timeout < 1000 ||
        config.timeout > MAX_TIMEOUT
      ) {
        throw new ConfigurationError(
          `timeout must be between 1000 and ${MAX_TIMEOUT}ms`,
          'http_request',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as HttpRequestHandlerConfig;
    const method = config.method || 'GET';

    // Evaluate URL (may contain expressions)
    const url = String(this.expressionEvaluator.evaluateExpression(config.url, context, step.name));

    // Validate URL is HTTP(S)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return {
        success: false,
        error: {
          code: 'HTTP_REQUEST_INVALID_URL',
          message: `URL must start with http:// or https://, got: ${url}`,
        },
      };
    }

    // Build headers. Only advertise a JSON Content-Type when we will actually
    // send a body: a bodyless GET carrying `Content-Type: application/json` is
    // semantically wrong and strict upstreams (e.g. nginx) reject it with a
    // 415 Unsupported Media Type. A caller can still set its own Content-Type
    // via `config.headers` below.
    const headers: Record<string, string> = {};
    const willSendBody = method !== 'GET' && config.body !== undefined;
    if (willSendBody) {
      headers['Content-Type'] = 'application/json';
    }

    // Forward specific headers from original request
    if (config.forwardHeaders) {
      for (const headerName of config.forwardHeaders) {
        const value = context.request.headers[headerName.toLowerCase()];
        if (value) {
          headers[headerName.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        }
      }
    }

    // Forward auth (cookies) from original request
    if (config.forwardAuth) {
      const cookieHeader = context.request.headers.cookie;
      if (cookieHeader) {
        headers['cookie'] = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
      }
      // Also forward Authorization header if present
      const authHeader = context.request.headers.authorization;
      if (authHeader) {
        headers['authorization'] = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      }
    }

    // Add custom headers (evaluate expressions)
    if (config.headers) {
      for (const [key, valueExpr] of Object.entries(config.headers)) {
        const resolved = this.expressionEvaluator.evaluateExpression(valueExpr, context, step.name);
        if (resolved !== undefined && resolved !== null) {
          headers[key.toLowerCase()] = String(resolved);
        }
      }
    }

    // Build body for non-GET requests
    let bodyStr: string | undefined;
    if (method !== 'GET' && config.body !== undefined) {
      if (typeof config.body === 'string') {
        // Expression that resolves to an object
        const resolved = this.expressionEvaluator.evaluateExpression(
          config.body,
          context,
          step.name,
        );
        bodyStr = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
      } else {
        // Object with expression values
        const resolvedBody: Record<string, unknown> = {};
        for (const [key, expr] of Object.entries(config.body)) {
          resolvedBody[key] = this.expressionEvaluator.evaluateExpression(expr, context, step.name);
        }
        bodyStr = JSON.stringify(resolvedBody);
      }
    }

    const timeout = config.timeout || DEFAULT_TIMEOUT;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      this.logger.debug(`${method} ${url} (timeout: ${timeout}ms)`);

      const response = await fetch(url, {
        method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse response
      const contentType = response.headers.get('content-type') || '';
      let responseBody: unknown;

      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      // failOnError defaults to true for backward compat. When explicitly false,
      // any HTTP response (including 4xx/5xx) is a successful step outcome with
      // a structured output the next step can branch on.
      const failOnError = config.failOnError !== false;

      if (!response.ok && failOnError) {
        return {
          success: false,
          error: {
            code: 'HTTP_REQUEST_ERROR',
            message: `HTTP ${response.status} ${response.statusText}`,
            details: {
              status: response.status,
              statusText: response.statusText,
              body: responseBody,
            },
          },
        };
      }

      if (!failOnError) {
        const safeOutput: HttpRequestSafeOutput = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        };
        return {
          success: true,
          output: safeOutput,
        };
      }

      return {
        success: true,
        output: responseBody,
      };
    } catch (error) {
      const err = error as Error;

      if (err.name === 'AbortError') {
        return {
          success: false,
          error: {
            code: 'HTTP_REQUEST_TIMEOUT',
            message: `Request timed out after ${timeout}ms`,
          },
        };
      }

      this.logger.error(`HTTP request failed for step ${step.name}: ${err.message}`);
      return {
        success: false,
        error: {
          code: 'HTTP_REQUEST_FAILED',
          message: `HTTP request failed: ${err.message}`,
        },
      };
    }
  }
}
