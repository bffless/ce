import { AppCertStepService } from './app-cert-step.service';
import { loadInstanceConfig } from '../bootstrap/instance-config';

jest.mock('../bootstrap/instance-config');

const mockLoadInstanceConfig = loadInstanceConfig as jest.Mock;

const APP_HOST = 'handoff.example.com';

function makeDomainsService(exists = false) {
  return {
    getWildcardCertificateStatus: jest.fn().mockResolvedValue({ exists }),
  };
}

function build(domainsExists = false) {
  const domains = makeDomainsService(domainsExists);
  const svc = new AppCertStepService(domains as any);
  return { svc, domains };
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.clearAllMocks();
});

describe('AppCertStepService.plan', () => {
  it('branch 1: PLATFORM_MODE=true → platform/delegated', async () => {
    process.env.PLATFORM_MODE = 'true';
    delete process.env.SSL_MANAGED_EXTERNALLY;
    const { svc } = build();
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'platform', action: 'delegated' });
  });

  it('branch 1: SSL_MANAGED_EXTERNALLY=true → platform/delegated', async () => {
    delete process.env.PLATFORM_MODE;
    process.env.SSL_MANAGED_EXTERNALLY = 'true';
    const { svc } = build();
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'platform', action: 'delegated' });
  });

  it('branch 2: wildcard exists → wildcard/covered', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    const { svc } = build(true);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'wildcard', action: 'covered' });
  });

  it('branch 3: loadInstanceConfig() null → unknown/report', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue(null);
    const { svc } = build(false);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'unknown', action: 'report' });
  });

  it('branch 4: proxyMode cloudflare → edge-terminated/none-needed', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'cloudflare', sslMode: 'letsencrypt' });
    const { svc } = build(false);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'edge-terminated', action: 'none-needed' });
  });

  it('branch 4: proxyMode proxy → edge-terminated/none-needed', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'proxy', sslMode: 'letsencrypt' });
    const { svc } = build(false);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'edge-terminated', action: 'none-needed' });
  });

  it('branch 4: sslMode selfsigned → edge-terminated/none-needed', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'none', sslMode: 'selfsigned' });
    const { svc } = build(false);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'edge-terminated', action: 'none-needed' });
  });

  // Umbrel packages CE behind a Cloudflare Tunnel: its nginx listens on a
  // plain port with no TLS at all, and the public URL is HTTPS via the tunnel.
  // These are the reserved instance-config values for that profile — they must
  // read as edge-terminated, never as "provision a wildcard" (ce#584).
  it.each([
    [{ proxyMode: 'cloudflare-tunnel', sslMode: 'external' }],
    [{ proxyMode: 'cloudflare-tunnel', sslMode: 'letsencrypt' }],
    [{ proxyMode: 'none', sslMode: 'external' }],
  ])('branch 4: tunnel/external profile %o → edge-terminated/none-needed', async (cfg) => {
    delete process.env.PLATFORM_MODE;
    mockLoadInstanceConfig.mockReturnValue(cfg);
    const { svc } = build(false);
    await expect(svc.plan(APP_HOST)).resolves.toEqual({
      model: 'edge-terminated',
      action: 'none-needed',
    });
    // and its app URL stays https — the tunnel terminates TLS
    await expect(svc.schemeFor(APP_HOST, false)).resolves.toBe('https');
  });

  it('branch 5: proxyMode none + sslMode letsencrypt, no wildcard → direct-no-wildcard/report', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'none', sslMode: 'letsencrypt' });
    const { svc } = build(false);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'direct-no-wildcard', action: 'report' });
  });
});

