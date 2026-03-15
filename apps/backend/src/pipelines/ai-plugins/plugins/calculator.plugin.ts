import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AIToolPlugin,
  AIToolPluginMetadata,
  AIToolDefinition,
  AIToolContext,
} from '../ai-tool-plugin.interface';
import { AIToolPluginRegistry } from '../ai-tool-plugin.registry';

/**
 * Calculator plugin — a simple built-in plugin for validating the plugin system end-to-end.
 * No external credentials required.
 */
@Injectable()
export class CalculatorPlugin implements AIToolPlugin {
  readonly metadata: AIToolPluginMetadata = {
    id: 'calculator',
    name: 'Calculator',
    description:
      'Perform mathematical calculations. Useful for arithmetic, unit conversions, and numeric operations.',
    category: 'utility',
    icon: 'calculator',
  };

  constructor(private readonly registry: AIToolPluginRegistry) {
    this.registry.register(this);
  }

  getTools(_config: Record<string, unknown>): AIToolDefinition[] {
    return [
      {
        name: 'evaluate',
        description:
          'Evaluate a mathematical expression. Supports +, -, *, /, **, %, parentheses, and Math functions (sqrt, abs, ceil, floor, round, min, max, sin, cos, tan, log, PI, E).',
        inputSchema: z.object({
          expression: z
            .string()
            .describe(
              'The mathematical expression to evaluate, e.g. "2 + 3 * 4" or "Math.sqrt(144)"',
            ),
        }),
        execute: async (args: { expression: string }, _context: AIToolContext) => {
          return this.evaluateExpression(args.expression);
        },
      },
    ];
  }

  private evaluateExpression(expression: string): { result: number } | { error: string } {
    // Whitelist safe characters and Math functions
    const sanitized = expression.trim();

    // Only allow digits, operators, parentheses, dots, spaces, and Math references
    const safePattern =
      /^[\d\s+\-*/().,%^]+$|^[\d\s+\-*/().,%^]*Math\.(sqrt|abs|ceil|floor|round|min|max|sin|cos|tan|log|PI|E)[\d\s+\-*/().,%^(]*$/;

    // More permissive: allow combinations of numbers, operators, and Math calls
    const allowedChars = /^[0-9\s+\-*/().,%Math.sqrtabceilflooroundminmaxsincostanlgPIE]+$/;

    if (!allowedChars.test(sanitized)) {
      return { error: `Expression contains disallowed characters: ${sanitized}` };
    }

    // Block dangerous patterns
    const dangerous =
      /(?:eval|Function|require|import|process|global|window|document|fetch|XMLHttp|setTimeout|setInterval|constructor|\[|\]|=)/i;
    if (dangerous.test(sanitized)) {
      return { error: 'Expression contains disallowed patterns' };
    }

    try {
      // Create a sandboxed evaluation context with Math functions
      const mathFn = new Function('Math', `"use strict"; return (${sanitized});`);
      const result = mathFn(Math);

      if (typeof result !== 'number' || !isFinite(result)) {
        return { error: `Expression did not evaluate to a finite number: ${result}` };
      }

      return { result };
    } catch (error) {
      return { error: `Failed to evaluate expression: ${error.message}` };
    }
  }
}
