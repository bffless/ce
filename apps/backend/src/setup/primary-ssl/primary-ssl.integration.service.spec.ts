// Integration test with the REAL PrimarySslSnapshotService (real instance-config
// + real cert files on tmpdirs). This is the test the fully-mocked service spec
// missed: it exercises the actual snapshot ORDERING across a stage→apply→rollback
// cycle and asserts the LIVE cert bytes are restored to the pre-change value.
//
// Deliberately NO `jest.mock('../../bootstrap/instance-config')` here (unlike
// primary-ssl.service.spec.ts) so the real snapshot service reads/writes real
// instance.json + cert bytes under BOOTSTRAP_DIR / SSL_CERT_PATH.
import { PrimarySslService } from './primary-ssl.service';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { writeInstanceConfig } from '../../bootstrap/instance-config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const domain = 'a.com';
const CERT_FILES = ['fullchain.pem', 'privkey.pem', `wildcard.${domain}.crt`, `wildcard.${domain}.key`];

describe('PrimarySslService cert rollback (real snapshot service)', () => {
  let bootDir: string;
  let sslDir: string;

  const seedLiveCert = (bytes: string) => {
    for (const f of CERT_FILES) fs.writeFileSync(path.join(sslDir, f), bytes);
  };

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
  });
  afterEach(() => {
    delete process.env.BOOTSTRAP_DIR;
    delete process.env.SSL_CERT_PATH;
  });

  const build = () => {
    const snap = new PrimarySslSnapshotService();
    const bootstrap = {
      validateCertificatePair: jest.fn().mockReturnValue({ sans: [domain, `*.${domain}`], wildcardCovered: true }),
      // The real behavior under test: writing a paste actually overwrites the
      // LIVE cert files. If the snapshot wasn't taken first, C0 is already gone.
      saveCertificates: jest.fn((certPem: string, keyPem: string) => {
        fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), certPem);
        fs.writeFileSync(path.join(sslDir, 'privkey.pem'), keyPem);
        fs.writeFileSync(path.join(sslDir, `wildcard.${domain}.crt`), certPem);
        fs.writeFileSync(path.join(sslDir, `wildcard.${domain}.key`), keyPem);
      }),
      validateApplyConfig: jest.fn((d: any) => ({ proxyMode: d.proxyMode, sslMode: d.sslMode, port80: d.port80 ?? 'redirect', realIp: d.realIp ?? null })),
      certificatesPresent: jest.fn().mockReturnValue(true),
      assertStagedCertificateCovers: jest.fn(),
    };
    const ssl = { requestPrimaryDomainCertificate: jest.fn() };
    const preflight = { run: jest.fn().mockResolvedValue({ ok: true, checks: [] }) };
    const info = { getWildcardCertInfo: jest.fn().mockResolvedValue(null) };
    const svc = new PrimarySslService(bootstrap as any, ssl as any, preflight as any, info as any, snap);
    return { svc, snap };
  };

  it('rollback restores the pre-change (C0) cert after a paste+apply that installed C1', async () => {
    const { svc } = build();

    // Live known-good cert before any change.
    seedLiveCert('C0');
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('C0');

    // Stage a new pasted cert C1 — this OVERWRITES the live cert files.
    svc.stagePaste({ certificatePem: 'C1', privateKeyPem: 'C1', servingMode: 'none' } as any);
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('C1');

    // Apply the cert-only change (no reachability change → no pending revert).
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');

    // Roll back — must restore the ORIGINAL C0 cert, not the just-installed C1.
    svc.rollback();
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('C0');
    expect(fs.readFileSync(path.join(sslDir, `wildcard.${domain}.crt`), 'utf8')).toBe('C0');
  });
});
