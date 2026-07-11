import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROHIBITED_PATTERNS, validateHandlerSource } from '../src/lint/patterns.js';
import eslintPreset from '../src/lint/eslint-preset.js';
import type { RuleSetExport } from '../src/format/types.js';

// One snippet per PROHIBITED_PATTERNS entry (13 patterns), each wrapped so the
// match lands on a known line (line 2) for the line-number assertion.
const PATTERN_SNIPPETS: Array<{ label: string; code: string }> = [
  { label: 'eval(', code: 'function handler() {\n  return eval("1+1");\n}\n' },
  { label: 'new Function(', code: 'function handler() {\n  return new Function("return 1");\n}\n' },
  { label: 'Function(', code: 'function handler() {\n  return Function("return 1");\n}\n' },
  { label: 'require(', code: 'function handler() {\n  return require("fs");\n}\n' },
  { label: 'import(', code: 'function handler() {\n  return import("fs");\n}\n' },
  { label: 'process.', code: 'function handler() {\n  return process.env;\n}\n' },
  { label: 'global.', code: 'function handler() {\n  return global.foo;\n}\n' },
  { label: 'globalThis.', code: 'function handler() {\n  return globalThis.foo;\n}\n' },
  { label: '.__proto__', code: 'function handler() {\n  return ({}).__proto__;\n}\n' },
  { label: 'constructor[', code: 'function handler() {\n  return ({}).constructor[0];\n}\n' },
  { label: 'constructor.', code: 'function handler() {\n  return ({}).constructor.name;\n}\n' },
  { label: 'Buffer(', code: 'function handler() {\n  return Buffer(1);\n}\n' },
  { label: 'Buffer.', code: 'function handler() {\n  return Buffer.from("x");\n}\n' },
];

describe('PROHIBITED_PATTERNS', () => {
  it('has exactly 13 entries transcribed from the backend', () => {
    expect(PROHIBITED_PATTERNS).toHaveLength(13);
  });
});

describe('validateHandlerSource — prohibited patterns', () => {
  for (const { label, code } of PATTERN_SNIPPETS) {
    it(`flags "${label}" on line 2`, () => {
      const findings = validateHandlerSource(code);
      expect(findings.length).toBeGreaterThan(0);
      const onLine2 = findings.find((f) => f.line === 2);
      expect(onLine2, `expected a finding on line 2 for ${label}: ${JSON.stringify(findings)}`).toBeTruthy();
    });
  }
});

describe('validateHandlerSource — clean code', () => {
  it('returns [] for a clean real handler pulled from the reader fixture', () => {
    const fixturePath = path.resolve('test/fixtures/real/reader.proxy-rules.json');
    const exp = JSON.parse(readFileSync(fixturePath, 'utf8')) as RuleSetExport;
    let code: string | undefined;
    outer: for (const rule of exp.rules) {
      for (const step of rule.pipelineConfig?.steps ?? []) {
        if (step.handlerType === 'function_handler' && typeof step.config.code === 'string') {
          code = step.config.code;
          break outer;
        }
      }
    }
    expect(code, 'expected to find a function_handler step in the reader fixture').toBeTruthy();
    expect(validateHandlerSource(code as string)).toEqual([]);
  });

  it('returns [] for a trivial clean handler using const handler', () => {
    expect(validateHandlerSource('const handler = () => 1;\n')).toEqual([]);
  });
});

describe('validateHandlerSource — missing handler function', () => {
  it('flags code with no handler/const handler/let handler/var handler', () => {
    const findings = validateHandlerSource('const notAHandler = () => 1;\n');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /handler/i.test(f.message))).toBe(true);
  });
});

describe('validateHandlerSource — syntax error', () => {
  it('flags a syntax error with a message', () => {
    const findings = validateHandlerSource('function handler() {\n  return (;\n}\n');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /syntax/i.test(f.message))).toBe(true);
  });
});

describe('eslint-preset', () => {
  it('is a valid flat-config array with files + rules', () => {
    expect(Array.isArray(eslintPreset)).toBe(true);
    expect(eslintPreset.length).toBeGreaterThan(0);
    const entry = eslintPreset[0] as any;
    expect(entry.files).toContain('**/*.fn.js');
    expect(entry.rules).toHaveProperty('bffless/no-sandbox-violations', 'error');
    expect(entry.plugins).toHaveProperty('bffless');
    expect(entry.plugins.bffless.rules).toHaveProperty('no-sandbox-violations');
  });
});
