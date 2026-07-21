import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as forge from 'node-forge';
import { SslCertificateService } from './ssl-certificate.service';

/**
 * Mint a real, self-signed cert/key pair carrying the given SANs, using the
 * same node-forge pattern as SslCertificateService.selfSignWithForge (and
 * bootstrap-setup.service.spec.ts's makeCert) — no external openssl binary
 * or ACME server needed to exercise X509Certificate-based SAN detection.
 */
function makeCert(commonName: string, altNames: string[]): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'subjectAltName', altNames: altNames.map((v) => ({ type: 2, value: v })) },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

// A genuine DNS-01 wildcard cert for example.com — carries *.example.com in
// its SAN list, which is what installedWildcardIsReal() keys off of.
const { certPem: REAL_WILDCARD_CERT_PEM, keyPem: REAL_WILDCARD_KEY_PEM } = makeCert(
  'example.com',
  ['*.example.com', 'example.com'],
);

describe('SslCertificateService.requestPrimaryDomainCertificate', () => {
  let sslDir: string;

  beforeEach(() => {
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = sslDir;
    process.env.MOCK_SSL = 'true'; // exercise the mock path — no network
  });
  afterEach(() => {
    delete process.env.SSL_CERT_PATH;
    delete process.env.MOCK_SSL;
    fs.rmSync(sslDir, { recursive: true, force: true });
  });

  it('mock mode writes all four cert files and reports the SANs', async () => {
    const service = new SslCertificateService();
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.success).toBe(true);
    expect(res.sans).toEqual(['example.com', 'www.example.com', 'admin.example.com']);
    for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.example.com.crt', 'wildcard.example.com.key']) {
      expect(fs.existsSync(path.join(sslDir, f))).toBe(true);
    }
  });

  it('primary renewal does not clobber a real DNS-01 wildcard', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    // Simulate a real wildcard install: overwrite the copies with a marker
    // cert carrying the *.example.com SAN (minted via the forge helper pattern).
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), REAL_WILDCARD_CERT_PEM);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.key'), REAL_WILDCARD_KEY_PEM);
    fs.rmSync(path.join(sslDir, 'fullchain.pem')); // force re-issue
    await service.requestPrimaryDomainCertificate('example.com');
    expect(fs.readFileSync(path.join(sslDir, 'wildcard.example.com.crt'), 'utf8')).toBe(
      REAL_WILDCARD_CERT_PEM,
    );
  });

  it('is idempotent — a second call reuses the staged cert', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    const firstCert = fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8');
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(firstCert);
  });

  it('getPrimaryCertificateExpiryDays reads the staged cert', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    const days = service.getPrimaryCertificateExpiryDays();
    expect(days).toBeGreaterThan(80); // mock certs are minted for 90 days
  });
});
