import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  InstanceConfig,
  loadInstanceConfig,
  deriveIdentityEnv,
  hydrateProcessEnv,
  writeInstanceConfig,
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
    hydrateProcessEnv(dir);
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
});
