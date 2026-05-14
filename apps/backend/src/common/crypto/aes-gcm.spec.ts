import * as crypto from 'crypto';
import {
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  __resetKeyForTests,
} from './aes-gcm';

// Deterministic test key — must be a 32-byte buffer encoded base64.
const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');

describe('common/crypto/aes-gcm', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY_BASE64;
    __resetKeyForTests();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    __resetKeyForTests();
  });

  it('round-trips a string through encrypt/decrypt', () => {
    const plaintext = 'hello world — UTF-8 résumé ✨';
    const ciphertext = encryptString(plaintext);
    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext.split(':')).toHaveLength(3); // iv:authTag:ct
    expect(decryptString(ciphertext)).toBe(plaintext);
  });

  it('round-trips a JSON object', () => {
    const value = { clientId: 'cid', clientSecret: 'sec', scopes: ['s1', 's2'] };
    const ciphertext = encryptJson(value);
    const decrypted = decryptJson<typeof value>(ciphertext);
    expect(decrypted).toEqual(value);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const plaintext = 'same input';
    const a = encryptString(plaintext);
    const b = encryptString(plaintext);
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe(plaintext);
    expect(decryptString(b)).toBe(plaintext);
  });

  it('decrypts ciphertext written by the legacy inline format (iv:authTag:ciphertext hex)', () => {
    // Reproduces the wire format the previous inline implementations in
    // google-oauth-settings.service.ts and oidc-providers.service.ts emitted,
    // proving the shared util is byte-compatible with already-encrypted rows
    // in production databases.
    const key = Buffer.from(TEST_KEY_BASE64, 'base64');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify({ clientId: 'legacy-cid', clientSecret: 'legacy-sec' });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    const wireFormat = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

    const decoded = decryptJson<{ clientId: string; clientSecret: string }>(wireFormat);
    expect(decoded).toEqual({ clientId: 'legacy-cid', clientSecret: 'legacy-sec' });
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const ciphertext = encryptString('original');
    const [iv, tag, body] = ciphertext.split(':');
    // Flip a byte in the ciphertext body
    const tampered = body.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    expect(() => decryptString(`${iv}:${tag}:${tampered}`)).toThrow();
  });
});
