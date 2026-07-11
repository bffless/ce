import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const bin = path.resolve(fileURLToPath(import.meta.url), '../../dist/index.js');

describe('bffless bin', () => {
  it('prints top-level help mentioning the rules command', () => {
    const out = execFileSync('node', [bin, '--help'], { encoding: 'utf8' });
    expect(out).toContain('rules');
  });
  it('exits nonzero on unknown command', () => {
    expect(() => execFileSync('node', [bin, 'nope'], { encoding: 'utf8', stdio: 'pipe' })).toThrow();
  });
});
