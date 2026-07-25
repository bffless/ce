import * as forge from 'node-forge';
import * as crypto from 'crypto';
import { generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BootstrapSetupService } from './bootstrap-setup.service';
import { ApplyBootstrapDto } from './setup.dto';
import { promoteStagedCertificates } from './ssl-staging';

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
  // Cloudflare Origin Certificates can be ECDSA (P-256). Used below to prove
  // a private key of a different algorithm than the certificate's public key
  // (RSA cert + EC key) is rejected by X509Certificate#checkPrivateKey as a
  // mismatch, not falsely treated as a match.
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
  });
  const ecKeyPem = privateKey;
  return { ecKeyPem, domain };
}

// Real, self-signed ECDSA (P-256 / prime256v1) fixtures for `example.com`,
// generated once via openssl and embedded verbatim so the suite has no
// external-binary dependency at run time:
//
//   openssl ecparam -genkey -name prime256v1 -noout -out ec.key
//   openssl req -new -x509 -key ec.key -days 3650 -subj "/CN=example.com" \
//     -addext "subjectAltName=DNS:example.com,DNS:*.example.com" -out ec.crt
//
//   openssl ecparam -genkey -name prime256v1 -noout -out apex.key
//   openssl req -new -x509 -key apex.key -days 3650 -subj "/CN=example.com" \
//     -addext "subjectAltName=DNS:example.com" -out apex.crt
//
// EC_CERT_PEM/EC_KEY_PEM cover apex + wildcard; APEX_ONLY_CERT_PEM/
// APEX_ONLY_KEY_PEM cover only the apex — used to prove the wildcard SAN is
// hard-required on the cloudflare path but merely reported elsewhere.
const EC_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBqDCCAU6gAwIBAgIUFL7EtsweU3frcZOVi/ArXQeaecUwCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLZXhhbXBsZS5jb20wHhcNMjYwNzIxMjIzODU5WhcNMzYwNzE4
MjIzODU5WjAWMRQwEgYDVQQDDAtleGFtcGxlLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABEG/bLtYcQ/mpD8aYxF+JIyItUVXJazIgYUbEOUcp5GEmQIG4Rqu
rEd+yxN4GPtapWsPEa0QFZ/swnu9TAzb7v+jejB4MB0GA1UdDgQWBBSE4+AGe43O
oVU5vkKchLWKdm+ndTAfBgNVHSMEGDAWgBSE4+AGe43OoVU5vkKchLWKdm+ndTAP
BgNVHRMBAf8EBTADAQH/MCUGA1UdEQQeMByCC2V4YW1wbGUuY29tgg0qLmV4YW1w
bGUuY29tMAoGCCqGSM49BAMCA0gAMEUCIAolSpleR+KSijE0BgEZ871Hp1ySvcuf
6EEX0Jm8K56SAiEAqDNp0eYmUqQ1yOTTBFrHWnY8dxnlUuoJlxFaVya3zoo=
-----END CERTIFICATE-----`;

const EC_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIGTNXUHJNsloG2lucbq4JY9EDXAv5VciWItfmslObPPIoAoGCCqGSM49
AwEHoUQDQgAEQb9su1hxD+akPxpjEX4kjIi1RVclrMiBhRsQ5RynkYSZAgbhGq6s
R37LE3gY+1qlaw8RrRAVn+zCe71MDNvu/w==
-----END EC PRIVATE KEY-----`;

