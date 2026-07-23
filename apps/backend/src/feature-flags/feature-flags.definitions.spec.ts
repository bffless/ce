import { FLAG_DEFINITIONS, getClientExposedFlagKeys } from './feature-flags.definitions';

describe('ENABLE_PRIMARY_SSL_MANAGEMENT', () => {
  it('is defined, defaults true, and is client-exposed', () => {
    const flag = FLAG_DEFINITIONS['ENABLE_PRIMARY_SSL_MANAGEMENT'];
    expect(flag).toBeDefined();
    expect(flag.defaultValue).toBe(true);
    expect(flag.type).toBe('boolean');
    expect(flag.exposeToClient).toBe(true);
    expect(getClientExposedFlagKeys()).toContain('ENABLE_PRIMARY_SSL_MANAGEMENT');
  });
});
