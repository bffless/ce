import { describe, it, expect } from 'vitest';
import { normalizeDomain, domainError } from './normalizeDomain';

describe('normalizeDomain', () => {
  it.each([
    ['https://www.example.com/', 'example.com'],
    ['http://example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['Example.COM', 'example.com'],
    ['example.com.', 'example.com'],
    ['example.com:443', 'example.com'],
    ['https://example.com/setup?token=x#frag', 'example.com'],
    ['  example.com  ', 'example.com'],
    ['example.co.uk', 'example.co.uk'],
    ['app.example.com', 'app.example.com'], // non-www subdomain is left intact
  ])('normalizes %s -> %s', (raw, expected) => {
    expect(normalizeDomain(raw)).toBe(expected);
  });
});

describe('domainError', () => {
  it('accepts a plausible apex (returns null)', () => {
    expect(domainError('example.com')).toBeNull();
    expect(domainError('example.co.uk')).toBeNull();
  });

  it('returns null for empty (not-yet-entered, not an error)', () => {
    expect(domainError('')).toBeNull();
  });

  it.each(['example', 'localhost', 'has space.com', 'under_score.com', '-lead.com'])(
    'rejects %s',
    (bad) => {
      expect(domainError(bad)).toMatch(/root domain/i);
    },
  );
});
