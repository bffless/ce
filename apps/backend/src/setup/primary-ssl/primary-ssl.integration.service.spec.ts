// Integration test with the REAL BootstrapSetupService and the REAL
// PrimarySslSnapshotService (real instance-config + real cert files on
// tmpdirs, real staging dir under SSL_CERT_PATH/staging). This is the test
// the fully-mocked service spec (primary-ssl.service.spec.ts) misses: it
// exercises the actual stage -> apply(promote) -> rollback cycle through
// ssl-staging.ts, with real X509 cert/key validation, and asserts the LIVE
// cert bytes at each step.
//
// Deliberately NO `jest.mock('../../bootstrap/instance-config')` here
// (unlike primary-ssl.service.spec.ts) so the real snapshot service
// reads/writes real instance.json + cert bytes under BOOTSTRAP_DIR /
// SSL_CERT_PATH.
import * as forge from 'node-forge';
import { PrimarySslService } from './primary-ssl.service';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { BootstrapSetupService } from '../bootstrap-setup.service';
import { writeInstanceConfig } from '../../bootstrap/instance-config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const domain = 'a.com';

// RSA keygen is the slow part of these tests; generate the two distinct key
// pairs once in beforeAll and reuse them across every test instead of
// generating fresh keys each time. Two DISTINCT pairs (not just two cert
// variants of the same key) so the "old" and "new" cert PEMs — and their
// wildcard siblings — are byte-for-byte distinguishable, letting the
// assertions below check actual file CONTENT rather than mere existence.
let keyOld: forge.pki.rsa.KeyPair;
let keyNew: forge.pki.rsa.KeyPair;

function makeCert(d: string, keys: forge.pki.rsa.KeyPair) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  const attrs = [{ name: 'commonName', value: d }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: d },
        { type: 2, value: `*.${d}` },
      ],
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe('PrimarySslService cert staging (real BootstrapSetupService + snapshot service)', () => {
  let bootDir: string;
  let sslDir: string;
  let svc: PrimarySslService;
  let oldCertPem: string;
  let oldKeyPem: string;
  let newCertPem: string;
  let newKeyPem: string;

  beforeAll(() => {
    keyOld = forge.pki.rsa.generateKeyPair(2048);
    keyNew = forge.pki.rsa.generateKeyPair(2048);
    ({ certPem: oldCertPem, keyPem: oldKeyPem } = makeCert(domain, keyOld));
    ({ certPem: newCertPem, keyPem: newKeyPem } = makeCert(domain, keyNew));
  });

  beforeEach(() => {
    bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-'));
    process.env.BOOTSTRAP_DIR = bootDir;
    process.env.SSL_CERT_PATH = sslDir;
    // Applied instance with a primary domain — the baseline "known-good" state.
    writeInstanceConfig(
      { version: 2, state: 'applied', primaryDomain: domain, proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null },
      bootDir,
    );

    const bootstrap = new BootstrapSetupService({} as any, {} as any);
    const ssl = { requestPrimaryDomainCertificate: jest.fn() };
    const preflight = { run: jest.fn().mockResolvedValue({ ok: true, checks: [] }) };
    const info = { getWildcardCertInfo: jest.fn().mockResolvedValue(null) };
    const snap = new PrimarySslSnapshotService();
    svc = new PrimarySslService(bootstrap, ssl as any, preflight as any, info as any, snap);
  });

  afterEach(() => {
    delete process.env.BOOTSTRAP_DIR;
    delete process.env.SSL_CERT_PATH;
  });

  it('stagePaste leaves the live cert untouched until apply promotes it', () => {
    // seed a live cert as the "currently served" one
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), oldCertPem);
    fs.writeFileSync(path.join(sslDir, 'privkey.pem'), oldKeyPem);
    svc.stagePaste({ certificatePem: newCertPem, privateKeyPem: newKeyPem, servingMode: 'proxy' } as any);
    // live file unchanged; staged file holds the new cert
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(oldCertPem);
    expect(fs.readFileSync(path.join(sslDir, 'staging', 'fullchain.pem'), 'utf8')).toBe(newCertPem);
  });

  it('apply promotes the staged cert and rollback restores the OLD live cert', async () => {
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), oldCertPem);
    fs.writeFileSync(path.join(sslDir, 'privkey.pem'), oldKeyPem);
    svc.stagePaste({ certificatePem: newCertPem, privateKeyPem: newKeyPem, servingMode: 'none' } as any);
    await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect' } as any);
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(newCertPem);
    expect(fs.existsSync(path.join(sslDir, 'staging'))).toBe(false);
    svc.rollback();
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(oldCertPem);
  });

  it('discardStaged aborts a stage cleanly', () => {
    svc.stagePaste({ certificatePem: newCertPem, privateKeyPem: newKeyPem, servingMode: 'proxy' } as any);
    svc.discardStaged();
    expect(fs.existsSync(path.join(sslDir, 'staging'))).toBe(false);
  });
});
