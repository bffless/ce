import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, ResponseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../../db/schema';
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
    const response = {
      status: config.status || 200,
      body: this.formatBody(body, contentType),
      headers: {
        'Content-Type': contentType,
        ...headers,
      },
    };

    this.logger.debug(`Response handler returning status ${response.status}`);

    return {
      success: true,
      output: {
        __isResponse: true,
        ...response,
      },
    };
  }

  private formatBody(body: unknown, contentType: string): unknown {
    // For JSON content type, ensure body is properly formatted
    if (contentType.includes('application/json')) {
      if (typeof body === 'string') {
        // Try to parse as JSON, otherwise wrap in an object
        try {
          return JSON.parse(body);
        } catch {
          return { message: body };
        }
      }
      return body;
    }

    // For HTML/text, convert to string if needed
    if (contentType.includes('text/') || contentType.includes('html')) {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }

    return body;
  }
}
