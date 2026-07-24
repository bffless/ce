import * as fs from 'fs';
import * as path from 'path';

/**
 * Staging area for primary-domain certificates (#514). User-driven writers
 * (day-2 paste, day-2 LE issuance, bootstrap wizard upload/issuance) write
 * here; only apply() promotes into the live dir. Plain functions in the
 * style of instance-config.ts so callers don't need DI plumbing.
 *
 * The staging dir deliberately lives INSIDE the live SSL dir: same
 * filesystem, so promotion is an atomic per-file rename() (never a copy,
 * never EXDEV). The nginx reload-watcher's inotifywait is non-recursive, so
 * writes inside staging/ are invisible to it; creating/removing the dir
 * itself wakes the watcher once, which is a benign guarded re-render.
 */
export function sslLiveDir(): string {
  return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
}

export function sslStagingDir(): string {
  return path.join(sslLiveDir(), 'staging');
}

/** A stage is only usable once the generic serving pair is fully present. */
export function stagingPopulated(): boolean {
  return (
    fs.existsSync(path.join(sslStagingDir(), 'fullchain.pem')) &&
    fs.existsSync(path.join(sslStagingDir(), 'privkey.pem'))
  );
}

/**
 * True when exactly ONE of fullchain.pem / privkey.pem is staged — a torn
 * stage (interrupted write, manual tampering) that is neither "nothing
 * staged" nor a usable pair. Callers must reject this loudly rather than
 * silently treating it as unpopulated: apply()'s stagingPopulated() check
 * alone would just no-op promote/skip, quietly discarding the caller's
 * belief that a cert was staged.
 */
export function stagingPartiallyPopulated(): boolean {
  const hasFullchain = fs.existsSync(path.join(sslStagingDir(), 'fullchain.pem'));
  const hasPrivkey = fs.existsSync(path.join(sslStagingDir(), 'privkey.pem'));
  return hasFullchain !== hasPrivkey;
}

/**
 * Promote staging → live: rename every staged regular file over its live
 * counterpart, then drop the staging dir. Dotfiles are skipped — a crashed
 * atomic write can leave a `.<name>.<pid>-<rand>.tmp` behind, and promoting
 * junk into the watched dir would trigger a pointless reload.
 */
export function promoteStagedCertificates(): string[] {
  if (!stagingPopulated()) return [];
  const staging = sslStagingDir();
  const promoted: string[] = [];
  for (const name of fs.readdirSync(staging)) {
    if (name.startsWith('.')) continue;
    const src = path.join(staging, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.renameSync(src, path.join(sslLiveDir(), name));
    promoted.push(name);
  }
  fs.rmSync(staging, { recursive: true, force: true });
  return promoted;
}

/** Abandoning a staged cert is just discarding the staging dir. Idempotent. */
export function discardStagedCertificates(): void {
  fs.rmSync(sslStagingDir(), { recursive: true, force: true });
}
