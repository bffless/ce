// Pure Node module — NO NestJS imports. It runs at the very top of main.ts,
// before Nest (and therefore before SuperTokens/CORS) reads process.env.
import * as fs from 'fs';
import * as path from 'path';

export type ProxyMode = 'cloudflare' | 'proxy' | 'none';
export type SslMode = 'paste' | 'letsencrypt';
export type Port80Mode = 'closed' | 'redirect';
export type RealIpConfig = null | { preset: 'cloudflare' } | { header: string; ranges: string[] };

// Reserved, never written by the wizard and rejected by ApplyBootstrapDto:
// proxyMode 'cloudflare-tunnel' and sslMode 'external' — held for the deferred
// Umbrel/tunnel profile so it can land without a schema version bump.
export interface InstanceConfig {
  version: 1 | 2;
  state: 'unclaimed' | 'applied';
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

export function bootstrapDir(): string {
  return process.env.BOOTSTRAP_DIR || path.resolve(process.cwd(), '../../bootstrap');
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
  fs.mkdirSync(dir, { recursive: true });
  const jsonTmp = path.join(dir, 'instance.json.tmp');
  fs.writeFileSync(jsonTmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(jsonTmp, path.join(dir, 'instance.json'));

  // Shell-sourceable sibling so the nginx render script needs no JSON parser.
  const knobs = deriveKnobs(cfg);
  const realIpMode =
    knobs.realIp === null ? 'off' : 'preset' in knobs.realIp ? 'cloudflare' : 'custom';
  const lines = [
    `STATE=${cfg.state}`,
    cfg.primaryDomain ? `PRIMARY_DOMAIN=${cfg.primaryDomain}` : '',
    cfg.proxyMode ? `PROXY_MODE=${cfg.proxyMode}` : '',
    cfg.sslMode ? `SSL_MODE=${cfg.sslMode}` : '',
    `PORT80=${knobs.port80}`,
    `REALIP_MODE=${realIpMode}`,
    realIpMode === 'custom' && knobs.realIp && 'header' in knobs.realIp
      ? `REALIP_HEADER=${knobs.realIp.header}`
      : '',
    realIpMode === 'custom' && knobs.realIp && 'ranges' in knobs.realIp
      ? `REALIP_RANGES="${knobs.realIp.ranges.join(' ')}"`
      : '',
  ].filter(Boolean);
  const envTmp = path.join(dir, 'instance.env.tmp');
  fs.writeFileSync(envTmp, lines.join('\n') + '\n');
  fs.renameSync(envTmp, path.join(dir, 'instance.env'));
}
