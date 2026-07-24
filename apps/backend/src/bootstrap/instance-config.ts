// Pure Node module — NO NestJS imports. It runs at the very top of main.ts,
// before Nest (and therefore before SuperTokens/CORS) reads process.env.
import { X509Certificate } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type ProxyMode = 'cloudflare' | 'proxy' | 'none';
export type SslMode = 'paste' | 'letsencrypt' | 'selfsigned';
export type Port80Mode = 'closed' | 'redirect';
export type RealIpConfig = null | { preset: 'cloudflare' } | { header: string; ranges: string[] };

// Reserved, never written by the wizard and rejected by ApplyBootstrapDto:
// proxyMode 'cloudflare-tunnel' and sslMode 'external' — held for the deferred
// Umbrel/tunnel profile so it can land without a schema version bump.
export interface InstanceConfig {
  version: 1 | 2;
  state: 'unclaimed' | 'applied';
  // Who owns this file. 'wizard': the web wizard / admin UI wrote it — file is
  // truth, hydration overrides process.env (absent = 'wizard': all files
  // written before this field existed are wizard files). 'env': adopted from a
  // legacy .env install — .env is truth and this file is a derived cache,
  // re-synced on every boot by adoptOrResyncEnvInstall().
  origin?: 'wizard' | 'env';
  primaryDomain?: string;
  proxyMode?: ProxyMode;
  sslMode?: SslMode;
  port80?: Port80Mode;   // v2; derived from proxyMode when absent (v1 files)
  realIp?: RealIpConfig; // v2; derived from proxyMode when absent (v1 files)
  platformIp?: string;
}

export interface ResolvedKnobs {
  port80: Port80Mode;
  realIp: RealIpConfig;
}

// v1 files carry only proxyMode; the preset label determines the knobs. A v2
// file may still omit a knob (apply fills them in, but readers stay defensive).
export function deriveKnobs(cfg: InstanceConfig): ResolvedKnobs {
  // port80 uses ?? (no null variant), while realIp checks !== undefined because
  // explicit null is a meaningful "no realip" choice that must not be re-derived.
  const port80: Port80Mode =
    cfg.port80 ?? (cfg.proxyMode === 'cloudflare' ? 'closed' : 'redirect');
  const realIp: RealIpConfig =
    cfg.realIp !== undefined
      ? cfg.realIp
      : cfg.proxyMode === 'cloudflare'
        ? { preset: 'cloudflare' }
        : null;
  return { port80, realIp };
}

export interface AppliedConfig {
  proxyMode: ProxyMode;
  sslMode: SslMode;
  port80: Port80Mode;
  realIp: RealIpConfig;
}

// Shell-safety gate for values that ride in instance.env (source'd by sh in
// the nginx container). writeInstanceConfig always double-quotes the header
// when it writes REALIP_HEADER, but that alone isn't sufficient defense: a
// value containing `&` or `|` would still be shell-control characters if the
// value were ever concatenated unquoted elsewhere, so the character set is
// deliberately narrower than RFC 9110's tchar grammar. Characters that are
// shell-dangerous even inside a double-quoted assignment — `$`, backtick, and
// the control operators `&` and `|` — are excluded, even though some are valid
// tchar characters. The value is additionally written double-quoted in
// instance.env. Callers layering semantic validation (CIDR correctness etc.)
// do so on top of this, not instead of it.
export const SHELL_SAFE_HEADER_RE = /^[A-Za-z0-9!#*+.^_~-]+$/;
export const SHELL_SAFE_RANGE_RE = /^[0-9A-Fa-f:./]+$/;

export function assertShellSafeRealIp(header: string, ranges: string[]): void {
  if (!SHELL_SAFE_HEADER_RE.test(header)) {
    throw new Error(`Real-IP header contains unsafe characters: ${JSON.stringify(header)}`);
  }
  for (const range of ranges) {
    if (!SHELL_SAFE_RANGE_RE.test(range)) {
      throw new Error(`Real-IP range contains unsafe characters: ${JSON.stringify(range)}`);
    }
  }
}

export function bootstrapDir(): string {
  return process.env.BOOTSTRAP_DIR || path.resolve(process.cwd(), '../../bootstrap');
}

export function sslDir(): string {
  return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
}

// Adoption-time sslMode inference for legacy env-only installs (spec §2): an
// LE-issued primary cert on a non-cloudflare install means the operator used
// the setup.sh certbot path, whose renewal is broken by default (one-time
// copy into ssl/, standalone renew can't bind port 80) — adopt as
// 'letsencrypt' so the in-app renewer takes over. Everything else (CF origin
// certs, unknown issuers, missing/unreadable cert) adopts as 'paste'.
// Unset PROXY_MODE counts as not-cloudflare, matching render-main-conf.sh's
// derivation. Never throws: sniff failure must not prevent boot.
export function sniffSslMode(
  dir: string = sslDir(),
  envProxyMode: string | undefined = process.env.PROXY_MODE,
): SslMode {
  if (envProxyMode === 'cloudflare') return 'paste';
  try {
    const pem = fs.readFileSync(path.join(dir, 'fullchain.pem'));
    const cert = new X509Certificate(pem);
    if (/O=Let's Encrypt/.test(cert.issuer)) return 'letsencrypt';
  } catch {
    // missing/unreadable → paste
  }
  return 'paste';
}

export function loadInstanceConfig(dir: string = bootstrapDir()): InstanceConfig | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'instance.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if ((parsed?.version !== 1 && parsed?.version !== 2) || !parsed?.state) return null;
    return parsed as InstanceConfig;
  } catch {
    return null;
  }
}

