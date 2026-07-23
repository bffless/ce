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

  hasSnapshot(): boolean {
    return fs.existsSync(path.join(this.snapDir(), 'instance.json'));
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
    fs.rmSync(snap, { recursive: true, force: true });
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
