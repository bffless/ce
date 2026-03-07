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
        value = this.getNestedValue(context.user as unknown as Record<string, unknown>, parts.slice(1), expression, stepName);
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
          value = this.getNestedValue(stepOutput as Record<string, unknown>, parts.slice(2), expression, stepName);
        }
        break;
      case 'metadata':
        value = this.getNestedValue(context.metadata as Record<string, unknown>, parts.slice(1), expression, stepName);
        break;
      default:
        throw new ExpressionError(expression, `Unknown root '${root}'. Valid roots: input, user, steps, metadata`, stepName);
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

    return template.replace(/\{\{(.+?)\}\}/g, (_, expression) => {
      const value = this.evaluateExpression(expression.trim(), context, stepName);
      return value === null || value === undefined ? '' : String(value);
    });
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
   * @param condition The condition expression
   * @param context The pipeline context
   * @param stepName Optional step name for error messages
   * @returns Boolean result
   */
  evaluateCondition(condition: string, context: PipelineContext, stepName?: string): boolean {
    const value = this.evaluateExpression(condition, context, stepName);
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
