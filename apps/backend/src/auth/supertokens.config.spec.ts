// Mock the database — supertokens.config.ts imports it at module level for
// syncOidcProviders(), but initSuperTokens() itself never touches it. Follows
// the same pattern as auth.service.spec.ts / custom-domain-auth.controller.spec.ts.
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn(),
  },
}));

import { resolveCookieDomain } from './supertokens.config';

describe('resolveCookieDomain', () => {
  it('treats an empty string as unset (returns undefined)', () => {
    expect(resolveCookieDomain('')).toBeUndefined();
  });

  it('treats a whitespace-only string as unset (returns undefined)', () => {
    expect(resolveCookieDomain('   ')).toBeUndefined();
  });

  it('treats undefined as unset (returns undefined)', () => {
    expect(resolveCookieDomain(undefined)).toBeUndefined();
  });

  it('passes through a real domain unchanged', () => {
    expect(resolveCookieDomain('.example.com')).toBe('.example.com');
  });

  it('trims surrounding whitespace off a real domain', () => {
    expect(resolveCookieDomain('  .example.com  ')).toBe('.example.com');
  });
});

describe('initSuperTokens with COOKIE_DOMAIN="" (regression: docker-compose empty-string injection)', () => {
  // This is the exact failure mode from the bootstrap-mode incident:
  // docker-compose.yml's `COOKIE_DOMAIN: ${COOKIE_DOMAIN:-}` injects an
  // empty string (not undefined) when .env has no COOKIE_DOMAIN set (e.g. a
  // domain-less bootstrap install). Deliberately does NOT mock
  // `supertokens-node` or its `Session` recipe — the whole point is to run
  // the real library's real config validation
  // (`normaliseSessionScopeOrThrowError`) and prove it no longer throws.
  //
  // Each test runs `initSuperTokens()` inside `jest.isolateModules` so it
  // gets a fresh copy of the `supertokens-node` module (and therefore a
  // fresh `SuperTokens.instance` singleton) — SuperTokens.init() silently
  // no-ops on a second call in the same module registry instead of
  // re-validating config, which would hide the crash on any test after the
  // first.
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does not throw when COOKIE_DOMAIN is an empty string', () => {
    process.env.COOKIE_DOMAIN = '';
    process.env.NODE_ENV = 'test';

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSuperTokens } = require('./supertokens.config');
        initSuperTokens();
      });
    }).not.toThrow();
  });

  it('still initialises correctly with a real COOKIE_DOMAIN set (no regression on the working case)', () => {
    process.env.COOKIE_DOMAIN = '.example.com';
    process.env.NODE_ENV = 'test';

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { initSuperTokens } = require('./supertokens.config');
        initSuperTokens();
      });
    }).not.toThrow();
  });
});