const APEX_ONLY_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBmTCCAT+gAwIBAgIUPGdm6HzDeGIHJI0oSXoCzY4cbFcwCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLZXhhbXBsZS5jb20wHhcNMjYwNzIxMjIzODU5WhcNMzYwNzE4
MjIzODU5WjAWMRQwEgYDVQQDDAtleGFtcGxlLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABOH1D6KAwWmLGm43nPURXUyr131K8788CnAJAF/zVzYqS44MduRC
BL8yx6PPvO4k1qvdHqW5dbdoBivXbRVtlyejazBpMB0GA1UdDgQWBBTJZ4GNqvv3
6IIT/wHsHEUlybr3azAfBgNVHSMEGDAWgBTJZ4GNqvv36IIT/wHsHEUlybr3azAP
BgNVHRMBAf8EBTADAQH/MBYGA1UdEQQPMA2CC2V4YW1wbGUuY29tMAoGCCqGSM49
BAMCA0gAMEUCIQDlclkitO3/VC9s9KrtY9QxK5J0xkC4EdXsxU9MeGR0WwIgTSXz
qEKzySvmokG9dpqwJYCLYdgSTHiR3T3O31Z2OBo=
-----END CERTIFICATE-----`;

const APEX_ONLY_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIIkoTrvUHs3Zh2dHNk0mEuVvMx57IPX5dtfHhp4wuM6WoAoGCCqGSM49
AwEHoUQDQgAE4fUPooDBaYsabjec9RFdTKvXfUrzvzwKcAkAX/NXNipLjgx25EIE
vzLHo8+87iTWq90epbl1t2gGK9dtFW2XJw==
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
    service = new BootstrapSetupService(
      { isPlatformManaged: () => false, isBootstrapModeActive: async () => true } as any,
      { isEnabled: () => true } as any,
    );
  });

  describe('validateClaimToken', () => {
    it('delegates to SetupService.validateOnboardingToken with the supplied token', () => {
      const validateOnboardingToken = jest.fn();
      const svc = new BootstrapSetupService(
        { validateOnboardingToken } as any,
        { isEnabled: () => true } as any,
      );
      svc.validateClaimToken('claim-abc');
      expect(validateOnboardingToken).toHaveBeenCalledWith('claim-abc');
    });

    it('propagates the validator throwing on a bad token', () => {
      const validateOnboardingToken = jest.fn(() => {
        throw new Error('Invalid onboarding token');
      });
      const svc = new BootstrapSetupService(
        { validateOnboardingToken } as any,
        { isEnabled: () => true } as any,
      );
      expect(() => svc.validateClaimToken('wrong')).toThrow('Invalid onboarding token');
    });
  });

  describe('finalizeSetup', () => {
    it('delegates to SetupService.finalizeBootstrapSetup', async () => {
      const finalizeBootstrapSetup = jest.fn().mockResolvedValue(undefined);
      const svc = new BootstrapSetupService(
        { finalizeBootstrapSetup } as any,
        { isEnabled: () => true } as any,
      );
      await svc.finalizeSetup();
      expect(finalizeBootstrapSetup).toHaveBeenCalled();
    });
  });

  afterEach(() => {
    fs.rmSync(sslDir, { recursive: true, force: true });
    delete process.env.SSL_CERT_PATH;
  });

  describe('validateCertificatePair', () => {
    it('accepts a matching pair with apex + wildcard SANs', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      const result = service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare');
      expect(result.sans).toEqual(expect.arrayContaining(['example.com', '*.example.com']));
      expect(result.wildcardCovered).toBe(true);
    });

    it('rejects a key that does not match the cert', () => {
      const a = makeCert('example.com', keyA);
      const b = makeCert('example.com', keyB);
      expect(() =>
        service.validateCertificatePair(a.certPem, b.keyPem, 'example.com', 'cloudflare'),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validateCertificatePair(a.certPem, b.keyPem, 'example.com', 'cloudflare'),
      ).toThrow(/does not match/i);
    });

    it('rejects a cert whose SANs do not cover the wildcard (cloudflare policy)', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { includeWildcard: false });
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare'),
      ).toThrow(/wildcard/i);
    });

    it('rejects a cert whose SANs do not cover the apex domain', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { includeApex: false });
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare'),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare'),
      ).toThrow(/does not cover example\.com/i);
    });

    it('rejects an expired cert', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { expired: true });
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare'),
      ).toThrow(/expired/i);
    });

    it('rejects a not-yet-valid cert', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { notYetValid: true });
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare'),
      ).toThrow(/not yet valid/i);
    });

    it('rejects garbage PEM', () => {
      expect(() =>
        service.validateCertificatePair('not a cert', 'not a key', 'example.com', 'cloudflare'),
      ).toThrow(BadRequestException);
    });

    it('rejects a mismatched key of a different algorithm (RSA cert, EC key)', () => {
      // Security-critical case: checkPrivateKey must report a mismatch
      // (never falsely "match") when the certificate's public key and the
      // supplied private key are different algorithms entirely.
      const { certPem } = makeCert('example.com', keyA);
      const { ecKeyPem } = makeEcPair('example.com');
      let caught: unknown;
      try {
        service.validateCertificatePair(certPem, ecKeyPem, 'example.com', 'cloudflare');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
    });

    it('ignores non-DNS SAN entries (e.g. an IP SAN) when checking domain coverage', () => {
      // GeneralName type 2 is dNSName; type 7 is iPAddress. Both show up in
      // X509Certificate#subjectAltName's comma-separated string, so a naive
      // split would risk treating an IP SAN as a domain-ish string.
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

      const result = service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare');
      expect(result.sans).toEqual(['example.com', '*.example.com']);
      expect(result.sans).not.toContain('127.0.0.1');
    });

    it('treats domain and SAN comparison as case-insensitive (mixed-case input domain)', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      // Cert SANs are lowercase but the caller passes a mixed-case domain.
      const result = service.validateCertificatePair(certPem, keyPem, 'Example.com', 'cloudflare');
      expect(result.sans).toEqual(expect.arrayContaining(['example.com', '*.example.com']));
    });

    it('treats domain and SAN comparison as case-insensitive (uppercase cert SANs)', () => {
      // Some issuers emit SAN entries in mixed/upper case. A lowercase input
      // domain must still match against upper-case SAN values.
      const { certPem, keyPem } = makeCert('EXAMPLE.COM', keyA);
      const result = service.validateCertificatePair(certPem, keyPem, 'example.com', 'cloudflare');
      expect(result.sans).toEqual(expect.arrayContaining(['EXAMPLE.COM', '*.EXAMPLE.COM']));
    });

    it('rejects a domain containing path traversal segments', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, '../../etc/nginx/evil', 'cloudflare'),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, '../../etc/nginx/evil', 'cloudflare'),
      ).toThrow(/invalid domain/i);
    });

    it('rejects a domain containing a null byte', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com\0evil', 'cloudflare'),
      ).toThrow(/invalid domain/i);
    });

    it('rejects a domain containing a slash', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(() =>
        service.validateCertificatePair(certPem, keyPem, 'example.com/evil', 'cloudflare'),
      ).toThrow(/invalid domain/i);
    });
  });

  describe('validateCertificatePair (path-aware, ECDSA)', () => {
    it('accepts an ECDSA pair covering apex + wildcard (cloudflare policy)', () => {
      const res = service.validateCertificatePair(EC_CERT_PEM, EC_KEY_PEM, 'example.com', 'cloudflare');
      expect(res.wildcardCovered).toBe(true);
      expect(res.sans).toEqual(expect.arrayContaining(['example.com', '*.example.com']));
    });

    it('hard-requires the wildcard SAN only on the cloudflare path', () => {
      expect(() =>
        service.validateCertificatePair(APEX_ONLY_CERT_PEM, APEX_ONLY_KEY_PEM, 'example.com', 'cloudflare'),
      ).toThrow(/wildcard/);
      const res = service.validateCertificatePair(APEX_ONLY_CERT_PEM, APEX_ONLY_KEY_PEM, 'example.com', 'none');
      expect(res.wildcardCovered).toBe(false);
    });

    it('always hard-requires the apex', () => {
      expect(() =>
        service.validateCertificatePair(EC_CERT_PEM, EC_KEY_PEM, 'other.com', 'none'),
      ).toThrow(/does not cover other.com/);
    });

    it('rejects a mismatched key (EC cert, different EC key)', () => {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const otherKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      expect(() =>
        service.validateCertificatePair(EC_CERT_PEM, otherKeyPem, 'example.com', 'none'),
      ).toThrow(/does not match/);
    });
  });

  describe('saveCertificates', () => {
    it('saves the four cert files with correct permissions', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      // #514: saveCertificates writes into staging/, not the live dir.
      const stagingDir = path.join(sslDir, 'staging');
      const mode = (f: string) => fs.statSync(path.join(stagingDir, f)).mode & 0o777;
      expect(mode('fullchain.pem')).toBe(0o644);
      expect(mode('privkey.pem')).toBe(0o600);
      expect(mode('wildcard.example.com.crt')).toBe(0o644);
      expect(mode('wildcard.example.com.key')).toBe(0o600);
    });

    it('writes exactly the expected file contents', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      // #514: saveCertificates writes into staging/, not the live dir.
      const stagingDir = path.join(sslDir, 'staging');
      expect(fs.readFileSync(path.join(stagingDir, 'fullchain.pem'), 'utf8')).toBe(certPem);
      expect(fs.readFileSync(path.join(stagingDir, 'privkey.pem'), 'utf8')).toBe(keyPem);
      expect(fs.readFileSync(path.join(stagingDir, 'wildcard.example.com.crt'), 'utf8')).toBe(certPem);
      expect(fs.readFileSync(path.join(stagingDir, 'wildcard.example.com.key'), 'utf8')).toBe(keyPem);
    });

    it('leaves no stray .tmp files behind', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      // #514: the atomic write's tmp files land (and get renamed away) in
      // staging/, the dir saveCertificates now writes into.
      const stray = fs.readdirSync(path.join(sslDir, 'staging')).filter((f) => f.includes('.tmp'));
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
      // #514: saveCertificates writes into staging/, not the live dir.
      const stagingDir = path.join(sslDir, 'staging');
      expect(fs.existsSync(path.join(stagingDir, 'wildcard.example.com.crt'))).toBe(true);
      expect(fs.existsSync(path.join(stagingDir, 'wildcard.example.com.key'))).toBe(true);
      expect(fs.existsSync(path.join(stagingDir, 'wildcard.Example.com.crt'))).toBe(false);
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

  describe('validateDomain', () => {
    // Task 6's apply() controller endpoint calls writeInstanceConfig directly
    // with the domain, and returns it in the adminUrl response — neither of
    // which goes through validateCertificatePair/saveCertificates/
    // certificatesPresent's internal validation and normalization. This
    // public wrapper around the same assertValidDomain used everywhere else
    // in this service lets the controller explicitly validate+normalize
    // before either of those things happens, rather than relying on the
    // side effect of an unrelated call happening to run first.
    it('returns the domain lowercased', () => {
      expect(service.validateDomain('Example.COM')).toBe('example.com');
    });

    it('trims surrounding whitespace instead of rejecting it', () => {
      // A trailing space is an accidental paste artifact ("example.com "), not a
      // different domain — it must normalize, not 400 the issue-certificate call.
      expect(service.validateDomain('  example.com  ')).toBe('example.com');
      expect(service.validateDomain('example.com\n')).toBe('example.com');
    });

    it('still rejects internal whitespace (a real typo, not trimmable)', () => {
      expect(() => service.validateDomain('exa mple.com')).toThrow(/invalid domain/i);
    });

    it('rejects a domain containing path traversal segments', () => {
      expect(() => service.validateDomain('../../etc/nginx/evil')).toThrow(BadRequestException);
      expect(() => service.validateDomain('../../etc/nginx/evil')).toThrow(/invalid domain/i);
    });

    it('rejects a domain containing shell metacharacters', () => {
      // instance.env (written by writeInstanceConfig) is sourced as shell by
      // the nginx render script. A domain string reaching that file must
      // never carry characters outside a plain hostname's charset.
      expect(() => service.validateDomain('example.com; rm -rf /')).toThrow(BadRequestException);
      expect(() => service.validateDomain('example.com$(whoami)')).toThrow(BadRequestException);
    });

    it('rejects a domain containing a null byte', () => {
      expect(() => service.validateDomain('example.com\0evil')).toThrow(/invalid domain/i);
    });
  });

  describe('assertBootstrapAllowed', () => {
    it('throws ForbiddenException when platform-managed', async () => {
      const svc = new BootstrapSetupService(
        { isPlatformManaged: () => true, isBootstrapModeActive: async () => true } as any,
        { isEnabled: () => true } as any,
      );
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(ForbiddenException);
    });

    it('checks platform-managed before the feature flag (fails closed on platform)', async () => {
      // Even if the flag is somehow on, platform-managed always wins.
      const svc = new BootstrapSetupService(
        { isPlatformManaged: () => true, isBootstrapModeActive: async () => true } as any,
        { isEnabled: () => true } as any,
      );
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(
        /platform-managed/i,
      );
    });

    it('throws BadRequestException when the flag is disabled', async () => {
      const svc = new BootstrapSetupService(
        { isPlatformManaged: () => false, isBootstrapModeActive: async () => true } as any,
        { isEnabled: () => false } as any,
      );
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(BadRequestException);
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(/disabled/i);
    });

    it('throws ForbiddenException when bootstrap mode is not active (applied/complete/legacy install)', async () => {
      // The critical post-review gate: flag ON, not platform-managed, but the
      // instance is no longer (or never was) in bootstrap mode — an applied
      // instance, a completed setup, or a legacy certbot install. Without
      // this, any admin session on a working install could overwrite the
      // live fullchain.pem/privkey.pem via POST /api/setup/certificates or
      // rewrite instance.json via POST /api/setup/apply.
      const svc = new BootstrapSetupService(
        { isPlatformManaged: () => false, isBootstrapModeActive: async () => false } as any,
        { isEnabled: () => true } as any,
      );
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(ForbiddenException);
      await expect(svc.assertBootstrapAllowed()).rejects.toThrow(/not active/i);
    });

    it('resolves without throwing when not platform-managed, flag enabled, and bootstrap mode active', async () => {
      await expect(service.assertBootstrapAllowed()).resolves.toBeUndefined();
    });
  });

  describe('assertStagedCertificateCovers', () => {
    it('passes when the staged fullchain.pem covers the domain', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      expect(() => service.assertStagedCertificateCovers('example.com', 'cloudflare')).not.toThrow();
    });

    it('rejects the change-of-mind sequence: upload A, apply A (promotes to live), upload B, apply A again', () => {
      // #514 F1: saveCertificates now clears any PRIOR STAGE before writing,
      // so the classic "upload A, upload B" trap can no longer arise purely
      // within staging/ (the B upload wipes A's staged files outright). The
      // trap still arises across live + staging: promote A to live (a real
      // apply()), then upload B for a different domain — live keeps A's
      // wildcard.* files while staging's generic pair now holds B's
      // material. certificatesPresent('example.com') still passes on the
      // leftover live wildcard.example.com.* files while fullchain.pem
      // (staging, unioned in by certificatesPresent) now holds B's cert.
      // Applying example.com at that point would put nginx up serving
      // example.com's vhosts with other.com's certificate.
      const a = makeCert('example.com', keyA);
      const b = makeCert('other.com', keyB);
      service.saveCertificates(a.certPem, a.keyPem, 'example.com');
      promoteStagedCertificates(); // simulate apply() promoting A to live
      service.saveCertificates(b.certPem, b.keyPem, 'other.com');

      expect(service.certificatesPresent('example.com')).toBe(true); // the trap
      expect(() => service.assertStagedCertificateCovers('example.com', 'cloudflare')).toThrow(
        BadRequestException,
      );
      expect(() => service.assertStagedCertificateCovers('example.com', 'cloudflare')).toThrow(
        /does not cover example\.com/i,
      );
      // The most recent upload's domain still applies cleanly.
      expect(() => service.assertStagedCertificateCovers('other.com', 'cloudflare')).not.toThrow();
    });

    it('throws (rather than passes) when fullchain.pem is missing or unparseable', () => {
      expect(() => service.assertStagedCertificateCovers('example.com', 'cloudflare')).toThrow(
        /could not be read/i,
      );
      fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'not a certificate');
      expect(() => service.assertStagedCertificateCovers('example.com', 'cloudflare')).toThrow(
        /could not be read/i,
      );
    });

    it('rejects a path-traversal domain before touching the filesystem', () => {
      expect(() => service.assertStagedCertificateCovers('../../etc/nginx/evil', 'cloudflare')).toThrow(
        /invalid domain/i,
      );
    });

    it('reports (rather than throws) a missing wildcard on the non-cloudflare path', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA, { includeWildcard: false });
      service.saveCertificates(certPem, keyPem, 'example.com');
      expect(() => service.assertStagedCertificateCovers('example.com', 'none')).not.toThrow();
      expect(() => service.assertStagedCertificateCovers('example.com', 'cloudflare')).toThrow(
        /wildcard/i,
      );
    });
  });

  describe('staging semantics (#514)', () => {
    const stagingDir = () => path.join(sslDir, 'staging');

    it('saveCertificates writes the four files into staging/, not the live dir', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      service.saveCertificates(certPem, keyPem, 'example.com');
      for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.example.com.crt', 'wildcard.example.com.key']) {
        expect(fs.existsSync(path.join(stagingDir(), f))).toBe(true);
        expect(fs.existsSync(path.join(sslDir, f))).toBe(false);
      }
    });

    it('saveCertificates clears any prior stage before writing (#514 F1) — no accumulation', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      // Seed a junk file plus a stale pair from an earlier, abandoned stage.
      fs.mkdirSync(stagingDir(), { recursive: true });
      fs.writeFileSync(path.join(stagingDir(), 'junk.txt'), 'JUNK');
      fs.writeFileSync(path.join(stagingDir(), 'wildcard.stale.com.crt'), 'STALE');
      fs.writeFileSync(path.join(stagingDir(), 'wildcard.stale.com.key'), 'STALE');

      service.saveCertificates(certPem, keyPem, 'example.com');

      const files = fs.readdirSync(stagingDir()).sort();
      expect(files).toEqual([
        'fullchain.pem',
        'privkey.pem',
        'wildcard.example.com.crt',
        'wildcard.example.com.key',
      ]);
    });

    it('certificatesPresent is a per-file union of staging and live', () => {
      const { certPem, keyPem } = makeCert('example.com', keyA);
      expect(service.certificatesPresent('example.com')).toBe(false);
      // generic pair staged, wildcard pair live (the LE + real-DNS-01-wildcard case)
      fs.mkdirSync(stagingDir(), { recursive: true });
      fs.writeFileSync(path.join(stagingDir(), 'fullchain.pem'), certPem);
      fs.writeFileSync(path.join(stagingDir(), 'privkey.pem'), keyPem);
      fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), certPem);
      fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.key'), keyPem);
      expect(service.certificatesPresent('example.com')).toBe(true);
    });

    it('assertStagedCertificateCovers prefers the STAGED fullchain over the live one', () => {
      const a = makeCert('aaa.com', keyA); // live: covers only aaa.com
      const b = makeCert('bbb.com', keyB); // staged: covers only bbb.com
      fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), a.certPem);
      fs.mkdirSync(stagingDir(), { recursive: true });
      fs.writeFileSync(path.join(stagingDir(), 'fullchain.pem'), b.certPem);
      // staged cert covers bbb.com → passes even though live covers only aaa.com
      expect(() => service.assertStagedCertificateCovers('bbb.com', 'proxy')).not.toThrow();
      // and correctly fails for aaa.com (staged takes precedence)
      expect(() => service.assertStagedCertificateCovers('aaa.com', 'proxy')).toThrow(/does not cover/);
    });

    it('assertStagedCertificateCovers falls back to the live fullchain when nothing is staged', () => {
      const a = makeCert('aaa.com', keyA);
      fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), a.certPem);
      expect(() => service.assertStagedCertificateCovers('aaa.com', 'proxy')).not.toThrow();
    });
  });

  describe('validateApplyConfig', () => {
    const base = { domain: 'example.com', token: undefined };

    it('resolves cloudflare preset defaults', () => {
      const cfg = service.validateApplyConfig({ ...base, proxyMode: 'cloudflare', sslMode: 'paste' } as ApplyBootstrapDto);
      expect(cfg).toEqual({
        proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: { preset: 'cloudflare' },
      });
    });

    it('resolves direct + letsencrypt', () => {
      const cfg = service.validateApplyConfig({ ...base, proxyMode: 'none', sslMode: 'letsencrypt' } as ApplyBootstrapDto);
      expect(cfg).toEqual({ proxyMode: 'none', sslMode: 'letsencrypt', port80: 'redirect', realIp: null });
    });

    it('rejects letsencrypt on cloudflare (needs its own Origin Certificate)', () => {
      expect(() =>
        service.validateApplyConfig({ ...base, proxyMode: 'cloudflare', sslMode: 'letsencrypt' } as ApplyBootstrapDto),
      ).toThrow(BadRequestException);
    });

    it('rejects closed port 80 on a direct install', () => {
      expect(() =>
        service.validateApplyConfig({ ...base, proxyMode: 'none', sslMode: 'paste', port80: 'closed' } as ApplyBootstrapDto),
      ).toThrow(BadRequestException);
    });

    it('rejects custom realIp outside proxy mode', () => {
      expect(() =>
        service.validateApplyConfig({
          ...base, proxyMode: 'cloudflare', sslMode: 'paste',
          realIp: { header: 'X-Forwarded-For', ranges: ['1.2.3.0/24'] },
        } as ApplyBootstrapDto),
      ).toThrow(BadRequestException);
    });

    it('accepts valid custom realIp for proxy mode (v4 + v6 CIDRs)', () => {
      const cfg = service.validateApplyConfig({
        ...base, proxyMode: 'proxy', sslMode: 'paste',
        realIp: { header: 'True-Client-IP', ranges: ['151.101.0.0/16', '2a04:4e40::/32'] },
      } as ApplyBootstrapDto);
      expect(cfg.realIp).toEqual({ header: 'True-Client-IP', ranges: ['151.101.0.0/16', '2a04:4e40::/32'] });
      expect(cfg.port80).toBe('redirect');
    });

    it.each([
      ['not-a-cidr'], ['1.2.3.4'], ['1.2.3.0/33'], ['1.2.3.0/24; rm -rf /'], ['2a04:4e40::/129'],
    ])('rejects malformed CIDR %s', (range) => {
      expect(() =>
        service.validateApplyConfig({
          ...base, proxyMode: 'proxy', sslMode: 'paste',
          realIp: { header: 'X-Forwarded-For', ranges: [range] },
        } as ApplyBootstrapDto),
      ).toThrow(BadRequestException);
    });

    it('rejects a header that is not an HTTP token', () => {
      expect(() =>
        service.validateApplyConfig({
          ...base, proxyMode: 'proxy', sslMode: 'paste',
          realIp: { header: 'X-Forwarded-For\nset_real_ip_from 0.0.0.0/0', ranges: ['1.2.3.0/24'] },
        } as ApplyBootstrapDto),
      ).toThrow(BadRequestException);
    });

    it('resolves proxy + selfsigned (the default CDN case)', () => {
      const cfg = service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'proxy', sslMode: 'selfsigned',
      } as ApplyBootstrapDto);
      expect(cfg).toEqual({ proxyMode: 'proxy', sslMode: 'selfsigned', port80: 'redirect', realIp: null });
    });

    it('allows letsencrypt on the proxy path (CDN ACME pass-through)', () => {
      const cfg = service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'proxy', sslMode: 'letsencrypt',
      } as ApplyBootstrapDto);
      expect(cfg.sslMode).toBe('letsencrypt');
      expect(cfg.port80).toBe('redirect');
    });

    it('rejects selfsigned on the direct path (browser would see the warning)', () => {
      expect(() => service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'none', sslMode: 'selfsigned',
      } as ApplyBootstrapDto)).toThrow(BadRequestException);
    });

    it('rejects selfsigned on the cloudflare path', () => {
      expect(() => service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'selfsigned',
      } as ApplyBootstrapDto)).toThrow(BadRequestException);
    });

    it('rejects letsencrypt with port 80 closed even on the proxy path', () => {
      expect(() => service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'proxy', sslMode: 'letsencrypt', port80: 'closed',
      } as ApplyBootstrapDto)).toThrow(/Port 80 must stay open/);
    });

    it('m13: cloudflare apply with no explicit port80 defaults to redirect (fresh CF zones have Always-Use-HTTPS off; closed → edge 520s)', () => {
      const out = service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste',
      } as ApplyBootstrapDto);
      expect(out.port80).toBe('redirect');
    });

    it('m13: explicit closed on cloudflare is still honored', () => {
      const out = service.validateApplyConfig({
        domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste', port80: 'closed',
      } as ApplyBootstrapDto);
      expect(out.port80).toBe('closed');
    });
  });
});
