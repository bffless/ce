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
  port80?: Port80Mode; // v2; derived from proxyMode when absent (v1 files)
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
  const port80: Port80Mode = cfg.port80 ?? (cfg.proxyMode === 'cloudflare' ? 'closed' : 'redirect');
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

// Same shape the DTO layer enforces (bootstrap-setup.service HOSTNAME_RE):
// dot-separated LDH labels. Applied at adoption because .env's PRIMARY_DOMAIN
// is the one identity input that bypasses DTO validation yet still lands in
// the shell-sourced instance.env.
export const ADOPTABLE_HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

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

// One-file seam for the renewal cron (v0.2.18 review, m7): the durable
// pending-revert marker PrimarySslSnapshotService writes lives at this
// path; a pure existence check avoids a domains→setup Nest dependency.
export function pendingServingRevertExists(dir: string = bootstrapDir()): boolean {
  try {
    return fs.existsSync(path.join(dir, 'pending-serving-revert.json'));
  } catch {
    return false;
  }
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
    // Anchor to a whole RDN line: node renders X509Certificate.issuer as one
    // RDN per line ("O=Let's Encrypt\nCN=R11"), so match the O= line exactly
    // (multiline ^…$) rather than a loose substring that a crafted issuer
    // string containing "O=Let's Encrypt" as a fragment could satisfy.
    if (/^O=Let's Encrypt$/m.test(cert.issuer)) return 'letsencrypt';
  } catch {
    // missing/unreadable → paste
  }
  return 'paste';
}

// Identity as expressed by a legacy .env install (docker-compose passes .env
// into the backend's environment). Null = not an adoptable install: no/localhost
// domain, or a platform workspace (identity is platform-managed there — same
// check as SetupService.isPlatformManaged).
export function envIdentity(
  env: NodeJS.ProcessEnv = process.env,
): { primaryDomain: string; proxyMode?: ProxyMode } | null {
  if (env.PLATFORM_MODE === 'true' || env.SSL_MANAGED_EXTERNALLY === 'true') return null;
  const d = env.PRIMARY_DOMAIN;
  if (!d || d === 'localhost') return null;
  if (!ADOPTABLE_HOSTNAME_RE.test(d.toLowerCase())) {
    console.warn(
      `[bootstrap] PRIMARY_DOMAIN=${JSON.stringify(d)} is not a valid hostname — not adoptable`,
    );
    return null;
  }
  const pm = env.PROXY_MODE;
  const proxyMode = pm === 'cloudflare' || pm === 'proxy' || pm === 'none' ? pm : undefined;
  return { primaryDomain: d.toLowerCase(), proxyMode };
}

// The instance.json a legacy env install maps to. Knobs (port80/realIp) are
// deliberately omitted (v1-style): deriveKnobs and render-main-conf.sh's env
// fallback derive identical values, so adoption changes nothing nginx renders.
export function deriveAdoptedConfig(
  env: NodeJS.ProcessEnv = process.env,
  ssl: string = sslDir(),
): InstanceConfig | null {
  const id = envIdentity(env);
  if (!id) return null;
  const cfg: InstanceConfig = {
    version: 2,
    state: 'applied',
    origin: 'env',
    primaryDomain: id.primaryDomain,
    sslMode: sniffSslMode(ssl, env.PROXY_MODE),
  };
  if (id.proxyMode) cfg.proxyMode = id.proxyMode;
  return cfg;
}

// First-adoption legacy gate (spec §2, C1). A fresh web-bootstrap install
// (`setup.sh --bootstrap`) also boots with PRIMARY_DOMAIN set — docker-compose's
// `PRIMARY_DOMAIN: ${PRIMARY_DOMAIN:-yourdomain.com}` substitutes for an empty
// value too, so the backend sees `yourdomain.com` even though `.env` left it
// blank — but it is cert-less and has already rendered bootstrap mode. Adopting
// it would write state:'applied', kill the wizard (isBootstrapModeActive → false)
// and cut nginx over to NORMAL mode for a domain with no certs. Only a genuine
// legacy `setup.sh` install (real certs on disk, never bootstrap-rendered) is
// adoptable on first boot. This mirrors render-main-conf.sh's should_bootstrap()
// legacy carve-out — see its comment. Applies to first adoption ONLY: an
// existing origin:'env' file keeps re-syncing regardless (re-sync is not gated).
function isLegacyEnvInstall(ssl: string, primaryDomain: string): boolean {
  // (3) Belt-and-braces: docker-compose.yml's `${PRIMARY_DOMAIN:-yourdomain.com}`
  //     default means an unset/blank PRIMARY_DOMAIN surfaces as this placeholder;
  //     it is never a real legacy identity, so refuse it outright.
  if (primaryDomain === 'yourdomain.com') return false;
  // (1) Real certs present: every non-localhost legacy setup.sh install has run
  //     certbot / pasted CF origin certs into ssl/; a fresh bootstrap boot has not.
  if (
    !fs.existsSync(path.join(ssl, 'fullchain.pem')) ||
    !fs.existsSync(path.join(ssl, 'privkey.pem'))
  ) {
    return false;
  }
  // (2) No bootstrap marker: its presence means this install has rendered
  //     bootstrap mode at least once (render-main-conf.sh writes it and never
  //     deletes it) — i.e. NOT legacy. This protects the mid-wizard-restart
  //     window where the certificate step has staged real certs before Apply ran.
  if (fs.existsSync(path.join(ssl, 'bootstrap-selfsigned.crt'))) {
    // Real certs + a real env identity + the marker + (checked by our caller)
    // no instance.json: this is the "stuck in bootstrap mode" trap — the
    // marker was durably written during a transient cert outage and now
    // defeats both the render legacy carve-out and this adoption gate
    // (v0.2.18 review, M2). We refuse adoption regardless (the marker may
    // be legitimate mid-wizard state), but say exactly how to escape.
    console.warn(
      '[bootstrap] this install looks like a legacy env install stuck in bootstrap mode ' +
        '(real certs + real PRIMARY_DOMAIN + ssl/bootstrap-selfsigned.crt, no instance.json). ' +
        'If nginx is serving the setup wizard on your domain, recover with: ' +
        'rm ssl/bootstrap-selfsigned.crt ssl/bootstrap-selfsigned.key && docker compose restart nginx',
    );
    return false;
  }
  return true;
}

