import {
  derivePresignKey,
  resolvePublicOrigin,
  signLocalUpload,
  verifyLocalUpload,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_EXPIRES_IN_SECONDS,
} from './presign.util';

describe('derivePresignKey', () => {
  it('prefers LOCAL_PRESIGN_SECRET over ENCRYPTION_KEY', () => {
    const a = derivePresignKey({ LOCAL_PRESIGN_SECRET: 'aaa', ENCRYPTION_KEY: 'bbb' });
    const b = derivePresignKey({ ENCRYPTION_KEY: 'bbb' });
    expect(a.equals(b)).toBe(false);
  });

  it('derives deterministically from ENCRYPTION_KEY so signatures survive restarts', () => {
    const a = derivePresignKey({ ENCRYPTION_KEY: 'stable-key' });
    const b = derivePresignKey({ ENCRYPTION_KEY: 'stable-key' });
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
  });

  it('is domain-separated from the pipeline signing key', () => {
    // function-runner derives sha256(`${base}|pipeline-fn-sign`); ours must differ.
    const ours = derivePresignKey({ ENCRYPTION_KEY: 'k' });
    const theirs = require('crypto')
      .createHash('sha256')
      .update('k|pipeline-fn-sign')
      .digest();
    expect(ours.equals(theirs)).toBe(false);
  });
});

describe('resolvePublicOrigin', () => {
  it('uses PUBLIC_ORIGIN when set, stripping a trailing slash', () => {
    expect(resolvePublicOrigin({ PUBLIC_ORIGIN: 'https://a.example/' })).toBe('https://a.example');
  });

  it('falls back to https://PRIMARY_DOMAIN', () => {
    expect(resolvePublicOrigin({ PRIMARY_DOMAIN: 'b.example' })).toBe('https://b.example');
  });

  it('throws rather than inventing a localhost origin', () => {
    expect(() => resolvePublicOrigin({})).toThrow(/PUBLIC_ORIGIN|PRIMARY_DOMAIN/);
  });
});

describe('signLocalUpload / verifyLocalUpload', () => {
  const presignKey = derivePresignKey({ ENCRYPTION_KEY: 'test' });
  const params = { key: 'o/r/uploads/content/abc', exp: 1_800_000_000, max: DEFAULT_MAX_UPLOAD_BYTES };

  it('round-trips a valid signature', () => {
    expect(verifyLocalUpload(params, signLocalUpload(params, presignKey), presignKey)).toBe(true);
  });

  it('rejects a tampered key', () => {
    const sig = signLocalUpload(params, presignKey);
    expect(verifyLocalUpload({ ...params, key: 'o/r/uploads/content/EVIL' }, sig, presignKey)).toBe(false);
  });

  it('rejects a tampered exp', () => {
    const sig = signLocalUpload(params, presignKey);
    expect(verifyLocalUpload({ ...params, exp: params.exp + 86_400 }, sig, presignKey)).toBe(false);
  });

  it('rejects a tampered max, so a client cannot raise its own size cap', () => {
    const sig = signLocalUpload(params, presignKey);
    expect(verifyLocalUpload({ ...params, max: params.max * 10 }, sig, presignKey)).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    const other = derivePresignKey({ ENCRYPTION_KEY: 'different' });
    expect(verifyLocalUpload(params, signLocalUpload(params, other), presignKey)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyLocalUpload(params, 'not-hex', presignKey)).toBe(false);
    expect(verifyLocalUpload(params, '', presignKey)).toBe(false);
  });

  it('rejects a same-length but invalid-hex signature', () => {
    // 'g' is not valid hex, so Buffer.from(..., 'hex') silently truncates it.
    // verifyLocalUpload must still return false rather than throw.
    const invalidHex = 'g'.repeat(64);
    expect(verifyLocalUpload(params, invalidHex, presignKey)).toBe(false);
  });

  it('throws TypeError when exp is not a finite number', () => {
    expect(() => signLocalUpload({ ...params, exp: 'not-a-number' as any }, presignKey)).toThrow(TypeError);
    expect(() => verifyLocalUpload({ ...params, exp: 'not-a-number' as any }, '', presignKey)).toThrow(TypeError);
    expect(() => signLocalUpload({ ...params, exp: Infinity }, presignKey)).toThrow(TypeError);
    expect(() => verifyLocalUpload({ ...params, exp: NaN }, '', presignKey)).toThrow(TypeError);
  });

  it('throws TypeError when max is not a finite number', () => {
    expect(() => signLocalUpload({ ...params, max: 'not-a-number' as any }, presignKey)).toThrow(TypeError);
    expect(() => verifyLocalUpload({ ...params, max: 'not-a-number' as any }, '', presignKey)).toThrow(TypeError);
    expect(() => signLocalUpload({ ...params, max: Infinity }, presignKey)).toThrow(TypeError);
    expect(() => verifyLocalUpload({ ...params, max: NaN }, '', presignKey)).toThrow(TypeError);
  });
});

describe('constants', () => {
  it('caps expiry at one hour, matching the other adapters', () => {
    expect(MAX_EXPIRES_IN_SECONDS).toBe(3600);
  });
});
