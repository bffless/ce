import * as vm from 'node:vm';

/**
 * Prohibited patterns for pipeline `function_handler` code, transcribed 1:1
 * from the runtime's `PROHIBITED_PATTERNS` in
 * apps/backend/src/pipelines/function-runner.service.ts (lines ~78-97).
 *
 * This is a parity contract: a handler that passes this CLI lint must also
 * pass the runtime's `validateCode`, and one this lint rejects must be
 * rejected at runtime too. Do NOT "improve" or paraphrase these regexes —
 * any drift here means the CLI and the runtime disagree about what's safe.
 */
export const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  // No eval or Function constructor
  { pattern: /\beval\s*\(/, message: 'Prohibited pattern detected: \\beval\\s*\\(' },
  { pattern: /\bnew\s+Function\s*\(/, message: 'Prohibited pattern detected: \\bnew\\s+Function\\s*\\(' },
  { pattern: /\bFunction\s*\(/, message: 'Prohibited pattern detected: \\bFunction\\s*\\(' },
  // No require/import (though they won't work anyway in vm)
  { pattern: /\brequire\s*\(/, message: 'Prohibited pattern detected: \\brequire\\s*\\(' },
  { pattern: /\bimport\s*\(/, message: 'Prohibited pattern detected: \\bimport\\s*\\(' },
  // No direct process/global access attempts
  { pattern: /\bprocess\s*\./, message: 'Prohibited pattern detected: \\bprocess\\s*\\.' },
  { pattern: /\bglobal\s*\./, message: 'Prohibited pattern detected: \\bglobal\\s*\\.' },
  { pattern: /\bglobalThis\s*\./, message: 'Prohibited pattern detected: \\bglobalThis\\s*\\.' },
  // No constructor access for prototype pollution
  { pattern: /\.__proto__/, message: 'Prohibited pattern detected: \\.__proto__' },
  { pattern: /\bconstructor\s*\[/, message: 'Prohibited pattern detected: \\bconstructor\\s*\\[' },
  { pattern: /\bconstructor\s*\./, message: 'Prohibited pattern detected: \\bconstructor\\s*\\.' },
  // No Buffer operations
  { pattern: /\bBuffer\s*\(/, message: 'Prohibited pattern detected: \\bBuffer\\s*\\(' },
  { pattern: /\bBuffer\s*\./, message: 'Prohibited pattern detected: \\bBuffer\\s*\\.' },
];

export interface LintFinding {
  line: number;
  column: number;
  message: string;
}

/** Regex that recognizes a `handler` function/const/let/var declaration. */
const HANDLER_DECL_RE = /\bfunction\s+handler\b|\b(?:const|let|var)\s+handler\b/;

/** Map a 0-based string index in `code` to a 1-based { line, column }. */
function locate(code: string, index: number): { line: number; column: number } {
  const upto = code.slice(0, index);
  const lines = upto.split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

/**
 * Statically validate pipeline `function_handler` source code, mirroring the
 * runtime's `FunctionRunnerService.validateCode`:
 *  1. Scan for PROHIBITED_PATTERNS (each match reported at its line/column).
 *  2. Syntax-check by compiling the same async-IIFE wrapper the backend
 *     compiles (a `new vm.Script(...)`, never executed — so this only
 *     catches genuine parse errors, matching backend behavior).
 *  3. Flag source that never declares a `handler` (function/const/let/var).
 *
 * Returns [] for clean code.
 */
export function validateHandlerSource(code: string): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const { pattern, message } of PROHIBITED_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      const { line, column } = locate(code, match.index);
      findings.push({ line, column, message });
      if (match[0].length === 0) {
        re.lastIndex += 1;
      }
    }
  }

  if (!HANDLER_DECL_RE.test(code)) {
    findings.push({
      line: 1,
      column: 1,
      message:
        'No handler function defined. Expected `function handler`, `const handler`, `let handler`, or `var handler`.',
    });
  }

  // Mirror the backend's validateCode syntax check: wrap the code in an
  // async IIFE and compile it (never run it) so only real parse errors throw.
  try {
    const wrapped = `(async function() { ${code}; if (typeof handler !== 'function') throw new Error('No handler function defined'); })`;
    new vm.Script(wrapped, { filename: 'user-function.js' });
  } catch (e) {
    const error = e as Error;
    findings.push({ line: 1, column: 1, message: `Syntax error: ${error.message}` });
  }

  return findings;
}
