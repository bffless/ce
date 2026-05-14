import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Shared AES-256-GCM encrypt/decrypt for credential-bearing rows
 * (system_config encrypted blobs, oidc_providers.config_encrypted,
 * google_integration_credentials.config_encrypted).
 *
 * Wire format: `iv:authTag:ciphertext` — all hex. Compatible with the
 * inline implementations previously duplicated across services; do NOT
 * change the format without a migration.
 *
 * The key comes from the `ENCRYPTION_KEY` env var (base64-encoded 32 bytes).
 * If unset, a random key is generated at module load — values encrypted
 * with that key become unrecoverable across restarts. Self-hosters must
 * set ENCRYPTION_KEY before first run; the setup wizard enforces this.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 16;
const logger = new Logger('AesGcm');

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv) {
    cachedKey = Buffer.from(fromEnv, 'base64');
  } else {
    cachedKey = crypto.randomBytes(32);
    logger.warn(
      'No ENCRYPTION_KEY found. Generated a temporary key — encrypted values will be unrecoverable across restarts.',
    );
  }
  return cachedKey;
}

/** Internal: encrypt a UTF-8 string. */
export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/** Internal: decrypt to a UTF-8 string. Throws on bad ciphertext / wrong key. */
export function decryptString(encrypted: string): string {
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Encrypt a JSON-serialisable value. */
export function encryptJson<T>(value: T): string {
  return encryptString(JSON.stringify(value));
}

/** Decrypt a value previously encoded with `encryptJson`. */
export function decryptJson<T>(encrypted: string): T {
  return JSON.parse(decryptString(encrypted)) as T;
}

/** Test-only: reset the cached key so a different ENCRYPTION_KEY can be picked up. */
export function __resetKeyForTests(): void {
  cachedKey = null;
}
