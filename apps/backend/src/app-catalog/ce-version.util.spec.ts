import { compareSemver, satisfiesMin, getCeVersion, resolveCeVersion } from './ce-version.util';

describe('compareSemver', () => {
  it('orders plain versions', () => {
    expect(compareSemver('0.3.15', '0.2.0')).toBeGreaterThan(0);
    expect(compareSemver('0.3.15', '0.3.15')).toBe(0);
    expect(compareSemver('0.3.9', '0.3.15')).toBeLessThan(0);
  });
  it('handles v-prefix and prerelease suffix by ignoring the suffix', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(0);
  });
});

describe('satisfiesMin', () => {
  it('passes when equal or newer', () => {
    expect(satisfiesMin('0.3.15', '0.3.15')).toBe(true);
    expect(satisfiesMin('0.4.0', '0.3.15')).toBe(true);
    expect(satisfiesMin('0.3.14', '0.3.15')).toBe(false);
  });
  it('fails closed on unparseable running version', () => {
    expect(satisfiesMin('unknown', '0.3.15')).toBe(false);
  });
});

describe('resolveCeVersion', () => {
  it('picks the first candidate whose package name is @bffless/ce', () => {
    const version = resolveCeVersion([
      { name: 'backend', version: '1.0.0' },
      { name: '@bffless/ce', version: '0.3.15' },
    ]);
    expect(version).toBe('0.3.15');
  });
  it('returns "unknown" when no candidate matches', () => {
    expect(resolveCeVersion([{ name: 'backend', version: '1.0.0' }])).toBe('unknown');
  });
});
