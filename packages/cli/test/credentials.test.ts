import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  credentialsPath,
  normalizeApiUrl,
  readCredentialsFile,
  getStoredKey,
  storeKey,
  removeKey,
} from '../src/api/credentials.js';

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'bffless-cred-')), 'credentials.json');
}

describe('credentialsPath', () => {
  it('defaults to ~/.config/bffless/credentials.json', () => {
    expect(credentialsPath({})).toBe(path.join(os.homedir(), '.config', 'bffless', 'credentials.json'));
  });

  it('respects XDG_CONFIG_HOME', () => {
    expect(credentialsPath({ XDG_CONFIG_HOME: '/xdg' })).toBe(path.join('/xdg', 'bffless', 'credentials.json'));
  });
});

describe('normalizeApiUrl', () => {
  it('lowercases the host and strips trailing slashes, keeping any base path', () => {
    expect(normalizeApiUrl('https://Admin.Example.com/')).toBe('https://admin.example.com');
    expect(normalizeApiUrl('https://admin.example.com/base/')).toBe('https://admin.example.com/base');
    expect(normalizeApiUrl('https://admin.example.com')).toBe('https://admin.example.com');
  });

  it('throws on an unparseable URL', () => {
    expect(() => normalizeApiUrl('not a url')).toThrow(/invalid API URL/);
  });
});

describe('store round-trip', () => {
  it('storeKey then getStoredKey returns the key, keyed by normalized URL', () => {
    const file = tmpFile();
    storeKey('https://Admin.Example.com/', 'k-123', file);
    expect(getStoredKey('https://admin.example.com', file)).toBe('k-123');
  });

  it('writes valid JSON with version 1 and an ISO createdAt', () => {
    const file = tmpFile();
    storeKey('https://a.test', 'k', file, new Date('2026-07-27T00:00:00Z'));
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed).toEqual({
      version: 1,
      credentials: { 'https://a.test': { apiKey: 'k', createdAt: '2026-07-27T00:00:00.000Z' } },
    });
  });

  it('re-storing the same instance overwrites; other instances are kept', () => {
    const file = tmpFile();
    storeKey('https://a.test', 'k-old', file);
    storeKey('https://b.test', 'k-b', file);
    storeKey('https://a.test', 'k-new', file);
    expect(getStoredKey('https://a.test', file)).toBe('k-new');
    expect(getStoredKey('https://b.test', file)).toBe('k-b');
  });

  it('creates the file with mode 0600', () => {
    if (process.platform === 'win32') return;
    const file = tmpFile();
    storeKey('https://a.test', 'k', file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('missing / corrupt files', () => {
  it('getStoredKey returns undefined for a missing file and an unknown instance', () => {
    const file = tmpFile();
    expect(getStoredKey('https://a.test', file)).toBeUndefined();
    storeKey('https://a.test', 'k', file);
    expect(getStoredKey('https://other.test', file)).toBeUndefined();
  });

  it('readCredentialsFile returns null for a missing file', () => {
    expect(readCredentialsFile(tmpFile())).toBeNull();
  });

  it('throws (naming the path) on invalid JSON — never silently treats it as absent', () => {
    const file = tmpFile();
    storeKey('https://a.test', 'k', file);
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(file, '{ nope');
    expect(() => getStoredKey('https://a.test', file)).toThrow(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('throws (naming the path) on schema-invalid content', () => {
    const file = tmpFile();
    storeKey('https://a.test', 'k', file);
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(file, JSON.stringify({ version: 2, credentials: {} }));
    expect(() => getStoredKey('https://a.test', file)).toThrow(/credentials/);
  });
});

describe('removeKey', () => {
  it('removes an entry and reports true; false when nothing was stored', () => {
    const file = tmpFile();
    storeKey('https://a.test', 'k', file);
    expect(removeKey('https://a.test/', file)).toBe(true);
    expect(getStoredKey('https://a.test', file)).toBeUndefined();
    expect(removeKey('https://a.test', file)).toBe(false);
    expect(removeKey('https://a.test', tmpFile())).toBe(false);
  });
});
