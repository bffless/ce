import * as fs from 'fs';
import * as path from 'path';

/** Package identity check: the CE release version lives in the ROOT package.json
 * ("@bffless/ce"). apps/backend/package.json is a never-bumped 1.0.0 — matching
 * on the name is what keeps us from repeating telemetry's bug. */
export function resolveCeVersion(
  candidates: Array<{ name?: string; version?: string }>,
): string {
  for (const pkg of candidates) {
    if (pkg?.name === '@bffless/ce' && pkg.version) return String(pkg.version);
  }
  return 'unknown';
}

let cached: string | null = null;

export function getCeVersion(): string {
  if (cached) return cached;
  const files = [
    path.join(process.cwd(), '..', '..', 'package.json'), // /app/apps/backend -> /app (docker), repo root (dev)
    path.join(__dirname, '..', '..', '..', '..', 'package.json'), // dist/app-catalog -> repo root fallback
    '/app/package.json',
  ];
  const candidates: Array<{ name?: string; version?: string }> = [];
  for (const file of files) {
    try {
      candidates.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      /* try next */
    }
  }
  cached = resolveCeVersion(candidates);
  return cached;
}

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return NaN;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Fail closed: an unparseable running version does NOT satisfy any minimum. */
export function satisfiesMin(version: string, min: string): boolean {
  const cmp = compareSemver(version, min);
  return Number.isFinite(cmp) && cmp >= 0;
}
