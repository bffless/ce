import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { writeInstanceConfig, loadInstanceConfig } from '../../bootstrap/instance-config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('PrimarySslSnapshotService', () => {
  let dir: string; let sslDir: string; let svc: PrimarySslSnapshotService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-'));
    process.env.BOOTSTRAP_DIR = dir;
    process.env.SSL_CERT_PATH = sslDir;
    writeInstanceConfig({ version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null }, dir);
    for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.a.com.crt', 'wildcard.a.com.key']) {
      fs.writeFileSync(path.join(sslDir, f), `ORIG-${f}`);
    }
    svc = new PrimarySslSnapshotService();
  });
  afterEach(() => { delete process.env.BOOTSTRAP_DIR; delete process.env.SSL_CERT_PATH; });

  it('snapshots then restores the instance config and cert bytes', () => {
    svc.snapshot();
    expect(svc.hasSnapshot()).toBe(true);
    // mutate live state
    writeInstanceConfig({ version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'cloudflare', sslMode: 'letsencrypt', port80: 'closed', realIp: null }, dir);
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'NEW');
    svc.restore();
    expect(loadInstanceConfig(dir)!.sslMode).toBe('paste');
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('ORIG-fullchain.pem');
    expect(svc.hasSnapshot()).toBe(false);
  });

  it('snapshotIfAbsent snapshots when no snapshot exists', () => {
    expect(svc.hasSnapshot()).toBe(false);
    svc.snapshotIfAbsent();
    expect(svc.hasSnapshot()).toBe(true);
  });

  it('snapshotIfAbsent is a no-op when a snapshot already exists (first bytes survive)', () => {
    svc.snapshotIfAbsent();
    // Live cert changes AFTER the first snapshot; a second snapshotIfAbsent must
    // NOT recapture it — the original pre-change bytes must survive.
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'NEW');
    svc.snapshotIfAbsent();
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
});
