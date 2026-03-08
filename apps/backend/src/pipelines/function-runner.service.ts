import { Injectable, Logger } from '@nestjs/common';
import * as vm from 'vm';

/**
 * Options for function execution
 */
export interface FunctionRunnerOptions {
  /**
   * Timeout in milliseconds (1000-30000ms)
   * @default 5000
   */
  timeout?: number;
}

/**
 * Result of function execution
 */
export interface RunResult {
  success: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  executionTime?: number;
  logs?: string[];
}

/**
 * Code validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Prohibited patterns in user code for security
 */
const PROHIBITED_PATTERNS = [
  // No eval or Function constructor
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bFunction\s*\(/,
  // No require/import (though they won't work anyway in vm)
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  // No direct process/global access attempts
  /\bprocess\s*\./,
  /\bglobal\s*\./,
  /\bglobalThis\s*\./,
  // No constructor access for prototype pollution
  /\.__proto__/,
  /\bconstructor\s*\[/,
  /\bconstructor\s*\./,
  // No Buffer operations
  /\bBuffer\s*\(/,
  /\bBuffer\s*\./,
];

/**
 * FunctionRunnerService
 *
 * Provides sandboxed JavaScript execution for custom data transformations.
 * Uses Node.js's built-in vm module with restricted context.
 *
 * Security features:
 * - No access to require, process, global, etc.
 * - Timeout enforcement
 * - Static code validation for prohibited patterns
 * - Frozen data objects (cannot modify originals)
 *
 * Note: The vm module provides reasonable isolation for trusted environments
 * where users are authenticated. For completely untrusted code from the public,
 * additional isolation (containers, etc.) would be recommended.
 */
@Injectable()
export class FunctionRunnerService {
  private readonly logger = new Logger(FunctionRunnerService.name);

  /**
   * Validate user code before execution.
   * Checks for prohibited patterns that could be used to escape the sandbox.
   */
  validateCode(code: string): ValidationResult {
    const errors: string[] = [];

    for (const pattern of PROHIBITED_PATTERNS) {
      if (pattern.test(code)) {
        errors.push(`Prohibited pattern detected: ${pattern.source}`);
      }
    }

    // Basic syntax check - code should define a handler function
    try {
      // Wrap in async context to allow async handler functions
      const wrappedCode = `(async function() { ${code}; if (typeof handler !== 'function') throw new Error('Missing handler'); handler({}); })`;
      new vm.Script(wrappedCode, { filename: 'user-function.js' });
    } catch (e) {
      const error = e as Error;
      // Only report actual syntax errors, not the handler check
      if (!error.message.includes('Missing handler')) {
        errors.push(`Syntax error: ${error.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Execute user code in a sandboxed context.
   *
   * @param code - JavaScript code to execute. Should return a value.
   * @param data - Data object available as `data` in the code.
   * @param options - Execution options (timeout, etc.)
   * @returns RunResult with success status and output or error
   */
  async run(
    code: string,
    data: Record<string, unknown>,
    options: FunctionRunnerOptions = {},
  ): Promise<RunResult> {
    const startTime = Date.now();
    const timeout = Math.min(Math.max(options.timeout || 5000, 1000), 30000);
    const logs: string[] = [];

    // Validate code first
    const validation = this.validateCode(code);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Code validation failed',
          stack: validation.errors?.join('\n'),
        },
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // Create a frozen copy of data to prevent modifications
      const frozenData = this.deepFreeze(structuredClone(data));

      // Create a minimal sandbox context with safe built-ins
      const sandbox: vm.Context = {
        // User data (frozen)
        data: frozenData,

        // Safe built-ins
        Math,
        Date,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Promise,
        Symbol,
        BigInt,

        // Utility functions
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        decodeURI,
        decodeURIComponent,
        encodeURI,
        encodeURIComponent,

        // Captured console for debugging
        console: {
          log: (...args: unknown[]) => {
            const message = args
              .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
              .join(' ');
            logs.push(message);
            if (logs.length > 100) {
              logs.shift(); // Keep max 100 log entries
            }
          },
          warn: (...args: unknown[]) => {
            const message = `[WARN] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
            logs.push(message);
          },
          error: (...args: unknown[]) => {
            const message = `[ERROR] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
            logs.push(message);
          },
        },

        // Result placeholder
        __result__: undefined,
      };

      // Create the context
      vm.createContext(sandbox);

      // Wrap user code: user defines a handler(data) function, we call it
      // This matches the serverless function pattern (AWS Lambda, Cloud Functions, etc.)
      const wrappedCode = `
        (async function() {
          try {
            // User code defines the handler function
            ${code}

            // Verify handler function exists
            if (typeof handler !== 'function') {
              throw new Error('You must define a handler(data) function. Example: function handler(data) { return data.input; }');
            }

            // Call the user's handler function with data
            __result__ = await handler(data);
          } catch (e) {
            __result__ = { __error__: true, message: e.message, stack: e.stack };
          }
        })();
      `;

      // Compile and run
      const script = new vm.Script(wrappedCode, {
        filename: 'user-function.js',
      });

      // Run with timeout
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Execution timeout'));
        }, timeout);

        try {
          const promise = script.runInContext(sandbox, {
            timeout,
            displayErrors: true,
          });

          // Handle async execution
          Promise.resolve(promise)
            .then(() => {
              clearTimeout(timeoutId);
              resolve();
            })
            .catch((err) => {
              clearTimeout(timeoutId);
              reject(err);
            });
        } catch (err) {
          clearTimeout(timeoutId);
          reject(err);
        }
      });

      // Check for error result
      const result = sandbox.__result__;
      if (result && typeof result === 'object' && '__error__' in result) {
        const errorResult = result as { __error__: boolean; message: string; stack?: string };
        return {
          success: false,
          error: {
            code: 'EXECUTION_ERROR',
            message: errorResult.message,
            stack: errorResult.stack,
          },
          executionTime: Date.now() - startTime,
          logs,
        };
      }

      return {
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
        logs,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.warn(`Function execution failed: ${error.message}`);

      // Determine error code based on error type
      let code = 'EXECUTION_ERROR';
      if (
        error.message.toLowerCase().includes('timeout') ||
        error.message.includes('Execution timeout') ||
        error.message.includes('timed out')
      ) {
        code = 'TIMEOUT';
      } else if (error.message.includes('SyntaxError')) {
        code = 'SYNTAX_ERROR';
      }

      return {
        success: false,
        error: {
          code,
          message: error.message,
          stack: error.stack,
        },
        executionTime: Date.now() - startTime,
        logs,
      };
    }
  }

  /**
   * Deep freeze an object to prevent modifications
   */
  private deepFreeze<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Get all property names
    const propNames = Object.getOwnPropertyNames(obj);

    // Freeze all nested objects first
    for (const name of propNames) {
      const value = (obj as Record<string, unknown>)[name];
      if (value && typeof value === 'object') {
        this.deepFreeze(value);
      }
    }

    return Object.freeze(obj);
  }
}