describe('AppCertStepService.execute', () => {
  it('delegated → skipped', async () => {
    const { svc } = build();
    const result = await svc.execute({ model: 'platform', action: 'delegated' }, APP_HOST);
    expect(result.status).toBe('skipped');
  });

  it('covered → done', async () => {
    const { svc } = build();
    const result = await svc.execute({ model: 'wildcard', action: 'covered' }, APP_HOST);
    expect(result.status).toBe('done');
  });

  it('none-needed → skipped', async () => {
    const { svc } = build();
    const result = await svc.execute({ model: 'edge-terminated', action: 'none-needed' }, APP_HOST);
    expect(result.status).toBe('skipped');
  });

  it('report (unknown) → never touches PrimarySslService', async () => {
    const { svc } = build();
    const result = await svc.execute({ model: 'unknown', action: 'report' }, APP_HOST);
    expect(['skipped', 'action-required']).toContain(result.status);
  });

  it('direct serving without a wildcard → action-required naming the wildcard as the route to HTTPS', async () => {
    const { svc } = build();
    const result = await svc.execute({ model: 'direct-no-wildcard', action: 'report' }, APP_HOST);

    expect(result.status).toBe('action-required');
    // The app is reachable — over HTTP — and the operator must be told exactly that.
    expect(result.detail).toContain(APP_HOST);
    expect(result.detail.toLowerCase()).toContain('http');
    expect(result.manualStep).toEqual(
      expect.objectContaining({ id: 'provision-wildcard-cert', deepLink: '/domains', appliesWhen: 'selfHosted' }),
    );
    expect(result.manualStep!.body.toLowerCase()).toContain('wildcard');
  });

  /**
   * ce#584: the old branch re-issued the PRIMARY certificate with the app host
   * as an extra SAN, staged it, and asked the operator to apply + confirm
   * inside a 5-minute window. Even on full success the app stayed HTTP-only:
   * `DomainsService.create` only sets `sslEnabled` for a subdomain when a
   * WILDCARD exists, and `getSslCertPath` resolves a subdomain of the primary
   * domain to the wildcard file — so the app vhost never gained a 443 block,
   * and would have pointed at a file that does not exist if it had. The path
   * spent an issuance and rewrote the certificate serving admin for nothing.
   */
  it('never touches the primary certificate — that path could not deliver HTTPS for a subdomain', async () => {
    const { svc } = build();
    // The service no longer depends on PrimarySslService at all; constructing
    // it with a single argument (above) is the structural proof.
    expect(AppCertStepService.length).toBe(1);
    await expect(
      svc.execute({ model: 'direct-no-wildcard', action: 'report' }, APP_HOST),
    ).resolves.toBeDefined();
  });

  it('execute never throws for any plan — a cert problem must never fail an install', async () => {
    const { svc } = build();
    const plans = [
      { model: 'platform', action: 'delegated' },
      { model: 'wildcard', action: 'covered' },
      { model: 'edge-terminated', action: 'none-needed' },
      { model: 'unknown', action: 'report' },
      { model: 'direct-no-wildcard', action: 'report' },
    ] as const;
    for (const plan of plans) {
      await expect(svc.execute(plan as never, APP_HOST)).resolves.toBeDefined();
    }
  });
});

describe('AppCertStepService.schemeFor (ce#584: the "Open" link must not promise HTTPS that does not exist)', () => {
  it('direct serving with no wildcard → http (the vhost has no 443 block at all)', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'none', sslMode: 'letsencrypt' });
    const { svc } = build(false);
    await expect(svc.schemeFor(APP_HOST, false)).resolves.toBe('http');
  });

  it('direct serving once the domain row carries SSL → https', async () => {
    delete process.env.PLATFORM_MODE;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'none', sslMode: 'letsencrypt' });
    const { svc } = build(false);
    await expect(svc.schemeFor(APP_HOST, true)).resolves.toBe('https');
  });

  it('behind Cloudflare → https even though the origin vhost is plain HTTP (edge terminates)', async () => {
    delete process.env.PLATFORM_MODE;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'cloudflare', sslMode: 'paste' });
    const { svc } = build(false);
    await expect(svc.schemeFor(APP_HOST, false)).resolves.toBe('https');
  });

  it('platform mode → https (cert delegated to the platform edge)', async () => {
    process.env.PLATFORM_MODE = 'true';
    const { svc } = build(false);
    await expect(svc.schemeFor(APP_HOST, false)).resolves.toBe('https');
  });

  it('wildcard present → https', async () => {
    delete process.env.PLATFORM_MODE;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'none', sslMode: 'letsencrypt' });
    const { svc } = build(true);
    await expect(svc.schemeFor(APP_HOST, false)).resolves.toBe('https');
  });

  it('unknown serving model (legacy compose, no instance config) → https, unchanged from before', async () => {
    delete process.env.PLATFORM_MODE;
    mockLoadInstanceConfig.mockReturnValue(null);
    const { svc } = build(false);
    await expect(svc.schemeFor(APP_HOST, false)).resolves.toBe('https');
  });
});
