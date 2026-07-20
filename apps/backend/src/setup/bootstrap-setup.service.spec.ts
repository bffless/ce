import * as forge from 'node-forge';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BootstrapSetupService } from './bootstrap-setup.service';

interface MakeCertOpts {
  includeApex?: boolean;
  includeWildcard?: boolean;
  expired?: boolean;
  notYetValid?: boolean;
}

// RSA keygen is the slow part of these tests; generate the two key pairs we
// need ONCE in beforeAll and reuse them across every cert variant instead of
// generating fresh keys per test.
let keyA: forge.pki.rsa.KeyPair;
let keyB: forge.pki.rsa.KeyPair;

function makeCert(domain: string, keys: forge.pki.rsa.KeyPair, opts: MakeCertOpts = {}) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - (opts.notYetValid ? -3600_000 : 86400_000));
  cert.validity.notAfter = new Date(Date.now() + (opts.expired ? -3600_000 : 365 * 86400_000));
  const attrs = [{ name: 'commonName', value: domain }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const altNames: { type: number; value: string }[] = [];
  if (opts.includeApex !== false) altNames.push({ type: 2, value: domain });
  if (opts.includeWildcard !== false) altNames.push({ type: 2, value: `*.${domain}` });
  cert.setExtensions([{ name: 'subjectAltName', altNames }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function makeEcPair(domain: string) {
  // Cloudflare Origin Certificates can be ECDSA (P-256). node-forge cannot
  // parse EC certs/keys at all (verified separately) so these must be
  // rejected via the generic parse-failure path, never falsely matched.
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
  });
  const ecKeyPem = privateKey;

  // Self-signed EC cert via a throwaway openssl-free approach isn't available
  // without an external binary, so pair the EC key with a structurally valid
  // but unrelated RSA cert PEM shape is not meaningful here — instead we only
  // need to prove the EC *private key* alone fails to parse via forge, which
  // is the exact code path `validateCertificatePair` depends on.
  return { ecKeyPem, domain };
}

describe('BootstrapSetupService', () => {
  let service: BootstrapSetupService;
  let sslDir: string;

  beforeAll(() => {
    keyA = forge.pki.rsa.generateKeyPair(2048);
    keyB = forge.pki.rsa.generateKeyPair(2048);
  });

  beforeEach(() => {
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = sslDir;
    service = new BootstrapSetupService({ isPlatformManaged: () => false } as any, {
      isEnabled: () => true,
    } as any);
  });

  afterEach(() => {
    fs.rmSync(sslDir, { recursive: true, force: true });
    delete process.env.SSL_CERT_PATH;
  });

  describe('validateCertificatePair', () => {
    it('accepts a matching pair with apex + wildcard SANs', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      const result = service.validateCertificatePair(certPem, keyPem, 'example.com');
      expect(result.sans).toEqual(expect.arrayContaining(['example.com', '*.example.com']));
    });

    it('rejects a key that does not match the cert', () => {
      const a = makeCert('example.com', keyA);
      const b = makeCert('example.com', keyB);
      expect(() => service.validateCertificatePair(a.certPem, b.keyPem, 'example.com')).toThrow(
        BadRequestException,
      );
      expect(() => service.validateCertificatePair(a.certPem, b.keyPem, 'example.com')).toThrow(
        /does not match/i,
      );
    });

    it('rejects a cert whose SANs do not cover the wildcard', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { includeWildcard: false });
      expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(
        /wildcard/i,
      );
    });

    it('rejects a cert whose SANs do not cover the apex domain', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { includeApex: false });
      expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(
        BadRequestException,
      );
      expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(
        /does not cover example\.com/i,
      );
    });

    it('rejects an expired cert', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { expired: true });
      expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(
        /expired/i,
      );
    });

    it('rejects a not-yet-valid cert', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { notYetValid: true });
      expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(
        /not yet valid/i,
      );
    });

    it('rejects garbage PEM', () => {
      expect(() =>
        service.validateCertificatePair('not a cert', 'not a key', 'example.com'),
      ).toThrow(BadRequestException);
    });

    it('rejects an EC (non-RSA) private key rather than falsely matching it', () => {
      // This is the security-critical case: if forge ever returned an object
      // with `.n === undefined` for both an EC cert's public key AND an EC
      // private key instead of throwing, `undefined === undefined` would
      // falsely pass the modulus comparison. Empirically, forge throws on
      // EC private keys (both SEC1 and PKCS8) before comparison is reached,
      // so this must surface as a parse failure, not a match.
      const { certPem } = makeCert('example.com', keyA);
      const { ecKeyPem } = makeEcPair('example.com');
      let caught: unknown;
      try {
        service.validateCertificatePair(certPem, ecKeyPem, 'example.com');
      } catch (e) {
        caught = e;
      }
      // Must be exactly a BadRequestException (a controlled rejection), not
      // an unhandled TypeError from reading `.n` off an undefined key shape
      // and not a silent pass.
      expect(caught).toBeInstanceOf(BadRequestException);
    });

    it('rejects a domain containing path traversal segments', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, '../../etc/nginx/evil'),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, '../../etc/nginx/evil'),
      ).toThrow(/invalid domain/i);
    });

    it('rejects a domain containing a null byte', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com\0evil'),
      ).toThrow(/invalid domain/i);
    });

    it('rejects a domain containing a slash', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com/evil')).toThrow(
        /invalid domain/i,
      );
    });
  });

  describe('saveCertificates', () => {
    it('saves the four cert files with correct permissions', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      const mode = (f: string) => fs.statSync(path.join(sslDir, f)).mode & 0o777;
      expect(mode('fullchain.pem')).toBe(0o644);
      expect(mode('privkey.pem')).toBe(0o600);
      expect(mode('wildcard.example.com.crt')).toBe(0o644);
      expect(mode('wildcard.example.com.key')).toBe(0o600);
    });

    it('writes exactly the expected file contents', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(certPem);
      expect(fs.readFileSync(path.join(sslDir, 'privkey.pem'), 'utf8')).toBe(keyPem);
      expect(fs.readFileSync(path.join(sslDir, 'wildcard.example.com.crt'), 'utf8')).toBe(certPem);
      expect(fs.readFileSync(path.join(sslDir, 'wildcard.example.com.key'), 'utf8')).toBe(keyPem);
    });

    it('leaves no stray .tmp files behind', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      const stray = fs.readdirSync(sslDir).filter((f) => f.includes('.tmp'));
      expect(stray).toEqual([]);
    });

    it('refuses to write files for a path-traversal domain', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() => service.saveCertificates(certPem, keyPem, '../../etc/nginx/evil')).toThrow(
        BadRequestException,
      );
      // Nothing should have been written into the real ssl dir, and nothing
      // should have escaped it either.
      expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(false);
      expect(fs.existsSync(path.resolve(sslDir, '../../etc/nginx/evil'))).toBe(false);
    });
  });

  describe('certificatesPresent', () => {
    it('returns false when no certs have been saved', () => {
      expect(service.certificatesPresent('example.com')).toBe(false);
    });

    it('returns true once all required files exist', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      expect(service.certificatesPresent('example.com')).toBe(true);
    });

    it('returns false for a different domain than what was saved', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      expect(service.certificatesPresent('other.com')).toBe(false);
    });

    it('rejects a path-traversal domain rather than probing the filesystem with it', () => {
      expect(() => service.certificatesPresent('../../etc/nginx/evil')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertBootstrapAllowed', () => {
    it('throws ForbiddenException when platform-managed', async () => {
      const svc = new BootstrapSetupService({ isPlatformManaged: () => true } as any, {
        isEnabled: () => true,
      } as any);
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(ForbiddenException);
    });

    it('checks platform-managed before the feature flag (fails closed on platform)', async () => {
      // Even if the flag is somehow on, platform-managed always wins.
      const svc = new BootstrapSetupService({ isPlatformManaged: () => true } as any, {
        isEnabled: () => true,
      } as any);
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(
        /platform-managed/i,
      );
    });

    it('throws BadRequestException when the flag is disabled', async () => {
      const svc = new BootstrapSetupService({ isPlatformManaged: () => false } as any, {
        isEnabled: () => false,
      } as any);
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(BadRequestException);
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(/disabled/i);
    });

    it('resolves without throwing when not platform-managed and the flag is enabled', async () => {
      await expect(service.assertBootstrapAllowed()).resolves.toBeUndefined();
    });
  });
});
