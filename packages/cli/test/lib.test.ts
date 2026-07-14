import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as lib from '../dist/lib.js';

const execFileAsync = promisify(execFile);

describe('bffless/lib entry', () => {
  it('exposes the documented functions', () => {
    expect(typeof lib.runPushOne).toBe('function');
    expect(typeof lib.validateRuleSet).toBe('function');
    expect(typeof lib.formatSyncReport).toBe('function');
    expect(typeof lib.runDiffOne).toBe('function');
    expect(typeof lib.buildOne).toBe('function');
    expect(typeof lib.exportsEquivalent).toBe('function');
    expect(typeof lib.applyNameSuffix).toBe('function');
    expect(typeof lib.resolveRemediation).toBe('function');
    expect(lib.CLI_REMEDIATION.apiKey).toContain('--api-key');
  });

  it('importing it never runs commander (no side effects), even with bogus argv', async () => {
    const libPath = path.resolve(fileURLToPath(import.meta.url), '../../dist/lib.js');
    const script = `import(${JSON.stringify(libPath)}).then(() => console.log('OK'))`;
    const { stdout } = await execFileAsync('node', ['-e', script, '--', '--bogus-flag']);
    expect(stdout.trim()).toBe('OK');
  });
});
