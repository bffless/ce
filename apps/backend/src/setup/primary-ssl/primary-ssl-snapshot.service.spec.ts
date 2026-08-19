import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { writeInstanceConfig, loadInstanceConfig } from '../../bootstrap/instance-config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('PrimarySslSnapshotService', () => {
  let dir: string;
  let sslDir: string;
  let svc: PrimarySslSnapshotService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-'));
    process.env.BOOTSTRAP_DIR = dir;
    process.env.SSL_CERT_PATH = sslDir;
    writeInstanceConfig(
      {
        version: 2,
        state: 'applied',
        primaryDomain: 'a.com',
        proxyMode: 'none',
        sslMode: 'paste',
        port80: 'redirect',
        realIp: null,
      },
      dir,
    );
    for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.a.com.crt', 'wildcard.a.com.key']) {
      fs.writeFileSync(path.join(sslDir, f), `ORIG-${f}`);
    }
    svc = new PrimarySslSnapshotService();
  });
  afterEach(() => {
    delete process.env.BOOTSTRAP_DIR;
    delete process.env.SSL_CERT_PATH;
  });

  it('snapshots then restores the instance config and cert bytes', () => {
    svc.snapshot();
    expect(svc.hasSnapshot()).toBe(true);
    // mutate live state
    writeInstanceConfig(
      {
        version: 2,
        state: 'applied',
        primaryDomain: 'a.com',
        proxyMode: 'cloudflare',
        sslMode: 'letsencrypt',
        port80: 'closed',
        realIp: null,
      },
      dir,
    );
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'NEW');
    svc.restore();
    expect(loadInstanceConfig(dir)!.sslMode).toBe('paste');
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('ORIG-fullchain.pem');
    expect(svc.hasSnapshot()).toBe(false);
  });

  it('snapshotForChangeCycle snapshots when no snapshot exists', () => {
    expect(svc.hasSnapshot()).toBe(false);
    svc.snapshotForChangeCycle();
    expect(svc.hasSnapshot()).toBe(true);
  });

  it('snapshotForChangeCycle is a no-op when a snapshot already exists (first bytes survive)', () => {
    svc.snapshotForChangeCycle();
    // Live cert changes AFTER the first snapshot; a second snapshotForChangeCycle must
    // NOT recapture it — the original pre-change bytes must survive.
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'NEW');
    svc.snapshotForChangeCycle();
    svc.restore();
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('ORIG-fullchain.pem');
  });

  it('clearSnapshot removes the snapshot without restoring it', () => {
    svc.snapshot();
    expect(svc.hasSnapshot()).toBe(true);
    // mutate live state, then clear (not restore)
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'NEW');
    svc.clearSnapshot();
    expect(svc.hasSnapshot()).toBe(false);
    // clearing does not touch the live cert
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('NEW');
  });

  it('round-trips the pending-revert record', () => {
    expect(svc.readPendingRevert()).toBeNull();
    svc.writePendingRevert({ deadlineMs: 1000, appliedAt: 500 });
    expect(svc.readPendingRevert()).toEqual({ deadlineMs: 1000, appliedAt: 500 });
    svc.clearPendingRevert();
    expect(svc.readPendingRevert()).toBeNull();
  });

  it('markApplied/isApplied round-trip; markApplied without a snapshot is a no-op', () => {
    expect(svc.isApplied()).toBe(false);
    svc.markApplied(); // no snapshot yet — must not create the marker
    expect(svc.isApplied()).toBe(false);
    svc.snapshot();
    svc.markApplied();
    expect(svc.isApplied()).toBe(true);
  });

  it('snapshot(), clearSnapshot(), and restore() all clear the applied marker', () => {
    svc.snapshot();
    svc.markApplied();
    svc.snapshot(); // fresh snapshot = new cycle
    expect(svc.isApplied()).toBe(false);
    svc.markApplied();
    svc.clearSnapshot();
    expect(svc.isApplied()).toBe(false);
    svc.snapshot();
    svc.markApplied();
    svc.restore();
    expect(svc.isApplied()).toBe(false);
  });

  it('re-baselining preserves an env origin instead of graduating it', () => {
    // Mechanical rewrites (snapshot/restore) must not perform the graduation
    // that only the wizard apply endpoint is allowed to do — an env-adopted
    // install's origin must ride along through the snapshot round trip.
    writeInstanceConfig(
      {
        version: 2,
        state: 'applied',
        origin: 'env',
        primaryDomain: 'a.com',
        proxyMode: 'none',
        sslMode: 'paste',
      },
      dir,
    );
    svc.snapshot();
    svc.restore();
    expect(loadInstanceConfig(dir)!.origin).toBe('env');
  });

  it('snapshotForChangeCycle re-baselines over an applied snapshot (rollback restores the LATEST pre-change bytes)', () => {
    // cycle 1: stage + cert-only apply of cert A over the original
    svc.snapshotForChangeCycle(); // baseline = ORIG
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'CERT-A');
    svc.markApplied(); // cert-only apply committed
    // cycle 2: staging cert B must re-baseline to A, not keep ORIG
    svc.snapshotForChangeCycle();
    expect(svc.isApplied()).toBe(false);
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'CERT-B');
    svc.restore();
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('CERT-A');
  });
});
