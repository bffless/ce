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

function makePrimarySslService() {
  return {
    issueLetsEncrypt: jest.fn(),
  };
}

function build(domainsExists = false) {
  const domains = makeDomainsService(domainsExists);
  const primarySsl = makePrimarySslService();
  const svc = new AppCertStepService(domains as any, primarySsl as any);
  return { svc, domains, primarySsl };
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

  it('branch 5: proxyMode none + sslMode letsencrypt → direct-le/stage-san-reissue', async () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    mockLoadInstanceConfig.mockReturnValue({ proxyMode: 'none', sslMode: 'letsencrypt' });
    const { svc } = build(false);
    const plan = await svc.plan(APP_HOST);
    expect(plan).toEqual({ model: 'direct-le', action: 'stage-san-reissue' });
  });
});

describe('AppCertStepService.execute', () => {
  it('delegated → skipped, never touches PrimarySslService', async () => {
    const { svc, primarySsl } = build();
    const result = await svc.execute({ model: 'platform', action: 'delegated' }, APP_HOST);
    expect(result.status).toBe('skipped');
    expect(primarySsl.issueLetsEncrypt).not.toHaveBeenCalled();
  });

  it('covered → done, never touches PrimarySslService', async () => {
    const { svc, primarySsl } = build();
    const result = await svc.execute({ model: 'wildcard', action: 'covered' }, APP_HOST);
    expect(result.status).toBe('done');
    expect(primarySsl.issueLetsEncrypt).not.toHaveBeenCalled();
  });

  it('none-needed → skipped, never touches PrimarySslService', async () => {
    const { svc, primarySsl } = build();
    const result = await svc.execute({ model: 'edge-terminated', action: 'none-needed' }, APP_HOST);
    expect(result.status).toBe('skipped');
    expect(primarySsl.issueLetsEncrypt).not.toHaveBeenCalled();
  });

  it('report (unknown) → never touches PrimarySslService', async () => {
    const { svc, primarySsl } = build();
    const result = await svc.execute({ model: 'unknown', action: 'report' }, APP_HOST);
    expect(['skipped', 'action-required']).toContain(result.status);
    expect(primarySsl.issueLetsEncrypt).not.toHaveBeenCalled();
  });

  it('stage-san-reissue success → action-required with the apply-ssl-cert manual step', async () => {
    const { svc, primarySsl } = build();
    primarySsl.issueLetsEncrypt.mockResolvedValue({ issued: true, sans: [APP_HOST], reused: false });
    const result = await svc.execute({ model: 'direct-le', action: 'stage-san-reissue' }, APP_HOST);
    expect(primarySsl.issueLetsEncrypt).toHaveBeenCalledWith({ extraSans: [APP_HOST] });
    expect(result.status).toBe('action-required');
    expect(result.manualStep).toEqual({
      id: 'apply-ssl-cert',
      title: 'Apply the updated certificate',
      body: `A new certificate including ${APP_HOST} was issued and staged. Review and apply it, then confirm within the safety window.`,
      deepLink: '/admin/settings/ssl',
      appliesWhen: 'selfHosted',
    });
  });

  it('stage-san-reissue failure → degrades to action-required, install not failed, both remediation routes named', async () => {
    const { svc, primarySsl } = build();
    primarySsl.issueLetsEncrypt.mockRejectedValue(new Error('DNS/port-80 preflight failed; not requesting a certificate'));
    const result = await svc.execute({ model: 'direct-le', action: 'stage-san-reissue' }, APP_HOST);
    expect(result.status).toBe('action-required');
    expect(result.detail).toContain('DNS/port-80 preflight failed');
    expect(result.manualStep).toBeDefined();
    // Both remediation routes must be named: wildcard cert AND manual SSL page re-issue.
    expect(result.manualStep!.body.toLowerCase()).toContain('wildcard');
    expect(result.manualStep!.body.toLowerCase()).toContain('settings');
    expect(result.manualStep!.deepLink).toBe('/admin/settings/ssl');
  });

  it('stage-san-reissue never throws — issuance failure is caught and returned, not raised', async () => {
    const { svc, primarySsl } = build();
    primarySsl.issueLetsEncrypt.mockRejectedValue(new Error('boom'));
    await expect(svc.execute({ model: 'direct-le', action: 'stage-san-reissue' }, APP_HOST)).resolves.toBeDefined();
  });
});
