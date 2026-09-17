import { API_KEY_PREFIX, bearerApiKey } from './api-key-bearer.util';

describe('bearerApiKey', () => {
  it('returns the key from `Bearer wsa_…`', () => {
    expect(bearerApiKey('Bearer wsa_abc123')).toBe('wsa_abc123');
  });

  it('is case-insensitive on the scheme and tolerant of surrounding whitespace', () => {
    expect(bearerApiKey('  bearer   wsa_abc123  ')).toBe('wsa_abc123');
  });

  it('takes the first value of a repeated header', () => {
    expect(bearerApiKey(['Bearer wsa_first', 'Bearer wsa_second'])).toBe('wsa_first');
  });

  it('is null for an app token, a JWT, another scheme, or no header', () => {
    expect(bearerApiKey('Bearer bfat_abc')).toBeNull();
    expect(bearerApiKey('Bearer eyJhbGciOi.jwt.sig')).toBeNull();
    expect(bearerApiKey('Basic d3NhXzEyMw==')).toBeNull();
    expect(bearerApiKey('wsa_abc123')).toBeNull();
    expect(bearerApiKey(undefined)).toBeNull();
  });

  it('pins the prefix ApiKeysService mints with', () => {
    expect(API_KEY_PREFIX).toBe('wsa_');
  });
});
