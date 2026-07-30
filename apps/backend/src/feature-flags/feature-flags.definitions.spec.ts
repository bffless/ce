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

describe('ENABLE_LOCAL_PRESIGNED_UPLOADS', () => {
  it('is defined, on by default, and exposed to the client', () => {
    const flag = FLAG_DEFINITIONS['ENABLE_LOCAL_PRESIGNED_UPLOADS'];
    expect(flag).toBeDefined();
    expect(flag.envKey).toBe('FEATURE_LOCAL_PRESIGNED_UPLOADS');
    expect(flag.defaultValue).toBe(true);
    expect(flag.type).toBe('boolean');
    expect(flag.category).toBe('features');
    expect(getClientExposedFlagKeys()).toContain('ENABLE_LOCAL_PRESIGNED_UPLOADS');
  });
});
