import { Injectable, Logger } from '@nestjs/common';
import JSON5 from 'json5';
import { StepHandler, ResponseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

/**
 * Response Handler
 *
 * Constructs the HTTP response to send back to the client.
 * Supports template strings with {{expression}} syntax and
 * object bodies where each value is evaluated as an expression.
 */
@Injectable()
export class ResponseHandler implements StepHandler<ResponseHandlerConfig> {
  readonly type = 'response_handler' as const;
  private readonly logger = new Logger(ResponseHandler.name);

  /**
   * String bodies at or above this size are sent verbatim when they are
   * already strict JSON instead of being JSON5-parsed into an object (#418).
   * Below the threshold the legacy parse is kept so existing pipelines that
   * read `steps.<respond>.body.<field>` still see an object; above it,
   * retaining a parsed copy of the payload (plus Express re-stringifying it)
   * is what OOMs small-heap deployments.
   */
  private static readonly JSON_PASSTHROUGH_MIN_CHARS = 256 * 1024;

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: ResponseHandlerConfig): void {
    if (config.body === undefined || config.body === null) {
      throw new ConfigurationError('Response body is required', 'response_handler');
    }

    if (config.status !== undefined) {
      if (typeof config.status !== 'number' || config.status < 100 || config.status > 599) {
        throw new ConfigurationError(
          'Status code must be a number between 100 and 599',
          'response_handler',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as ResponseHandlerConfig;
    const stepName = step.name || 'response_handler';

    this.logger.debug(`Executing response handler for step '${stepName}'`);

    let body: unknown;

    // Process body based on type
    if (typeof config.body === 'string') {
      // Template string - evaluate with {{expression}} syntax
      body = this.expressionEvaluator.evaluateTemplate(config.body, context, stepName);
    } else if (typeof config.body === 'object' && config.body !== null) {
      // Object - evaluate each value as an expression
      body = this.expressionEvaluator.evaluateObject(
        config.body as Record<string, string>,
        context,
        stepName,
      );
    } else {
      body = config.body;
    }

    // Evaluate headers if provided
    let headers: Record<string, string> | undefined;
    if (config.headers) {
      headers = {};
      for (const [key, value] of Object.entries(config.headers)) {
        headers[key] = this.expressionEvaluator.evaluateTemplate(value, context, stepName);
      }
    }

    // Determine content type
    const contentType = config.contentType || 'application/json';

    // Build the response object
    const { body: formattedBody, warning } = this.formatBody(body, contentType);
    const response = {
      status: config.status || 200,
      body: formattedBody,
      headers: {
        'Content-Type': contentType,
        ...headers,
      },
    };

    this.logger.debug(`Response handler returning status ${response.status}`);

    return {
      success: true,
      warning,
      output: {
        __isResponse: true,
        ...response,
      },
    };
  }

  private formatBody(body: unknown, contentType: string): { body: unknown; warning?: string } {
    // For JSON content type, ensure body is properly formatted
    if (contentType.includes('application/json')) {
      if (typeof body === 'string') {
        // Large-body fast path: if the rendered template is already strict
        // JSON, send the string verbatim. Materializing it into an object here
        // only for Express to JSON.stringify it again multiplies peak heap by
        // several times the payload size and OOMs the worker on large list
        // responses (#418). The JSON.parse is validation only; its result is
        // discarded.
        if (body.length >= ResponseHandler.JSON_PASSTHROUGH_MIN_CHARS) {
          try {
            JSON.parse(body);
            return { body };
          } catch {
            // Not strict JSON — fall through to JSON5 normalization.
          }
        }

        // Try to parse as JSON5 (handles unquoted keys, trailing commas, etc.)
        // This allows templates like { success: true, data: {{ steps.foo.value }} }
        // to work even though they produce non-strict JSON
        try {
          return { body: JSON5.parse(body) };
        } catch (err) {
          // JSON5 parse failed - this usually means the rendered template has
          // unquoted string values (e.g. { name: John Doe } instead of { name: "John Doe" }).
          // Wrap {{expressions}} that produce strings in quotes: "{{steps.step.field}}"
          // Use triple braces {{{expr}}} for objects/arrays (already valid JSON).
          const parseError = err instanceof Error ? err.message : String(err);
          const truncatedBody = body.length > 200 ? body.substring(0, 200) + '...' : body;
          const warning =
            `Response body template produced invalid JSON and was wrapped in { "message": ... }. ` +
            `Parse error: ${parseError}. ` +
            `Rendered body: ${truncatedBody}. ` +
            `Tip: Quote string expressions in your template, e.g. "{{steps.myStep.field}}". ` +
            `Use triple braces {{{expr}}} for objects/arrays that are already valid JSON.`;
          this.logger.warn(warning);
          return { body: { message: body }, warning };
        }
      }
      return { body };
    }

    // For HTML/text, convert to string if needed
    if (contentType.includes('text/') || contentType.includes('html')) {
      return { body: typeof body === 'string' ? body : JSON.stringify(body) };
    }

    return { body };
  }
}
