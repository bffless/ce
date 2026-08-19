import { describe, it, expect } from 'vitest';
import { HOSTNAME_PATTERN, SOURCE_DOMAIN_PATTERN, SUBDOMAIN_LABEL_PATTERN } from './domainPatterns';

describe('SOURCE_DOMAIN_PATTERN', () => {
  it.each([
    'example.com',
    'docs.example.com',
    'localhost',
    '*.example.com',
    '*.bffless.com',
    '*.docs.example.com',
  ])('accepts %s', (domain) => {
    expect(SOURCE_DOMAIN_PATTERN.test(domain)).toBe(true);
  });

  it.each(['*', '*example.com', 'foo.*.example.com', 'Example.com', '-example.com', ''])(
    'rejects %s',
    (domain) => {
      expect(SOURCE_DOMAIN_PATTERN.test(domain)).toBe(false);
    },
  );
});

describe('HOSTNAME_PATTERN', () => {
  it('accepts a plain hostname as a redirect target', () => {
    expect(HOSTNAME_PATTERN.test('bffless.dev')).toBe(true);
  });

  it('rejects a wildcard redirect target', () => {
    expect(HOSTNAME_PATTERN.test('*.bffless.dev')).toBe(false);
  });
});

describe('SUBDOMAIN_LABEL_PATTERN', () => {
  it('accepts a bare label', () => {
    expect(SUBDOMAIN_LABEL_PATTERN.test('coverage')).toBe(true);
  });

  it('rejects a dotted label', () => {
    expect(SUBDOMAIN_LABEL_PATTERN.test('a.b')).toBe(false);
  });
});
