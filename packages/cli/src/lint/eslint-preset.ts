import { validateHandlerSource } from './patterns.js';

/**
 * Minimal structural types for the slice of the ESLint rule API we use.
 * Deliberately NOT importing `eslint` — this module must be importable
 * (and its default export usable as a plain config object) without eslint
 * installed as a runtime dependency.
 */
interface EslintRuleContext {
  getSourceCode(): { getText(): string };
  report(descriptor: { node: unknown; message: string; loc?: { line: number; column: number } }): void;
}

interface EslintRuleModule {
  meta: {
    type: string;
    docs: { description: string };
    schema: unknown[];
  };
  create(context: EslintRuleContext): { Program(node: unknown): void };
}

/**
 * Reports every `validateHandlerSource` finding (i.e. every runtime-sandbox
 * violation the backend's `FunctionRunnerService.validateCode` would also
 * reject) at its line/column, anchored on the Program node.
 */
const noSandboxViolationsRule: EslintRuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flags BFFless pipeline function_handler code that would fail the runtime sandbox validation (parity with FunctionRunnerService.validateCode).',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const code = context.getSourceCode().getText();
        const findings = validateHandlerSource(code);
        for (const finding of findings) {
          context.report({
            node,
            message: finding.message,
            loc: { line: finding.line, column: Math.max(finding.column - 1, 0) },
          });
        }
      },
    };
  },
};

/**
 * Flat-config preset: `eslint.config.js` consumers can spread this array in.
 * Scoped to `**\/*.fn.js` — the convention for extracted pipeline
 * function_handler bodies (see Task 11's `rules validate`).
 */
const bfflessSandboxLintPreset = [
  {
    files: ['**/*.fn.js'],
    plugins: {
      bffless: {
        rules: {
          'no-sandbox-violations': noSandboxViolationsRule,
        },
      },
    },
    rules: {
      'bffless/no-sandbox-violations': 'error',
    },
  },
];

export default bfflessSandboxLintPreset;
