// Pure Node module — NO NestJS imports. It runs at the very top of main.ts,
// before Nest (and therefore before SuperTokens/CORS) reads process.env.
import * as fs from 'fs';
import * as path from 'path';

export interface InstanceConfig {
  version: 1;
  state: 'unclaimed' | 'applied';
  primaryDomain?: string;
  proxyMode?: 'cloudflare' | 'none';
  sslMode?: 'paste' | 'letsencrypt';
  platformIp?: string;
}

export function bootstrapDir(): string {
  return process.env.BOOTSTRAP_DIR || path.resolve(process.cwd(), '../../bootstrap');
}

export function loadInstanceConfig(dir: string = bootstrapDir()): InstanceConfig | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'instance.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed?.state) return null;
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
  const lines = [
    `STATE=${cfg.state}`,
    cfg.primaryDomain ? `PRIMARY_DOMAIN=${cfg.primaryDomain}` : '',
    cfg.proxyMode ? `PROXY_MODE=${cfg.proxyMode}` : '',
  ].filter(Boolean);
  const envTmp = path.join(dir, 'instance.env.tmp');
  fs.writeFileSync(envTmp, lines.join('\n') + '\n');
  fs.renameSync(envTmp, path.join(dir, 'instance.env'));
}
