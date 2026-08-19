import { Injectable, Logger } from '@nestjs/common';
import * as vm from 'vm';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

/**
 * Crypto helpers exposed to pipeline function handlers as the global `utils`
 * (also passed on the handler argument, so both `utils.sign(...)` and
 * `function handler({ utils }) { ... }` work).
 *
 * These are pure string -> string|boolean helpers backed by Node's crypto at
 * the host level. `sign`/`verify` use a server-held pipeline signing key that
 * is NEVER exposed to the sandbox, so handlers can mint/validate tamper-proof
 * tokens (e.g. a short-lived, folder-scoped access cookie) without handling the
 * raw secret.
 */
export interface PipelineFunctionUtils {
  /** Lowercase hex SHA-256 of `message`. */
  sha256(message: string): string;
  /** Lowercase hex HMAC-SHA256 of `message` with the caller-supplied `key`. */
  hmacSha256(message: string, key: string): string;
  /** Hex HMAC-SHA256 of `message` using the server pipeline signing key. */
  sign(message: string): string;
  /** Timing-safe check that `signature` matches `sign(message)`. */
  verify(message: string, signature: string): boolean;
  /** Crypto-strong random hex token of `bytes` length (default 18 → 36 hex chars). */
  randomToken(bytes?: number): string;
  /** RFC4122 v4 UUID. */
  randomUUID(): string;
  /** Base64url-encode a UTF-8 string (no padding). */
  base64urlEncode(value: string): string;
  /** Decode a base64url string back to a UTF-8 string ('' on malformed input). */
  base64urlDecode(value: string): string;
}

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

  /** Cached server-side signing key for `utils.sign` / `utils.verify`. */
  private signingKeyCache: Buffer | null = null;

  /**
   * Derive the pipeline signing key once, from a dedicated env var when set,
   * otherwise from the (required, stable) ENCRYPTION_KEY so signatures survive
   * restarts without extra configuration. Never exposed to the sandbox.
   */
  private getSigningKey(): Buffer {
    if (!this.signingKeyCache) {
      const base =
        process.env.PIPELINE_SIGNING_SECRET ||
        process.env.ENCRYPTION_KEY ||
        'bffless-pipeline-dev-signing-secret';
      this.signingKeyCache = createHash('sha256').update(`${base}|pipeline-fn-sign`).digest();
    }
    return this.signingKeyCache;
  }

  /**
   * Build the `utils` crypto bag injected into every function sandbox. All
   * helpers coerce their inputs with String() and never throw on bad input.
   */
  private buildUtils(): PipelineFunctionUtils {
    const signingKey = this.getSigningKey();
    const hmacHex = (message: string, key: Buffer | string): string =>
      createHmac('sha256', key).update(String(message)).digest('hex');

    return {
      sha256: (message) => createHash('sha256').update(String(message)).digest('hex'),
      hmacSha256: (message, key) => hmacHex(message, String(key)),
      sign: (message) => hmacHex(message, signingKey),
      verify: (message, signature) => {
        const expected = hmacHex(message, signingKey);
        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(String(signature), 'utf8');
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
      },
      randomToken: (bytes = 18) => {
        const n = Math.min(Math.max(Math.floor(Number(bytes) || 18), 1), 64);
        return randomBytes(n).toString('hex');
      },
      randomUUID: () => randomUUID(),
      base64urlEncode: (value) => Buffer.from(String(value), 'utf8').toString('base64url'),
      base64urlDecode: (value) => {
        try {
          return Buffer.from(String(value), 'base64url').toString('utf8');
        } catch {
          return '';
        }
      },
    };
  }

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

      // Crypto helpers exposed to the handler. Built per-run; functions are not
      // structured-cloneable, so utils is attached AFTER the freeze/clone above.
      const utils = this.buildUtils();

      // Create a minimal sandbox context with safe built-ins
      const sandbox: vm.Context = {
        // User data (frozen) + crypto helpers on the handler argument
        data: { ...frozenData, utils },

        // Crypto helpers also available as a bare global (`utils.sign(...)`)
        utils,

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

      // Wrap user code: user defines a handler({ user, request, steps, deployment, utils }) function, we call it
      // (`utils` is also available as a bare global). This matches the serverless
      // function pattern (AWS Lambda, Cloud Functions, etc.)
      const wrappedCode = `
        (async function() {
          try {
            // User code defines the handler function
            ${code}

            // Verify handler function exists
            if (typeof handler !== 'function') {
              throw new Error('You must define a handler function. Example: function handler({ input }) { return input; }');
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
