import { ForbiddenException } from '@nestjs/common';
import { PrimarySslService } from './primary-ssl.service';

const domain = 'a.com';
const makeDeps = () => ({
  bootstrap: {
    validateCertificatePair: jest.fn().mockReturnValue({ sans: ['a.com', '*.a.com'], wildcardCovered: true }),
    saveCertificates: jest.fn(),
    validateApplyConfig: jest.fn((d) => ({ proxyMode: d.proxyMode, sslMode: d.sslMode, port80: d.port80 ?? 'redirect', realIp: d.realIp ?? null })),
    certificatesPresent: jest.fn().mockReturnValue(true),
    assertStagedCertificateCovers: jest.fn(),
  },
  ssl: { requestPrimaryDomainCertificate: jest.fn() },
  preflight: { run: jest.fn().mockResolvedValue({ ok: true, checks: [] }) },
  info: { getWildcardCertInfo: jest.fn().mockResolvedValue({ type: 'wildcard', expiresAt: new Date(), isValid: true }) },
  snap: { snapshot: jest.fn(), restore: jest.fn(), hasSnapshot: jest.fn().mockReturnValue(false), writePendingRevert: jest.fn(), readPendingRevert: jest.fn().mockReturnValue(null), clearPendingRevert: jest.fn() },
});

jest.mock('../../bootstrap/instance-config', () => ({
  loadInstanceConfig: () => ({ version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null }),
  writeInstanceConfig: jest.fn(),
}));

const build = () => { const d = makeDeps(); return { d, svc: new PrimarySslService(d.bootstrap as any, d.ssl as any, d.preflight as any, d.info as any, d.snap as any) }; };

describe('PrimarySslService', () => {
  afterEach(() => { delete process.env.PLATFORM_MODE; delete process.env.SSL_MANAGED_EXTERNALLY; });

  it('assertEnabled throws in platform mode', () => {
    process.env.PLATFORM_MODE = 'true';
    const { svc } = build();
    expect(() => svc.assertEnabled()).toThrow(ForbiddenException);
  });

  it('getStatus returns the fixed domain + knobs + cert info', async () => {
    const { svc } = build();
    const s = await svc.getStatus();
    expect(s.domain).toBe(domain);
    expect(s.sslMode).toBe('paste');
    expect(s.cert).not.toBeNull();
  });

  it('stagePaste validates then saves for the fixed domain', () => {
    const { d, svc } = build();
    const res = svc.stagePaste({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any);
    expect(d.bootstrap.validateCertificatePair).toHaveBeenCalledWith('C', 'K', domain, 'none');
    expect(d.bootstrap.saveCertificates).toHaveBeenCalledWith('C', 'K', domain);
    expect(res.wildcardCovered).toBe(true);
  });
});
