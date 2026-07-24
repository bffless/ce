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
    const first = await service.requestPrimaryDomainCertificate('example.com');
    expect(first.reused).toBeFalsy();
    const firstCert = fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8');
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.success).toBe(true);
    expect(res.reused).toBe(true);
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(firstCert);
  });

  it('getPrimaryCertificateExpiryDays reads the staged cert', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    const days = service.getPrimaryCertificateExpiryDays();
    expect(days).toBeGreaterThan(80); // mock certs are minted for 90 days
  });

  describe('target (#514)', () => {
    it("target 'staging' writes the issued cert under staging/, not live", async () => {
      const service = new SslCertificateService();
      const res = await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
      expect(res.success).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'staging', 'fullchain.pem'))).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'staging', 'privkey.pem'))).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(false);
    });

    it('default target writes live (renewal-cron contract)', async () => {
      const service = new SslCertificateService();
      const res = await service.requestPrimaryDomainCertificate('example.com');
      expect(res.success).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(true);
      expect(fs.existsSync(path.join(sslDir, 'staging'))).toBe(false);
    });

    it("a valid STAGED cert does NOT satisfy the reuse check for target 'live'", async () => {
      const service = new SslCertificateService();
      // Stage a valid covering cert...
      await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
      // ...then a live-target request must still issue (not report reused).
      const res = await service.requestPrimaryDomainCertificate('example.com');
      expect(res.reused).toBeFalsy();
      expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(true);
    });

    it("a valid staged cert IS reused for target 'staging'", async () => {
      const service = new SslCertificateService();
      await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
      const res = await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
      expect(res.reused).toBe(true);
    });
  });
});

describe('SslCertificateService.checkWildcardCertificate', () => {
  let sslDir: string;

  beforeEach(() => {
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = sslDir;
    // Exercise the real (non-mock) file-reading branch — checkWildcardCertificate's
    // mock-mode branch reads from an in-memory map and never touches disk, so
    // it can't exercise the SAN gate under test here.
    delete process.env.MOCK_SSL;
  });
  afterEach(() => {
    delete process.env.SSL_CERT_PATH;
    delete process.env.MOCK_SSL;
    fs.rmSync(sslDir, { recursive: true, force: true });
  });

  it('reports exists:false for a wildcard.<domain>.crt that is only a primary-cert copy (no *.<domain> SAN)', async () => {
    // Mirrors what requestPrimaryDomainCertificate writes when the optional
    // DNS-01 wildcard step is skipped: the SAN set is [apex, www, admin],
    // never *.<domain> (HTTP-01 cannot issue wildcards).
    const { certPem, keyPem } = makeCert('example.com', [
      'example.com',
      'www.example.com',
      'admin.example.com',
    ]);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), certPem);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.key'), keyPem);

    const service = new SslCertificateService();
    const result = await service.checkWildcardCertificate('example.com');

    expect(result).toEqual({ exists: false });
  });

  it('reports exists:true for a wildcard.<domain>.crt that genuinely carries the *.<domain> SAN (real DNS-01 or pasted Cloudflare Origin cert)', async () => {
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), REAL_WILDCARD_CERT_PEM);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.key'), REAL_WILDCARD_KEY_PEM);

    const service = new SslCertificateService();
    const result = await service.checkWildcardCertificate('example.com');

    expect(result.exists).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('reports exists:false when no wildcard.<domain>.crt file exists at all', async () => {
    const service = new SslCertificateService();
    const result = await service.checkWildcardCertificate('example.com');

    expect(result).toEqual({ exists: false });
  });
});

// ---------------------------------------------------------------------------
// Pebble-gated integration test: exercises the REAL ACME (acme-client) path
// against a locally-running Pebble server (docker-compose.pebble.yml), not
// the MOCK_SSL forge stub above. Skipped unless PEBBLE=1, because it needs a
// live ACME server + HTTP-01 challenge reachability (Pebble's challtestsrv
// looping the challenge hostname back to nginx's port 80). This is the one
// piece of the bootstrap-ssl feature that unit tests structurally cannot
// cover — MOCK_SSL exists specifically to bypass this exact code path.
//
// Run it with a Pebble stack up:
//   docker compose -f docker-compose.yml -f docker-compose.pebble.yml up -d pebble challtestsrv
//   curl -X POST http://localhost:8055/set-default-ipv4 -d '{"ip":"<nginx container IP>"}'
//   PEBBLE=1 ACME_DIRECTORY_URL=https://localhost:14000/dir pnpm test -- ssl-certificate
const maybe = process.env.PEBBLE === '1' ? describe : describe.skip;
maybe('requestPrimaryDomainCertificate against Pebble', () => {
  it('issues a real cert for the fixed SAN set', async () => {
    delete process.env.MOCK_SSL;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const service = new SslCertificateService();
    await service.initialize();
    const res = await service.requestPrimaryDomainCertificate('bootstrap-test.example');
    expect(res.success).toBe(true);
  }, 120_000);
});