// Boot-time adoption/re-sync for legacy env installs (spec §§2–3). Rules:
//   - no instance.json + env identity present + legacy gate passes → adopt
//   - origin:'env' file → re-derive from env, rewrite only if changed; if env
//     is no longer adoptable, delete the now-stale derived files
//   - wizard file (origin absent/'wizard') or corrupt file → never touched
// For origin:'env', .env is truth and the files are derived caches — which is
// also why hydrateProcessEnv skips its process.env override for them.
// Must never throw: any failure degrades to today's env-only behavior.
export function adoptOrResyncEnvInstall(
  dir: string = bootstrapDir(),
  env: NodeJS.ProcessEnv = process.env,
  ssl: string = sslDir(),
): InstanceConfig | null {
  try {
    const jsonPath = path.join(dir, 'instance.json');
    const exists = fs.existsSync(jsonPath);
    const existing = loadInstanceConfig(dir);
    if (exists && !existing) {
      console.warn('[bootstrap] instance.json present but unreadable — leaving it untouched');
      return null;
    }
    if (existing && existing.origin !== 'env') {
      const d = env.PRIMARY_DOMAIN;
      // 'yourdomain.com' is compose's ${PRIMARY_DOMAIN:-yourdomain.com} placeholder
      // for a blank .env — every wizard install boots with it (see
      // isLegacyEnvInstall), so it is never a real divergence.
      if (d && d !== 'localhost' && d !== 'yourdomain.com' && d !== existing.primaryDomain) {
        console.warn(
          `[bootstrap] .env PRIMARY_DOMAIN=${d} differs from wizard-managed instance.json ` +
            `(${existing.primaryDomain}); instance.json wins — change identity via the admin UI`,
        );
      }
      return null;
    }
    const derived = deriveAdoptedConfig(env, ssl);
    if (!derived) {
      // I3: an already-adopted install whose .env has become non-adoptable
      // (domain removed/localhost, or PLATFORM_MODE/SSL_MANAGED_EXTERNALLY now
      // true). The derived files are a stale cache still steering nginx +
      // renewal, so delete them rather than silently leaving state:'applied'
      // behind. Only ever touches origin:'env' files (wizard files returned
      // above).
      if (existing?.origin === 'env') {
        console.warn(
          `[bootstrap] .env is no longer adoptable (domain removed/localhost or platform mode) — ` +
            `deleting the stale env-origin instance.json/instance.env so nginx + renewal fall back to env`,
        );
        for (const f of ['instance.json', 'instance.env']) {
          try {
            fs.unlinkSync(path.join(dir, f));
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          }
        }
      }
      return null;
    }
    // First-adoption gate: only genuine legacy installs get adopted. An existing
    // origin:'env' file re-syncs unconditionally (it already proved adoptable).
    if (!existing && !isLegacyEnvInstall(ssl, derived.primaryDomain!)) {
      return null;
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(derived)) return existing;
    writeInstanceConfig(derived, dir);
    console.log(
      `[bootstrap] ${existing ? 're-synced' : 'adopted'} env identity into instance.json: ${derived.primaryDomain}`,
    );
    return derived;
  } catch (err) {
    console.warn(`[bootstrap] env adoption skipped: ${(err as Error).message}`);
    return null;
  }
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
  // origin:'env' — .env is truth and already lives in process.env; assigning
  // the file's values would resurrect stale identity on the first boot after
  // an .env edit (SuperTokens captures env before re-sync could correct it).
  if (cfg.origin !== 'env') {
    Object.assign(process.env, deriveIdentityEnv(cfg));
  }
  return cfg;
}

export function writeInstanceConfig(cfg: InstanceConfig, dir: string = bootstrapDir()): void {
  // Validate shell-safety of custom realIp before writing any files.
  const knobs = deriveKnobs(cfg);
  if (knobs.realIp && 'header' in knobs.realIp && 'ranges' in knobs.realIp) {
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
