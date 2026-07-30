import {
  derivePresignKey,
  resolvePublicOrigin,
  signLocalUpload,
  verifyLocalUpload,
  tryResolvePublicOrigin,
  hasRealPresignSecret,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_EXPIRES_IN_SECONDS,
} from './presign.util';
import { LocalStorageAdapter, LOCAL_PRESIGN_PATH } from './local.adapter';
import { DynamicStorageAdapter } from './dynamic-storage.adapter';
import { StorageModule } from './storage.module';

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

describe('hasRealPresignSecret', () => {
  it('is false when neither LOCAL_PRESIGN_SECRET nor ENCRYPTION_KEY is set', () => {
    expect(hasRealPresignSecret({})).toBe(false);
  });

  it('is false for blank/whitespace-only values', () => {
    expect(hasRealPresignSecret({ ENCRYPTION_KEY: '' })).toBe(false);
    expect(hasRealPresignSecret({ LOCAL_PRESIGN_SECRET: '   ' })).toBe(false);
  });

  it('is true when ENCRYPTION_KEY is set', () => {
    expect(hasRealPresignSecret({ ENCRYPTION_KEY: 'real-key' })).toBe(true);
  });

  it('is true when LOCAL_PRESIGN_SECRET is set', () => {
    expect(hasRealPresignSecret({ LOCAL_PRESIGN_SECRET: 'real-secret' })).toBe(true);
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

describe('publicOrigin reaches every LocalStorageAdapter construction site', () => {
  const saved = {
    PRIMARY_DOMAIN: process.env.PRIMARY_DOMAIN,
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  };

  beforeEach(() => {
    process.env.PRIMARY_DOMAIN = 'sites.example';
    delete process.env.PUBLIC_ORIGIN;
    // These sites exercise "presigned support is fully wired end-to-end given
    // a resolvable origin" -- which on a real CE install always also has
    // ENCRYPTION_KEY set (it's mandatory setup, not optional). The dedicated
    // "no secret" fail-closed cases live in local.adapter.spec.ts.
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('site 1 — DynamicStorageAdapter default adapter mints presigned URLs', async () => {
    const dynamic = new DynamicStorageAdapter();
    expect(dynamic.supportsPresignedUrls()).toBe(true);
    const url = await dynamic.getPresignedUploadUrl!('o/r/uploads/content/a.bin');
    expect(new URL(url).origin).toBe('https://sites.example');
  });

  it('site 2 — StorageModule.createAdapter local branch mints presigned URLs', async () => {
    // StorageModule.createAdapter is a public static factory, so the real local
    // branch (the actual construction site) can be exercised directly rather
    // than only asserting an equivalent config shape.
    const adapter = StorageModule.createAdapter({
      storageType: 'local',
      config: { localPath: '/tmp/bffless-site2' },
    }) as LocalStorageAdapter;
    expect(adapter.supportsPresignedUrls()).toBe(true);
    expect(new URL(await adapter.getPresignedUploadUrl('k')).origin).toBe('https://sites.example');
  });

  it('site 3 — a setup.service-shaped construction mints presigned URLs', async () => {
    const adapter = new LocalStorageAdapter({
      localPath: '/tmp/bffless-site3',
      keyPrefix: 'ws1',
      publicOrigin: tryResolvePublicOrigin(),
    });
    expect(adapter.supportsPresignedUrls()).toBe(true);
    const url = await adapter.getPresignedUploadUrl('k');
    const key = Buffer.from(new URL(url).searchParams.get('key')!, 'base64url').toString('utf8');
    expect(key).toBe('ws1/k');
  });

  it('does not crash when no origin can be resolved, and (Task 12) still supports presigned uploads via a relative URL', () => {
    // Before Task 12, an unresolvable origin degraded support to `false`. Now
    // publicOrigin is an explicit override for an absolute URL, not a
    // precondition, so support still holds on the (mandatory) signing secret
    // alone -- this test's job is now to prove construction doesn't throw AND
    // that the minted URL is the relative fallback shape, not an absolute one
    // pointed at a wrong/guessed origin.
    delete process.env.PRIMARY_DOMAIN;
    delete process.env.PUBLIC_ORIGIN;
    const dynamic = new DynamicStorageAdapter();
    expect(() => dynamic.supportsPresignedUrls()).not.toThrow();
    expect(dynamic.supportsPresignedUrls()).toBe(true);
  });

  it('site 4 — DynamicStorageAdapter mints a RELATIVE presigned URL when no origin can be resolved', async () => {
    delete process.env.PRIMARY_DOMAIN;
    delete process.env.PUBLIC_ORIGIN;
    const dynamic = new DynamicStorageAdapter();
    const url = await dynamic.getPresignedUploadUrl!('o/r/uploads/content/a.bin');
    expect(url.startsWith(LOCAL_PRESIGN_PATH)).toBe(true);
    expect(url).not.toMatch(/^https?:\/\//);
  });
});