// Mirrors setup.sh's derivation exactly (see create_env_file in setup.sh):
// FRONTEND_URL=https://www.<domain>, COOKIE_DOMAIN=.<domain>, COOKIE_SECURE=true
export function deriveIdentityEnv(cfg: InstanceConfig): Record<string, string> {
  if (cfg.state !== 'applied' || !cfg.primaryDomain) return {};
  const d = cfg.primaryDomain;
  const env: Record<string, string> = {
    PRIMARY_DOMAIN: d,
    FRONTEND_URL: `https://www.${d}`,
    API_DOMAIN: `https://www.${d}`,
    ADMIN_DOMAIN: `admin.${d}`,
    COOKIE_DOMAIN: `.${d}`,
    COOKIE_SECURE: 'true',
  };
  if (cfg.proxyMode) env.PROXY_MODE = cfg.proxyMode;
  return env;
}

export function hydrateProcessEnv(dir: string = bootstrapDir()): InstanceConfig | null {
  const cfg = loadInstanceConfig(dir);
  if (!cfg) return null;
  Object.assign(process.env, deriveIdentityEnv(cfg));
  return cfg;
}

export function writeInstanceConfig(cfg: InstanceConfig, dir: string = bootstrapDir()): void {
  // Validate shell-safety of custom realIp before writing any files.
  const knobs = deriveKnobs(cfg);
  if (
    knobs.realIp &&
    'header' in knobs.realIp &&
    'ranges' in knobs.realIp
  ) {
    assertShellSafeRealIp(knobs.realIp.header, knobs.realIp.ranges);
  }

  fs.mkdirSync(dir, { recursive: true });
  const jsonTmp = path.join(dir, 'instance.json.tmp');
  fs.writeFileSync(jsonTmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(jsonTmp, path.join(dir, 'instance.json'));

  // Shell-sourceable sibling so the nginx render script needs no JSON parser.
  const realIpMode =
    knobs.realIp === null ? 'off' : 'preset' in knobs.realIp ? 'cloudflare' : 'custom';
  const lines = [
    `STATE=${cfg.state}`,
    cfg.primaryDomain ? `PRIMARY_DOMAIN=${cfg.primaryDomain}` : '',
    cfg.proxyMode ? `PROXY_MODE=${cfg.proxyMode}` : '',
    `SSL_MODE=${cfg.sslMode ?? 'paste'}`,
    `PORT80=${knobs.port80}`,
    `REALIP_MODE=${realIpMode}`,
    realIpMode === 'custom' && knobs.realIp && 'header' in knobs.realIp
      ? `REALIP_HEADER="${knobs.realIp.header}"`
      : '',
    realIpMode === 'custom' && knobs.realIp && 'ranges' in knobs.realIp
      ? `REALIP_RANGES="${knobs.realIp.ranges.join(' ')}"`
      : '',
  ].filter(Boolean);
  const envTmp = path.join(dir, 'instance.env.tmp');
  fs.writeFileSync(envTmp, lines.join('\n') + '\n');
  fs.renameSync(envTmp, path.join(dir, 'instance.env'));
}
