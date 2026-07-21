import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  InstanceConfig,
  loadInstanceConfig,
  deriveIdentityEnv,
  hydrateProcessEnv,
  writeInstanceConfig,
  bootstrapDir,
  deriveKnobs,
  assertShellSafeRealIp,
  SHELL_SAFE_HEADER_RE,
  SHELL_SAFE_RANGE_RE,
} from './instance-config';

describe('instance-config', () => {
  let dir: string;
  const applied: InstanceConfig = {
    version: 1,
    state: 'applied',
    primaryDomain: 'example.com',
    proxyMode: 'cloudflare',
    sslMode: 'paste',
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-bootstrap-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when instance.json is missing', () => {
    expect(loadInstanceConfig(dir)).toBeNull();
  });

  it('returns null on corrupt json instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'instance.json'), '{not json');
    expect(loadInstanceConfig(dir)).toBeNull();
  });

  it('derives full identity env from an applied config', () => {
    expect(deriveIdentityEnv(applied)).toEqual({
      PRIMARY_DOMAIN: 'example.com',
      FRONTEND_URL: 'https://www.example.com',
      API_DOMAIN: 'https://www.example.com',
      ADMIN_DOMAIN: 'admin.example.com',
      COOKIE_DOMAIN: '.example.com',
      COOKIE_SECURE: 'true',
      PROXY_MODE: 'cloudflare',
    });
  });

  it('derives nothing from an unclaimed config (env fallback wins)', () => {
    expect(deriveIdentityEnv({ version: 1, state: 'unclaimed' })).toEqual({});
  });

  it('derives nothing from an applied config with no primaryDomain', () => {
    expect(deriveIdentityEnv({ version: 1, state: 'applied' })).toEqual({});
  });

  it('derives nothing from an unclaimed config that has a primaryDomain', () => {
    expect(
      deriveIdentityEnv({ version: 1, state: 'unclaimed', primaryDomain: 'evil.com' }),
    ).toEqual({});
  });

  it('round-trips write + load and emits a shell-sourceable instance.env', () => {
    writeInstanceConfig(applied, dir);
    expect(loadInstanceConfig(dir)).toEqual(applied);
    const envFile = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
    expect(envFile).toContain('STATE=applied');
    expect(envFile).toContain('PRIMARY_DOMAIN=example.com');
    expect(envFile).toContain('PROXY_MODE=cloudflare');
  });

  it('hydrateProcessEnv overwrites process.env from an applied config', () => {
    writeInstanceConfig(applied, dir);
    process.env.PRIMARY_DOMAIN = 'stale.old';
    expect(hydrateProcessEnv(dir)).toEqual(applied);
    expect(process.env.PRIMARY_DOMAIN).toBe('example.com');
    expect(process.env.COOKIE_DOMAIN).toBe('.example.com');
    delete process.env.PRIMARY_DOMAIN;
    delete process.env.COOKIE_DOMAIN;
    delete process.env.FRONTEND_URL;
    delete process.env.API_DOMAIN;
    delete process.env.ADMIN_DOMAIN;
    delete process.env.COOKIE_SECURE;
    delete process.env.PROXY_MODE;
  });

  it('hydrateProcessEnv returns null for a dir with no instance.json', () => {
    expect(hydrateProcessEnv(dir)).toBeNull();
  });

  describe('bootstrapDir', () => {
    let originalBootstrapDir: string | undefined;

    beforeEach(() => {
      originalBootstrapDir = process.env.BOOTSTRAP_DIR;
    });
    afterEach(() => {
      if (originalBootstrapDir === undefined) {
        delete process.env.BOOTSTRAP_DIR;
      } else {
        process.env.BOOTSTRAP_DIR = originalBootstrapDir;
      }
    });

    it('returns BOOTSTRAP_DIR when set', () => {
      process.env.BOOTSTRAP_DIR = '/custom/bootstrap/path';
      expect(bootstrapDir()).toBe('/custom/bootstrap/path');
    });

    it('falls back to ../../bootstrap relative to cwd when unset', () => {
      delete process.env.BOOTSTRAP_DIR;
      expect(bootstrapDir()).toBe(path.resolve(process.cwd(), '../../bootstrap'));
    });
  });

  describe('instance-config v2', () => {
    const v2Custom: InstanceConfig = {
      version: 2,
      state: 'applied',
      primaryDomain: 'example.com',
      proxyMode: 'proxy',
      sslMode: 'paste',
      port80: 'redirect',
      realIp: { header: 'X-Forwarded-For', ranges: ['151.101.0.0/16', '2a04:4e40::/32'] },
    };

    it('loads version 2 files', () => {
      writeInstanceConfig(v2Custom, dir);
      expect(loadInstanceConfig(dir)).toEqual(v2Custom);
    });

    it('derives knobs from a v1 cloudflare config (forward-read)', () => {
      const v1: InstanceConfig = {
        version: 1, state: 'applied', primaryDomain: 'example.com',
        proxyMode: 'cloudflare', sslMode: 'paste',
      };
      expect(deriveKnobs(v1)).toEqual({ port80: 'closed', realIp: { preset: 'cloudflare' } });
    });

    it('derives knobs from a v1 none config (forward-read)', () => {
      const v1: InstanceConfig = { version: 1, state: 'applied', primaryDomain: 'x.com', proxyMode: 'none' };
      expect(deriveKnobs(v1)).toEqual({ port80: 'redirect', realIp: null });
    });

    it('explicit knobs win over preset defaults', () => {
      expect(deriveKnobs({ ...v2Custom, proxyMode: 'cloudflare' }).port80).toBe('redirect');
    });

    it('writes resolved knobs into instance.env (custom realIp quoted)', () => {
      writeInstanceConfig(v2Custom, dir);
      const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
      expect(env).toContain('SSL_MODE=paste');
      expect(env).toContain('PORT80=redirect');
      expect(env).toContain('REALIP_MODE=custom');
      expect(env).toContain('REALIP_HEADER="X-Forwarded-For"');
      expect(env).toContain('REALIP_RANGES="151.101.0.0/16 2a04:4e40::/32"');
    });

    it('writes REALIP_MODE=cloudflare for the cloudflare preset', () => {
      writeInstanceConfig(
        { version: 2, state: 'applied', primaryDomain: 'x.com', proxyMode: 'cloudflare', sslMode: 'paste' },
        dir,
      );
      const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
      expect(env).toContain('PORT80=closed');
      expect(env).toContain('REALIP_MODE=cloudflare');
      expect(env).not.toContain('REALIP_HEADER');
    });

    it('always writes SSL_MODE, defaulting to paste when absent', () => {
      writeInstanceConfig(
        { version: 2, state: 'applied', primaryDomain: 'x.com', proxyMode: 'none' },
        dir,
      );
      const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
      expect(env).toContain('SSL_MODE=paste');
    });

    it('writes REALIP_MODE=off for proxyMode=none', () => {
      writeInstanceConfig(
        { version: 2, state: 'applied', primaryDomain: 'x.com', proxyMode: 'none', sslMode: 'paste' },
        dir,
      );
      const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
      expect(env).toContain('REALIP_MODE=off');
      expect(env).not.toContain('REALIP_HEADER');
      expect(env).not.toContain('REALIP_RANGES');
    });

    it('rejects custom realIp with unsafe header characters (newline)', () => {
      const unsafe: InstanceConfig = {
        version: 2,
        state: 'applied',
        primaryDomain: 'x.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        realIp: { header: 'X-Forwarded-For\nset_real_ip_from 0.0.0.0/0', ranges: ['0.0.0.0/0'] },
      };
      expect(() => writeInstanceConfig(unsafe, dir)).toThrow(/unsafe characters/);
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
    });

    it('rejects custom realIp with unsafe header characters (backtick)', () => {
      const unsafe: InstanceConfig = {
        version: 2,
        state: 'applied',
        primaryDomain: 'x.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        realIp: { header: 'X-`Forwarded-For', ranges: ['0.0.0.0/0'] },
      };
      expect(() => writeInstanceConfig(unsafe, dir)).toThrow(/unsafe characters/);
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
    });

    it('rejects custom realIp with unsafe range characters', () => {
      const unsafe: InstanceConfig = {
        version: 2,
        state: 'applied',
        primaryDomain: 'x.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        realIp: { header: 'X-Forwarded-For', ranges: ['0.0.0.0/0; rm -rf /'] },
      };
      expect(() => writeInstanceConfig(unsafe, dir)).toThrow(/unsafe characters/);
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
    });

    it('accepts valid custom realIp', () => {
      writeInstanceConfig(v2Custom, dir);
      const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
      expect(env).toContain('REALIP_MODE=custom');
      expect(env).toContain('REALIP_HEADER="X-Forwarded-For"');
      expect(env).toContain('REALIP_RANGES="151.101.0.0/16 2a04:4e40::/32"');
    });

    it('rejects custom realIp header containing "&" (shell control operator)', () => {
      const unsafe: InstanceConfig = {
        version: 2,
        state: 'applied',
        primaryDomain: 'x.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        realIp: { header: 'X-Real&Header', ranges: ['0.0.0.0/0'] },
      };
      expect(() => writeInstanceConfig(unsafe, dir)).toThrow(/unsafe characters/);
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
    });

    it('rejects custom realIp header containing "|" (shell control operator)', () => {
      const unsafe: InstanceConfig = {
        version: 2,
        state: 'applied',
        primaryDomain: 'x.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        realIp: { header: 'X-Real|Header', ranges: ['0.0.0.0/0'] },
      };
      expect(() => writeInstanceConfig(unsafe, dir)).toThrow(/unsafe characters/);
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
    });

    it('assertShellSafeRealIp rejects header with "&"', () => {
      expect(() => assertShellSafeRealIp('X-Real&Header', [])).toThrow(
        /unsafe characters/,
      );
    });

    it('assertShellSafeRealIp rejects header with "|"', () => {
      expect(() => assertShellSafeRealIp('X-Real|Header', [])).toThrow(
        /unsafe characters/,
      );
    });

    it('sources a written instance.env in a subshell and round-trips a valid REALIP_HEADER literally, with no injected side effect', () => {
      writeInstanceConfig(v2Custom, dir);
      const envPath = path.join(dir, 'instance.env');
      const sideEffectMarker = path.join(dir, 'pwned');
      const output = execFileSync(
        'sh',
        ['-c', `. ${envPath} >/dev/null 2>&1; printf "%s" "$REALIP_HEADER"`],
        { encoding: 'utf8' },
      );
      expect(output).toBe(v2Custom.realIp && 'header' in v2Custom.realIp ? v2Custom.realIp.header : '');
      expect(fs.existsSync(sideEffectMarker)).toBe(false);
    });

    it('passes assertShellSafeRealIp for valid header and ranges', () => {
      expect(() =>
        assertShellSafeRealIp('X-Forwarded-For', ['0.0.0.0/0', '2a04:4e40::/32']),
      ).not.toThrow();
    });

    it('fails assertShellSafeRealIp for header with dangerous char ($)', () => {
      expect(() => assertShellSafeRealIp('X-$Forwarded', [])).toThrow(/unsafe characters/);
    });

    it('fails assertShellSafeRealIp for range with dangerous char (;)', () => {
      expect(() => assertShellSafeRealIp('X-Forwarded-For', ['0.0.0.0/0;'])).toThrow(
        /unsafe characters/,
      );
    });
  });
});
