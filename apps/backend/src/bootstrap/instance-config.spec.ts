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
  sniffSslMode,
  adoptOrResyncEnvInstall,
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

  describe('sniffSslMode', () => {
    let sslTmp: string;
    let savedProxyMode: string | undefined;

    beforeEach(() => {
      sslTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
      savedProxyMode = process.env.PROXY_MODE;
    });
    afterEach(() => {
      fs.rmSync(sslTmp, { recursive: true, force: true });
      if (savedProxyMode === undefined) {
        delete process.env.PROXY_MODE;
      } else {
        process.env.PROXY_MODE = savedProxyMode;
      }
    });

    function mintCert(subj: string): void {
      execFileSync('openssl', [
        'req', '-x509', '-nodes', '-days', '2', '-newkey', 'rsa:2048',
        '-keyout', path.join(sslTmp, 'privkey.pem'),
        '-out', path.join(sslTmp, 'fullchain.pem'),
        '-subj', subj,
      ], { stdio: 'ignore' });
    }

    it('returns letsencrypt for an LE-issued cert when PROXY_MODE is not cloudflare', () => {
      mintCert("/O=Let's Encrypt/CN=R11");
      expect(sniffSslMode(sslTmp, 'none')).toBe('letsencrypt');
      // Test with PROXY_MODE unset hermetically (omit arg to not trigger default at call time)
      const saved = process.env.PROXY_MODE;
      try {
        delete process.env.PROXY_MODE;
        expect(sniffSslMode(sslTmp)).toBe('letsencrypt'); // unset counts as not-cloudflare
      } finally {
        if (saved !== undefined) {
          process.env.PROXY_MODE = saved;
        }
      }
    });

    it('returns paste for an LE cert behind cloudflare', () => {
      mintCert("/O=Let's Encrypt/CN=R11");
      expect(sniffSslMode(sslTmp, 'cloudflare')).toBe('paste');
    });

    it('returns paste for a non-LE issuer (Cloudflare Origin style)', () => {
      mintCert('/O=CloudFlare, Inc./CN=CloudFlare Origin Certificate');
      expect(sniffSslMode(sslTmp, 'none')).toBe('paste');
    });

    it('returns paste when fullchain.pem is missing or unparseable', () => {
      expect(sniffSslMode(sslTmp, 'none')).toBe('paste');
      fs.writeFileSync(path.join(sslTmp, 'fullchain.pem'), 'not a pem');
      expect(sniffSslMode(sslTmp, 'none')).toBe('paste');
    });
  });

  describe('env adoption & re-sync', () => {
    let sslTmp: string;
    let envBackup: NodeJS.ProcessEnv;

    const legacyEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
      ({ PRIMARY_DOMAIN: 'legacy.com', PROXY_MODE: 'cloudflare', ...over } as NodeJS.ProcessEnv);

    // A genuine legacy setup.sh install has real certs in ssl/ and no bootstrap
    // marker — the C1 first-adoption gate. Mint a throwaway self-signed pair
    // (non-LE subject so sniffSslMode stays 'paste').
    const mintCerts = (dir: string): void => {
      execFileSync('openssl', [
        'req', '-x509', '-nodes', '-days', '2', '-newkey', 'rsa:2048',
        '-keyout', path.join(dir, 'privkey.pem'),
        '-out', path.join(dir, 'fullchain.pem'),
        '-subj', '/CN=legacy.com',
      ], { stdio: 'ignore' });
    };

    beforeEach(() => {
      envBackup = { ...process.env };
      sslTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    });
    afterEach(() => {
      process.env = envBackup;
      fs.rmSync(sslTmp, { recursive: true, force: true });
    });

    it('adopts a legacy env install: applied, origin env, no knobs, sniffed sslMode', () => {
      mintCerts(sslTmp);
      const cfg = adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
      expect(cfg).toMatchObject({
        version: 2, state: 'applied', origin: 'env',
        primaryDomain: 'legacy.com', proxyMode: 'cloudflare', sslMode: 'paste',
      });
      expect(cfg!.port80).toBeUndefined();
      expect(cfg!.realIp).toBeUndefined();
      const onDisk = loadInstanceConfig(dir);
      expect(onDisk).toEqual(cfg);
      expect(fs.readFileSync(path.join(dir, 'instance.env'), 'utf8')).toContain('PRIMARY_DOMAIN=legacy.com');
    });

    it('omits proxyMode when PROXY_MODE is unset or unknown', () => {
      mintCerts(sslTmp);
      const cfg = adoptOrResyncEnvInstall(dir, legacyEnv({ PROXY_MODE: undefined }), sslTmp);
      expect(cfg!.proxyMode).toBeUndefined();
      fs.rmSync(path.join(dir, 'instance.json'));
      const cfg2 = adoptOrResyncEnvInstall(dir, legacyEnv({ PROXY_MODE: 'bogus' }), sslTmp);
      expect(cfg2!.proxyMode).toBeUndefined();
    });

    it('skips adoption for localhost, missing domain, and platform mode', () => {
      expect(adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: 'localhost' }), sslTmp)).toBeNull();
      expect(adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: undefined }), sslTmp)).toBeNull();
      expect(adoptOrResyncEnvInstall(dir, legacyEnv({ PLATFORM_MODE: 'true' }), sslTmp)).toBeNull();
      expect(adoptOrResyncEnvInstall(dir, legacyEnv({ SSL_MANAGED_EXTERNALLY: 'true' }), sslTmp)).toBeNull();
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
    });

    it('never touches a wizard-origin file (explicit or absent origin)', () => {
      writeInstanceConfig({ version: 2, state: 'applied', primaryDomain: 'wizard.com', proxyMode: 'none', sslMode: 'paste' }, dir);
      const before = fs.readFileSync(path.join(dir, 'instance.json'), 'utf8');
      expect(adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp)).toBeNull();
      expect(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).toBe(before);
    });

    it('leaves a corrupt instance.json untouched', () => {
      fs.writeFileSync(path.join(dir, 'instance.json'), '{not json');
      expect(adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp)).toBeNull();
      expect(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).toBe('{not json');
    });

    it('re-syncs an env-origin file when .env changes, and skips the write when unchanged', () => {
      mintCerts(sslTmp);
      adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
      // Spy on the real `fs` module (via require), not the `import * as fs`
      // binding above: under this repo's CJS interop, `import * as fs` compiles
      // to a live-binding getter proxy whose property descriptor is
      // non-configurable, so jest.spyOn(fs, ...) throws "Cannot redefine
      // property". The proxy forwards live reads to the real module object, so
      // spying on that real object (require('fs')) is observed by
      // instance-config.ts's own `import * as fs` calls too.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const writeSpy = jest.spyOn(require('fs'), 'writeFileSync');
      adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp); // unchanged
      expect(writeSpy).not.toHaveBeenCalled();
      const cfg = adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: 'renamed.com' }), sslTmp);
      expect(cfg!.primaryDomain).toBe('renamed.com');
      expect(loadInstanceConfig(dir)!.primaryDomain).toBe('renamed.com');
      writeSpy.mockRestore();
    });

    it('hydrateProcessEnv does not override process.env for origin:env files', () => {
      mintCerts(sslTmp);
      adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
      delete process.env.FRONTEND_URL;
      process.env.PRIMARY_DOMAIN = 'fresh-from-env.com';
      const cfg = hydrateProcessEnv(dir);
      expect(cfg!.origin).toBe('env');
      expect(process.env.PRIMARY_DOMAIN).toBe('fresh-from-env.com'); // NOT clobbered by the file
      expect(process.env.FRONTEND_URL).toBeUndefined();
    });

    it('hydrateProcessEnv still overrides process.env for wizard files', () => {
      writeInstanceConfig({ version: 2, state: 'applied', origin: 'wizard', primaryDomain: 'wizard.com', proxyMode: 'none', sslMode: 'paste' }, dir);
      hydrateProcessEnv(dir);
      expect(process.env.PRIMARY_DOMAIN).toBe('wizard.com');
      expect(process.env.FRONTEND_URL).toBe('https://www.wizard.com');
    });

    describe('C1: fresh web-bootstrap install is never adopted on first boot', () => {
      it('refuses the docker-compose placeholder domain even with certs present', () => {
        mintCerts(sslTmp);
        expect(
          adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: 'yourdomain.com' }), sslTmp),
        ).toBeNull();
        expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
      });

      it('refuses a cert-less install (fresh bootstrap boot has no real certs)', () => {
        // sslTmp intentionally has no fullchain.pem/privkey.pem.
        expect(adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp)).toBeNull();
        expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
      });

      it('refuses when certs AND a bootstrap marker are present (mid-wizard restart)', () => {
        mintCerts(sslTmp);
        fs.writeFileSync(path.join(sslTmp, 'bootstrap-selfsigned.crt'), 'marker');
        expect(adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp)).toBeNull();
        expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
      });

      it('adopts a genuine legacy install: real certs, no marker, real domain', () => {
        mintCerts(sslTmp);
        const cfg = adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
        expect(cfg).toMatchObject({ state: 'applied', origin: 'env', primaryDomain: 'legacy.com' });
        expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(true);
      });

      it('re-sync of an existing env-origin file is NOT gated on cert presence', () => {
        // First adopt with certs present…
        mintCerts(sslTmp);
        adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
        // …then the certs vanish (e.g. swapped out) and the domain changes:
        // the re-sync still runs because the file already proved adoptable.
        fs.rmSync(path.join(sslTmp, 'fullchain.pem'));
        fs.rmSync(path.join(sslTmp, 'privkey.pem'));
        const cfg = adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: 'renamed.com' }), sslTmp);
        expect(cfg!.primaryDomain).toBe('renamed.com');
        expect(loadInstanceConfig(dir)!.primaryDomain).toBe('renamed.com');
      });
    });

    describe('I3: env-origin files deleted when env becomes non-adoptable', () => {
      it('deletes both files and warns when an adopted env flips to platform mode', () => {
        mintCerts(sslTmp);
        adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
        expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(true);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const r = adoptOrResyncEnvInstall(dir, legacyEnv({ PLATFORM_MODE: 'true' }), sslTmp);
        expect(r).toBeNull();
        expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'instance.env'))).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
      });

      it('leaves a wizard-origin file untouched under the same env flip', () => {
        writeInstanceConfig(
          { version: 2, state: 'applied', origin: 'wizard', primaryDomain: 'wizard.com', proxyMode: 'none', sslMode: 'paste' },
          dir,
        );
        const before = fs.readFileSync(path.join(dir, 'instance.json'), 'utf8');
        const r = adoptOrResyncEnvInstall(
          dir,
          legacyEnv({ PRIMARY_DOMAIN: 'wizard.com', PLATFORM_MODE: 'true' }),
          sslTmp,
        );
        expect(r).toBeNull();
        expect(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).toBe(before);
      });
    });
  });

  describe('v0218 review hardening', () => {
    let ssl: string;

    beforeEach(() => {
      ssl = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    });
    afterEach(() => {
      fs.rmSync(ssl, { recursive: true, force: true });
    });

    it('m2: does not warn about divergence when .env holds the compose placeholder', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      writeInstanceConfig({ version: 2, state: 'applied', origin: 'wizard', primaryDomain: 'example.com', sslMode: 'paste' }, dir);
      adoptOrResyncEnvInstall(dir, { PRIMARY_DOMAIN: 'yourdomain.com' } as NodeJS.ProcessEnv, ssl);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('differs from wizard-managed'));
      warn.mockRestore();
    });

    it('m2: still warns when .env holds a genuinely different real domain', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      writeInstanceConfig({ version: 2, state: 'applied', origin: 'wizard', primaryDomain: 'example.com', sslMode: 'paste' }, dir);
      adoptOrResyncEnvInstall(dir, { PRIMARY_DOMAIN: 'other.com' } as NodeJS.ProcessEnv, ssl);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('differs from wizard-managed'));
      warn.mockRestore();
    });

    it('hostname hardening: refuses adoption of a shell-metacharacter PRIMARY_DOMAIN', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // real certs on disk so only the hostname gate can refuse
      fs.writeFileSync(path.join(ssl, 'fullchain.pem'), 'x');
      fs.writeFileSync(path.join(ssl, 'privkey.pem'), 'x');
      const out = adoptOrResyncEnvInstall(dir, { PRIMARY_DOMAIN: 'evil.com; rm -rf /' } as NodeJS.ProcessEnv, ssl);
      expect(out).toBeNull();
      expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid hostname'));
      warn.mockRestore();
    });

    it('M2: warns loudly when the bootstrap trap state is detected', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      fs.writeFileSync(path.join(ssl, 'fullchain.pem'), 'x');
      fs.writeFileSync(path.join(ssl, 'privkey.pem'), 'x');
      fs.writeFileSync(path.join(ssl, 'bootstrap-selfsigned.crt'), 'x'); // the trap marker
      adoptOrResyncEnvInstall(dir, { PRIMARY_DOMAIN: 'example.com' } as NodeJS.ProcessEnv, ssl);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stuck in bootstrap mode'));
      warn.mockRestore();
    });
  });
});
