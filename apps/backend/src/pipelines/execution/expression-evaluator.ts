import { Injectable } from '@nestjs/common';
import { PipelineContext } from './pipeline-context.interface';
import { ExpressionError } from '../errors';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for evaluating expressions and templates in pipeline configurations
 *
 * Expressions reference data using dot notation:
 * - input.fieldName - Request input
 * - user.id, user.email - Current user
 * - steps.stepName.fieldName - Previous step output
 * - now() - Current timestamp
 * - uuid() - Generate UUID
 *
 * Templates use {{expression}} syntax:
 * - "Hello {{input.name}}" - String interpolation
 */
@Injectable()
export class ExpressionEvaluator {
  /**
   * Evaluate an expression and return the result
   * @param expression The expression to evaluate (e.g., "input.email", "steps.createUser.id")
   * @param context The pipeline context
   * @param stepName Optional step name for error messages
   * @returns The evaluated value
   * @throws ExpressionError if expression is invalid
   */
  evaluateExpression(expression: string, context: PipelineContext, stepName?: string): unknown {
    if (!expression || typeof expression !== 'string') {
      return expression;
    }

    const trimmed = expression.trim();

    // Handle built-in functions
    if (trimmed === 'now()') {
      return new Date().toISOString();
    }
    if (trimmed === 'uuid()') {
      return uuidv4();
    }

    // Handle literal values
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

    // Handle quoted strings
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    // Check if this looks like a valid expression path (must start with a known root)
    // This allows literal values like email addresses to pass through unchanged
    const validRoots = ['input', 'user', 'steps', 'metadata', 'request'];
    const firstPart = trimmed.split('.')[0];
    if (!validRoots.includes(firstPart)) {
      // Not a valid expression path - return as literal string
      // This handles email addresses, URLs, and other literal values
      return trimmed;
    }

    // Handle path expressions (input.field, user.id, steps.name.field)
    const parts = trimmed.split('.');
    if (parts.length === 0) {
      throw new ExpressionError(expression, 'Empty expression', stepName);
    }

    let value: unknown;
    const root = parts[0];

    switch (root) {
      case 'input':
        value = this.getNestedValue(context.input, parts.slice(1), expression, stepName);
        break;
      case 'user':
        if (!context.user) {
          return null; // No user available
        }
        value = this.getNestedValue(
          context.user as unknown as Record<string, unknown>,
          parts.slice(1),
          expression,
          stepName,
        );
        break;
      case 'steps':
        if (parts.length < 2) {
          throw new ExpressionError(expression, 'Steps reference requires step name', stepName);
        }
        const stepOutput = context.stepOutputs[parts[1]];
        if (stepOutput === undefined) {
          return null; // Step hasn't run or has no output
        }
        if (parts.length === 2) {
          value = stepOutput;
        } else {
          value = this.getNestedValue(
            stepOutput as Record<string, unknown>,
            parts.slice(2),
            expression,
            stepName,
          );
        }
        break;
      case 'metadata':
        value = this.getNestedValue(
          context.metadata as Record<string, unknown>,
          parts.slice(1),
          expression,
          stepName,
        );
        break;
      case 'request':
        // Map request.* to context.metadata for convenience
        // request.query -> metadata.query
        // request.method -> metadata.method
        // request.path -> metadata.path
        // request.headers -> metadata.headers
        if (parts.length < 2) {
          throw new ExpressionError(expression, 'Request reference requires property (query, method, path, headers)', stepName);
        }
        const requestProp = parts[1];
        if (!['query', 'method', 'path', 'headers', 'ip', 'userAgent'].includes(requestProp)) {
          throw new ExpressionError(
            expression,
            `Unknown request property '${requestProp}'. Valid: query, method, path, headers, ip, userAgent`,
            stepName,
          );
        }
        const requestData = {
          query: context.metadata.query,
          method: context.metadata.method,
          path: context.metadata.path,
          headers: context.metadata.headers,
          ip: context.metadata.ip,
          userAgent: context.metadata.userAgent,
        };
        if (parts.length === 2) {
          value = requestData[requestProp as keyof typeof requestData];
        } else {
          value = this.getNestedValue(
            requestData[requestProp as keyof typeof requestData] as Record<string, unknown>,
            parts.slice(2),
            expression,
            stepName,
          );
        }
        break;
      default:
        throw new ExpressionError(
          expression,
          `Unknown root '${root}'. Valid roots: input, user, steps, metadata, request`,
          stepName,
        );
    }

    return value;
  }

  /**
   * Evaluate a template string with {{expression}} placeholders
   * @param template The template string
   * @param context The pipeline context
   * @param stepName Optional step name for error messages
   * @returns The evaluated string
   */
  evaluateTemplate(template: string, context: PipelineContext, stepName?: string): string {
    if (!template || typeof template !== 'string') {
      return String(template ?? '');
    }

    // First, handle triple braces {{{expr}}} for raw JSON output
    let result = template.replace(/\{\{\{(.+?)\}\}\}/g, (_, expression) => {
      const value = this.evaluateExpression(expression.trim(), context, stepName);
      if (value === null || value === undefined) {
        return 'null';
      }
      // For triple braces, always output as JSON (raw, no escaping)
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      // Primitives also get JSON serialization for consistency
      return JSON.stringify(value);
    });

    // Then, handle double braces {{expr}} for string interpolation
    result = result.replace(/\{\{(.+?)\}\}/g, (_, expression) => {
      const value = this.evaluateExpression(expression.trim(), context, stepName);
      if (value === null || value === undefined) {
        return '';
      }
      // For double braces, convert to string (objects become [object Object])
      return String(value);
    });

    return result;
  }

  /**
   * Evaluate an object's values as expressions
   * @param obj Object with expression values
   * @param context The pipeline context
   * @param stepName Optional step name for error messages
   * @returns Object with evaluated values
   */
  evaluateObject(
    obj: Record<string, string>,
    context: PipelineContext,
    stepName?: string,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.evaluateExpression(value, context, stepName);
    }
    return result;
  }

  /**
   * Evaluate a condition expression and return boolean
   * Supports negation with ! prefix (e.g., "!steps.find")
   * @param condition The condition expression
   * @param context The pipeline context
   * @param stepName Optional step name for error messages
   * @returns Boolean result
   */
  evaluateCondition(condition: string, context: PipelineContext, stepName?: string): boolean {
    if (!condition || typeof condition !== 'string') {
      return false;
    }

    const trimmed = condition.trim();

    // Handle negation prefix
    if (trimmed.startsWith('!')) {
      const innerExpression = trimmed.slice(1).trim();
      const value = this.evaluateExpression(innerExpression, context, stepName);
      return !Boolean(value);
    }

    const value = this.evaluateExpression(trimmed, context, stepName);
    return Boolean(value);
  }

  /**
   * Get a nested value from an object using a path array
   */
  private getNestedValue(
    obj: Record<string, unknown>,
    path: string[],
    expression: string,
    stepName?: string,
  ): unknown {
    if (path.length === 0) {
      return obj;
    }

    let current: unknown = obj;
    for (const part of path) {
      if (current === null || current === undefined) {
        return null;
      }
      if (typeof current !== 'object') {
        throw new ExpressionError(expression, `Cannot access '${part}' on non-object`, stepName);
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
