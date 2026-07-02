import {
  BlocklistPatternEntry,
  buildBlocklistMatcher,
  compileBlocklistRegexSource,
  compileEntryPattern,
  validateBlocklistValue,
  BLOCKLIST_VALUE_MAX_LENGTH,
} from './blocklist-compiler';
import { BASELINE_BLOCKLIST_ENTRIES } from './blocklist-baseline';

/**
 * Seam 2 (issue #391): the injection-safety guarantee lives below HTTP, in the
 * compiled matching rules, so it is asserted here against the compiler as a
 * pure function.
 */
describe('blocklist compiler', () => {
  describe('validateBlocklistValue', () => {
    it('accepts realistic path patterns', () => {
      for (const value of [
        '/wp-admin',
        '/.env',
        '/admin/index.php',
        'sql.gz',
        '/components/com_users',
        '/a-b_c~d%2e',
        '/weird(but)real*path[1]',
      ]) {
        expect(validateBlocklistValue(value)).toBeNull();
      }
    });

    it.each([
      ['nginx block open', '/foo{'],
      ['nginx block close', '/foo}'],
      ['nginx directive terminator', '/foo;return'],
      ['nginx variable', '/foo$uri'],
      ['space', '/foo bar'],
      ['newline', '/foo\nlocation / {}'],
      ['tab', '/foo\tbar'],
      ['double quote', '/foo"'],
      ['backslash', '/foo\\d'],
      ['null byte', '/foo\0'],
    ])('rejects %s', (_label, value) => {
      expect(validateBlocklistValue(value)).not.toBeNull();
    });

    it('rejects empty and over-long values', () => {
      expect(validateBlocklistValue('')).not.toBeNull();
      expect(validateBlocklistValue('/a'.repeat(BLOCKLIST_VALUE_MAX_LENGTH))).not.toBeNull();
    });
  });

  describe('compileEntryPattern escaping', () => {
    it('escapes regex metacharacters so values match only literally', () => {
      const source = compileEntryPattern({ matchType: 'prefix', value: '/a.b(c)*[d]' });
      const regex = new RegExp(source, 'i');
      expect(regex.test('/a.b(c)*[d]/x')).toBe(true);
      // Unescaped, "." would match any char and "(c)*" would match zero c's.
      expect(regex.test('/aXb')).toBe(false);
      expect(regex.test('/a.b')).toBe(false);
    });

    it('cannot widen matching beyond the literal value (no alternation smuggling)', () => {
      // "," is allowed in paths but must stay a literal comma, never a separator.
      const source = compileBlocklistRegexSource([{ matchType: 'exact', value: '/a,/b' }])!;
      const regex = new RegExp(source, 'i');
      expect(regex.test('/a')).toBe(false);
      expect(regex.test('/b')).toBe(false);
      expect(regex.test('/a,/b')).toBe(true);
    });

    it('throws on values that failed validation (bug guard, not user input)', () => {
      expect(() => compileEntryPattern({ matchType: 'prefix', value: '/x;{}' })).toThrow(
        /Invalid blocklist pattern/,
      );
      expect(() => compileEntryPattern({ matchType: 'extension', value: '.' })).toThrow(
        /extension is empty/,
      );
    });

    it('anchors each matchType correctly', () => {
      const cases: Array<[BlocklistPatternEntry, string[], string[]]> = [
        [
          { matchType: 'prefix', value: '/wp-login' },
          ['/wp-login', '/wp-login.php', '/WP-LOGIN.PHP'],
          ['/blog/wp-login', '/wp'],
        ],
        [{ matchType: 'exact', value: '/~' }, ['/~'], ['/~root', '/x/~']],
        [
          { matchType: 'suffix', value: '.sql.gz' },
          ['/dump.sql.gz', '/backups/db.SQL.GZ'],
          ['/dump.sql.gz.txt'],
        ],
        [
          { matchType: 'extension', value: 'php' },
          ['/index.php', '/a/b/INDEX.PHP'],
          ['/index.phps', '/phpinfo'],
        ],
        [
          { matchType: 'contains', value: 'phpunit' },
          ['/vendor/phpunit/whatever', '/PHPUnit'],
          ['/php-unit'],
        ],
      ];

      for (const [entry, matches, misses] of cases) {
        const matcher = buildBlocklistMatcher([entry], []);
        for (const path of matches) {
          expect(matcher.isBlocked(path)).toBe(true);
        }
        for (const path of misses) {
          expect(matcher.isBlocked(path)).toBe(false);
        }
      }
    });

    it('treats "php" and ".php" extensions identically', () => {
      expect(compileEntryPattern({ matchType: 'extension', value: 'php' })).toBe(
        compileEntryPattern({ matchType: 'extension', value: '.php' }),
      );
    });
  });

  describe('buildBlocklistMatcher', () => {
    it('blocks nothing when there are no entries', () => {
      const matcher = buildBlocklistMatcher([], []);
      expect(matcher.isBlocked('/.env')).toBe(false);
      expect(matcher.blockSource).toBeNull();
    });

    it('matches the percent-decoded form of the path too', () => {
      const matcher = buildBlocklistMatcher([{ matchType: 'prefix', value: '/.env' }], []);
      expect(matcher.isBlocked('/%2eenv')).toBe(true);
      expect(matcher.isBlocked('/.e%6ev')).toBe(true);
    });

    it('survives malformed percent-encoding', () => {
      const matcher = buildBlocklistMatcher([{ matchType: 'prefix', value: '/.env' }], []);
      expect(matcher.isBlocked('/%zz/.env-not-prefix')).toBe(false);
      expect(matcher.isBlocked('/.env%zz')).toBe(true);
    });

    it('gives allowlist entries precedence over block entries', () => {
      const matcher = buildBlocklistMatcher(
        [{ matchType: 'prefix', value: '/admin' }],
        [{ matchType: 'prefix', value: '/admin/settings' }],
      );
      expect(matcher.isBlocked('/admin/login')).toBe(true);
      expect(matcher.isBlocked('/admin/settings')).toBe(false);
      expect(matcher.isBlocked('/admin/settings/profile')).toBe(false);
    });

    it('lets a list allowlist rescue a Baseline block (no forking the Baseline)', () => {
      const matcher = buildBlocklistMatcher(BASELINE_BLOCKLIST_ENTRIES, [
        { matchType: 'exact', value: '/status' },
      ]);
      expect(matcher.isBlocked('/status')).toBe(false);
      // The rescue is surgical: other Baseline patterns still block.
      expect(matcher.isBlocked('/status/probe')).toBe(true);
      expect(matcher.isBlocked('/.env')).toBe(true);
    });

    it('merges Baseline and custom-list entries into one blocked set', () => {
      const matcher = buildBlocklistMatcher(
        [...BASELINE_BLOCKLIST_ENTRIES, { matchType: 'prefix', value: '/my-custom-probe' }],
        [],
      );
      expect(matcher.isBlocked('/my-custom-probe/x')).toBe(true);
      expect(matcher.isBlocked('/wp-login.php')).toBe(true);
    });
  });

  describe('Baseline', () => {
    it('every Baseline entry passes validation and compiles', () => {
      expect(BASELINE_BLOCKLIST_ENTRIES.length).toBeGreaterThan(150);
      expect(() => compileBlocklistRegexSource(BASELINE_BLOCKLIST_ENTRIES)).not.toThrow();
    });

    it('blocks canonical scanner probes', () => {
      const matcher = buildBlocklistMatcher(BASELINE_BLOCKLIST_ENTRIES, []);
      for (const path of [
        '/.env',
        '/.git/config',
        '/wp-login.php',
        '/phpMyAdmin/index.php',
        '/phpinfo.php',
        '/cgi-bin/test.cgi',
        '/db.sql',
        '/shell.php',
        '/xmlrpc.php',
      ]) {
        expect(matcher.isBlocked(path)).toBe(true);
      }
    });

    it('does not block ordinary static-site paths', () => {
      const matcher = buildBlocklistMatcher(BASELINE_BLOCKLIST_ENTRIES, []);
      for (const path of [
        '/',
        '/index.html',
        '/assets/app.4f2c.js',
        '/css/style.css',
        '/images/logo.svg',
        '/.well-known/acme-challenge/token123',
        '/robots.txt',
        '/favicon.ico',
        '/docs/getting-started',
      ]) {
        expect(matcher.isBlocked(path)).toBe(false);
      }
    });
  });
});
