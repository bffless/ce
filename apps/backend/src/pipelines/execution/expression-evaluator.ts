import { Injectable } from '@nestjs/common';
import { PipelineContext } from './pipeline-context.interface';
import { ExpressionError } from '../errors';
import { v4 as uuidv4 } from 'uuid';

/**
 * The roots an expression path may start with. Anything else is returned as a
 * literal string, which is what lets email addresses and prose pass through
 * `evaluateExpression` untouched. Exported because a caller that decides
 * whether a string IS an expression before handing it over (ffmpeg_handler's
 * `draw.text`) must ask the same question this evaluator does — a second,
 * hand-copied list would silently drift.
 */
export const EXPRESSION_ROOTS = [
  'user',
  'steps',
  'metadata',
  'request',
  'deployment',
  'secrets',
] as const;

/**
 * Service for evaluating expressions and templates in pipeline configurations
 *
 * Expressions reference data using dot notation:
 * - request.body.fieldName - Request body
 * - request.query.paramName - Query parameters
 * - user.id, user.email - Current user
 * - steps.stepName.fieldName - Previous step output
 * - deployment.alias - Current deployment alias
 * - now() - Current timestamp as ISO-8601 string
 * - now_ms() - Current timestamp as epoch milliseconds
 * - uuid() - Generate UUID
 *
 * Templates use {{expression}} syntax:
 * - "Hello {{request.body.name}}" - String interpolation
 */
@Injectable()
export class ExpressionEvaluator {
  /**
   * Evaluate an expression and return the result
   * @param expression The expression to evaluate (e.g., "request.body.email", "steps.createUser.id")
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
    if (trimmed === 'now_ms()') {
      return Date.now();
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
    // Extract first part before '.' or '[' for root check
    const firstPartMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    const firstPart = firstPartMatch ? firstPartMatch[1] : '';
    if (!(EXPRESSION_ROOTS as readonly string[]).includes(firstPart)) {
      // Not a valid expression path - return as literal string
      // This handles email addresses, URLs, and other literal values
      return trimmed;
    }

    // Handle path expressions (request.body.field, user.id, steps.name.field)
    // Supports both dot notation and bracket notation for keys with special chars
    const parts = this.parsePath(trimmed);
    if (parts.length === 0) {
      throw new ExpressionError(expression, 'Empty expression', stepName);
    }

    let value: unknown;
    const root = parts[0];

    switch (root) {
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
        // request.body -> metadata.body (POST/PUT body)
        // request.query -> metadata.query (query parameters)
        // request.method -> metadata.method
        // request.path -> metadata.path
        // request.headers -> metadata.headers
        if (parts.length < 2) {
          throw new ExpressionError(
            expression,
            'Request reference requires property (body, query, method, path, headers)',
            stepName,
          );
        }
        const requestProp = parts[1];
        if (
          !['body', 'query', 'method', 'path', 'headers', 'ip', 'userAgent'].includes(requestProp)
        ) {
          throw new ExpressionError(
            expression,
            `Unknown request property '${requestProp}'. Valid: body, query, method, path, headers, ip, userAgent`,
            stepName,
          );
        }
        const requestData = {
          body: context.metadata.body,
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
      case 'deployment':
        if (!context.deployment) {
          return null; // No deployment context available
        }
        if (parts.length === 1) {
          value = context.deployment;
        } else {
          value = this.getNestedValue(
            context.deployment as unknown as Record<string, unknown>,
            parts.slice(1),
            expression,
            stepName,
          );
        }
        break;
      case 'secrets':
        // Project secrets, referenced as secrets.<NAME>. Decrypted values are
        // injected into context.secrets at the start of the run. A missing
        // secret resolves to null (rather than throwing) so optional inputs
        // degrade gracefully.
        if (parts.length < 2) {
          throw new ExpressionError(
            expression,
            'Secret reference requires a name, e.g. secrets.HF_TOKEN',
            stepName,
          );
        }
        if (!context.secrets) {
          return null;
        }
        value = context.secrets[parts[1]] ?? null;
        break;
      default:
        throw new ExpressionError(
          expression,
          `Unknown root '${root}'. Valid roots: user, steps, metadata, request, deployment, secrets`,
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

    // Single tokenizing pass: {{{expr}}} (raw/JSON) and {{expr}} (string) are
    // matched in one scan of the ORIGINAL template, so a substituted value is
    // terminal and can never be re-interpreted as template syntax (#431).
    return template.replace(
      /\{\{\{(.+?)\}\}\}|\{\{(.+?)\}\}/g,
      (_, tripleExpr: string | undefined, doubleExpr: string | undefined) => {
        if (tripleExpr !== undefined) {
          const value = this.evaluateExpression(tripleExpr.trim(), context, stepName);
          if (value === null || value === undefined) {
            return 'null';
          }
          // Triple braces: raw output (no HTML escaping); objects as JSON
          if (typeof value === 'object') {
            return JSON.stringify(value);
          }
          // Primitives: output as-is without JSON quotes
          return String(value);
        }
        const value = this.evaluateExpression((doubleExpr as string).trim(), context, stepName);
        if (value === null || value === undefined) {
          return '';
        }
        // Double braces: convert to string (objects become [object Object])
        return String(value);
      },
    );
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

  /**
   * Parse an expression path into parts, supporting both dot notation and bracket notation.
   * Examples:
   *   "request.headers.host" -> ["request", "headers", "host"]
   *   "request.headers['x-forwarded-for']" -> ["request", "headers", "x-forwarded-for"]
   *   "steps['my step'].field" -> ["steps", "my step", "field"]
   */
  private parsePath(expression: string): string[] {
    const parts: string[] = [];
    let current = '';
    let i = 0;

    while (i < expression.length) {
      const char = expression[i];

      if (char === '.') {
        // Dot separator - push current part and continue
        if (current) {
          parts.push(current);
          current = '';
        }
        i++;
      } else if (char === '[') {
        // Bracket notation - push current part if any
        if (current) {
          parts.push(current);
          current = '';
        }
        i++; // Skip '['

        // Check for quote type
        const quote = expression[i];
        if (quote === '"' || quote === "'") {
          i++; // Skip opening quote
          // Read until closing quote
          let bracketContent = '';
          while (i < expression.length && expression[i] !== quote) {
            bracketContent += expression[i];
            i++;
          }
          i++; // Skip closing quote
          i++; // Skip ']'
          parts.push(bracketContent);
        } else {
          // No quotes - read until ']' (for numeric indices)
          let bracketContent = '';
          while (i < expression.length && expression[i] !== ']') {
            bracketContent += expression[i];
            i++;
          }
          i++; // Skip ']'
          parts.push(bracketContent);
        }
      } else {
        // Regular character
        current += char;
        i++;
      }
    }

    // Push final part if any
    if (current) {
      parts.push(current);
    }

    return parts;
  }
}
