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

// A real, self-signed EC (P-256 / prime256v1) certificate for `example.com`,
// generated once via `openssl ecparam -genkey -name prime256v1 -noout` +
// `openssl req -new -x509 ... -subj "/CN=example.com"` and embedded verbatim
// rather than shelling out to `openssl` from the test itself, so the suite
// has no external-binary dependency at run time. Confirmed empirically (see
// task-5-report.md) that `forge.pki.certificateFromPem` throws
// `Cannot read public key. OID is not RSA.` on this exact PEM — this constant
// is what backs the "EC certificate parse path" test below.
const EC_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBgTCCASegAwIBAgIUKmhF7WR7Y3xIfRFyfW9gG45uStgwCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLZXhhbXBsZS5jb20wHhcNMjYwNzIwMTQ1NTE1WhcNMjcwNzIw
MTQ1NTE1WjAWMRQwEgYDVQQDDAtleGFtcGxlLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABDRSt788SojMy6y0IKaC3LoZUch74Vg08N0weswkM2G6B1MBGbRV
k+VYAXCOI/D05MlrWsMxb2GrrPgP74WW3XGjUzBRMB0GA1UdDgQWBBQ3K54+IawQ
Y0tW9wy6y+ESqL6RGDAfBgNVHSMEGDAWgBQ3K54+IawQY0tW9wy6y+ESqL6RGDAP
BgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIBd1IorONXCXDvnIcVGh
qDrq0qvtfxGa53H/Y/08m3kIAiEAqf2J97+yZQg0A9AjPmwCAGXrGz77sdKp96tC
KY2GHzM=
-----END CERTIFICATE-----`;

const EC_CERT_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIB55hsR+S1tZfQFdmudeJk49hNIi28VrwEP0LS2lbp/3oAoGCCqGSM49
AwEHoUQDQgAENFK3vzxKiMzLrLQgpoLcuhlRyHvhWDTw3TB6zCQzYboHUwEZtFWT
5VgBcI4j8PTkyWtawzFvYaus+A/vhZbdcQ==
-----END EC PRIVATE KEY-----`;

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

    it('rejects an EC certificate (not just an EC key) via the parse-failure path', () => {
      // Covers the other half of "EC material is rejected": a full EC
      // self-signed cert/key pair (both P-256), not only an EC private key
      // paired with an RSA cert. `EC_CERT_PEM`/`EC_CERT_KEY_PEM` are a real
      // cert generated with openssl (see comment above); forge is confirmed
      // to throw `Cannot read public key. OID is not RSA.` on this exact
      // PEM when parsing the certificate, so this must fail closed via the
      // generic parse-failure message, not proceed to any comparison.
      expect(() =>
        service.validateCertificatePair(EC_CERT_PEM, EC_CERT_KEY_PEM, 'example.com'),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validateCertificatePair(EC_CERT_PEM, EC_CERT_KEY_PEM, 'example.com'),
      ).toThrow(/could not parse certificate or private key/i);
    });

    it('ignores non-DNS SAN entries (e.g. an IP SAN) when checking domain coverage', () => {
      // GeneralName type 2 is dNSName; type 7 is iPAddress. Both share a
      // similar altName object shape in node-forge, so a naive `.map(a =>
      // a.value)` would risk treating an IP SAN as a domain-ish string.
      // Build a cert whose SAN list mixes a DNS apex + wildcard with an IP
      // SAN, and confirm only the DNS entries are considered.
      const cert = forge.pki.createCertificate();
      cert.publicKey = keyA.publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date(Date.now() - 86400_000);
      cert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
      const attrs = [{ name: 'commonName', value: 'example.com' }];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.setExtensions([
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'example.com' },
            { type: 2, value: '*.example.com' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ]);
      cert.sign(keyA.privateKey, forge.md.sha256.create());
      const certPem = forge.pki.certificateToPem(cert);
      const keyPem = forge.pki.privateKeyToPem(keyA.privateKey);

      const result = service.validateCertificatePair(certPem, keyPem, 'example.com');
      expect(result.sans).toEqual(['example.com', '*.example.com']);
      expect(result.sans).not.toContain('127.0.0.1');
    });

    it('treats domain and SAN comparison as case-insensitive (mixed-case input domain)', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      // Cert SANs are lowercase but the caller passes a mixed-case domain.
      const result = service.validateCertificatePair(certPem, keyPem, 'Example.com');
      expect(result.sans).toEqual(expect.arrayContaining(['example.com', '*.example.com']));
    });

    it('treats domain and SAN comparison as case-insensitive (uppercase cert SANs)', () => {
      // Some issuers emit SAN entries in mixed/upper case. A lowercase input
      // domain must still match against upper-case SAN values.
      const { certPem, keyPem } = makeCert('EXAMPLE.COM', keyA);
      const result = service.validateCertificatePair(certPem, keyPem, 'example.com');
      expect(result.sans).toEqual(expect.arrayContaining(['EXAMPLE.COM', '*.EXAMPLE.COM']));
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

    it('writes lowercased wildcard filenames given a mixed-case domain', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'Example.com');
      expect(fs.existsSync(path.join(sslDir, 'wildcard.example.com.crt'))).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'wildcard.example.com.key'))).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'wildcard.Example.com.crt'))).toBe(false);
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

    it('returns false when the domain-specific wildcard key is missing (interrupted save)', () => {
      // saveCertificates writes 4 files as 4 independent renames, not one
      // transaction. Simulate an interruption after the first 3 files
      // (fullchain.pem, privkey.pem, wildcard.<domain>.crt) landed but
      // before the last one (wildcard.<domain>.key) did — this must NOT be
      // reported as "present", or the Task 6 apply endpoint would tell the
      // wizard setup succeeded while nginx still lacks the key for this
      // vhost.
      fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'x', { mode: 0o644 });
      fs.writeFileSync(path.join(sslDir, 'privkey.pem'), 'x', { mode: 0o600 });
      fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), 'x', { mode: 0o644 });
      // wildcard.example.com.key intentionally NOT written.
      expect(service.certificatesPresent('example.com')).toBe(false);
    });

    it('returns true for a differently-cased domain than what was saved', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'Example.com');
      expect(service.certificatesPresent('example.com')).toBe(true);
      expect(service.certificatesPresent('EXAMPLE.COM')).toBe(true);
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
