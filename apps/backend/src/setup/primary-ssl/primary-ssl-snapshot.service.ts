import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { bootstrapDir, loadInstanceConfig, writeInstanceConfig } from '../../bootstrap/instance-config';

const CERT_FILES_STATIC = ['fullchain.pem', 'privkey.pem'];

@Injectable()
export class PrimarySslSnapshotService {
  private sslDir(): string {
    return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
  }
  private snapDir(): string {
    return path.join(bootstrapDir(), 'ssl-snapshot');
  }
  private pendingPath(): string {
    return path.join(bootstrapDir(), 'pending-serving-revert.json');
  }
  private certFiles(): string[] {
    const cfg = loadInstanceConfig();
    const d = cfg?.primaryDomain;
    return d ? [...CERT_FILES_STATIC, `wildcard.${d}.crt`, `wildcard.${d}.key`] : [...CERT_FILES_STATIC];
  }

  snapshot(): void {
    const snap = this.snapDir();
    fs.rmSync(snap, { recursive: true, force: true });
    fs.mkdirSync(snap, { recursive: true });
    const cfg = loadInstanceConfig();
    if (cfg) fs.writeFileSync(path.join(snap, 'instance.json'), JSON.stringify(cfg));
    for (const f of this.certFiles()) {
      const src = path.join(this.sslDir(), f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(snap, f));
    }
  }

  // Snapshot the current live SSL state only if no snapshot already exists this
  // change cycle. This is the safe entry point for cert-writing operations: the
  // FIRST call in a cycle captures the last known-good (pre-change) cert, and
  // every later call (e.g. apply after a stage/issue) is a no-op so the good
  // baseline is preserved for rollback. Never overwrites an existing snapshot.
  snapshotIfAbsent(): void {
    if (!this.hasSnapshot()) this.snapshot();
  }

  hasSnapshot(): boolean {
    return fs.existsSync(path.join(this.snapDir(), 'instance.json'));
  }

  // Drop the rollback baseline without restoring it. Called once a change is
  // confirmed/committed so a later rollback cannot undo it. Same removal that
  // restore() performs at its end.
  clearSnapshot(): void {
    fs.rmSync(this.snapDir(), { recursive: true, force: true });
  }

  restore(): void {
    const snap = this.snapDir();
    const cfgPath = path.join(snap, 'instance.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    // Restore certs referenced by the SNAPSHOT's domain (before rewriting instance.json).
    const files = cfg.primaryDomain
      ? [...CERT_FILES_STATIC, `wildcard.${cfg.primaryDomain}.crt`, `wildcard.${cfg.primaryDomain}.key`]
      : [...CERT_FILES_STATIC];
    for (const f of files) {
      const src = path.join(snap, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(this.sslDir(), f));
    }
    writeInstanceConfig(cfg);
    this.clearSnapshot();
  }

  writePendingRevert(p: { deadlineMs: number; appliedAt: number }): void {
    const tmp = this.pendingPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(p));
    fs.renameSync(tmp, this.pendingPath());
  }
  readPendingRevert(): { deadlineMs: number; appliedAt: number } | null {
    try {
      return JSON.parse(fs.readFileSync(this.pendingPath(), 'utf8'));
    } catch {
      return null;
    }
  }
  clearPendingRevert(): void {
    fs.rmSync(this.pendingPath(), { force: true });
  }
}
