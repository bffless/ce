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
  info: {
    getWildcardCertInfo: jest.fn().mockResolvedValue({ type: 'wildcard', expiresAt: new Date(), isValid: true }),
    getServedPrimaryCertInfo: jest.fn().mockResolvedValue({ type: 'individual', expiresAt: new Date(), isValid: true }),
  },
  snap: { snapshot: jest.fn(), snapshotForChangeCycle: jest.fn(), clearSnapshot: jest.fn(), restore: jest.fn(), hasSnapshot: jest.fn().mockReturnValue(false), writePendingRevert: jest.fn(), readPendingRevert: jest.fn().mockReturnValue(null), clearPendingRevert: jest.fn() },
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

  it('getStatus.cert comes from getServedPrimaryCertInfo (the SERVED cert), not getWildcardCertInfo', async () => {
    const { d, svc } = build();
    const served = { type: 'individual', commonName: 'served.a.com', expiresAt: new Date(), isValid: true };
    d.info.getServedPrimaryCertInfo.mockResolvedValue(served);
    const s = await svc.getStatus();
    expect(s.cert).toEqual(served);
  });

  it('getStatus.wildcardCovered reflects getWildcardCertInfo independently of the served cert', async () => {
    const { d, svc } = build();
    // served cert present, no wildcard cert file -> not covered
    d.info.getServedPrimaryCertInfo.mockResolvedValue({ type: 'individual', expiresAt: new Date(), isValid: true });
    d.info.getWildcardCertInfo.mockResolvedValue(null);
    let s = await svc.getStatus();
    expect(s.wildcardCovered).toBe(false);
    expect(s.cert).not.toBeNull();

    // served cert missing/unparseable, wildcard cert present -> covered, but no served cert
    d.info.getServedPrimaryCertInfo.mockResolvedValue(null);
    d.info.getWildcardCertInfo.mockResolvedValue({ type: 'wildcard', expiresAt: new Date(), isValid: true });
    s = await svc.getStatus();
    expect(s.wildcardCovered).toBe(true);
    expect(s.cert).toBeNull();
  });

  it('stagePaste validates then saves for the fixed domain, snapshotting the OLD cert first', () => {
    const { d, svc } = build();
    const res = svc.stagePaste({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any);
    expect(d.bootstrap.validateCertificatePair).toHaveBeenCalledWith('C', 'K', domain, 'none');
    expect(d.bootstrap.saveCertificates).toHaveBeenCalledWith('C', 'K', domain);
    expect(res.wildcardCovered).toBe(true);
    // The snapshot must be taken BEFORE the cert is overwritten.
    expect(d.snap.snapshotForChangeCycle).toHaveBeenCalled();
    const snapOrder = d.snap.snapshotForChangeCycle.mock.invocationCallOrder[0];
    const saveOrder = d.bootstrap.saveCertificates.mock.invocationCallOrder[0];
    expect(snapOrder).toBeLessThan(saveOrder);
  });

  it('stagePaste throws when a serving revert is pending', () => {
    const { d, svc } = build();
    d.snap.readPendingRevert.mockReturnValue({ deadlineMs: Date.now() + 1000, appliedAt: Date.now() });
    expect(() => svc.stagePaste({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any)).toThrow();
    expect(d.bootstrap.saveCertificates).not.toHaveBeenCalled();
  });

  it('getStatus throws in platform mode', async () => {
    process.env.PLATFORM_MODE = 'true';
    const { svc } = build();
    await expect(svc.getStatus()).rejects.toThrow(ForbiddenException);
  });

  it('preflight throws in platform mode', async () => {
    process.env.PLATFORM_MODE = 'true';
    const { svc } = build();
    await expect(svc.preflight()).rejects.toThrow(ForbiddenException);
  });

  it('stagePaste throws in platform mode', () => {
    process.env.PLATFORM_MODE = 'true';
    const { svc } = build();
    expect(() => svc.stagePaste({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any)).toThrow(ForbiddenException);
  });
});

describe('PrimarySslService.apply classification', () => {
  it('cert-only change writes config, no pending revert', async () => {
    const { d, svc } = build();
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'letsencrypt', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(d.snap.snapshotForChangeCycle).toHaveBeenCalled();
    expect(d.snap.writePendingRevert).not.toHaveBeenCalled();
  });

  it('serving change writes a pending revert with a deadline', async () => {
    process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS = '1000';
    const { d, svc } = build();
    const r = await svc.apply({ proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('serving');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
    expect(typeof r.deadlineMs).toBe('number');
    delete process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS;
  });

  it('rejects a second apply while a serving revert is pending', async () => {
    const { d, svc } = build();
    d.snap.readPendingRevert.mockReturnValue({ deadlineMs: Date.now() + 1000, appliedAt: Date.now() });
    await expect(svc.apply({ proxyMode: 'none', sslMode: 'paste' } as any)).rejects.toThrow();
  });

  it('confirm clears the pending revert AND the snapshot; rollback restores', () => {
    const { d, svc } = build();
    svc.confirm();
    expect(d.snap.clearPendingRevert).toHaveBeenCalled();
    expect(d.snap.clearSnapshot).toHaveBeenCalled();
    svc.rollback();
    expect(d.snap.restore).toHaveBeenCalled();
  });
});

describe('PrimarySslService.issueLetsEncrypt', () => {
  it('snapshots, preflights, then requests the cert', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'] });
    const r = await svc.issueLetsEncrypt();
    expect(d.snap.snapshotForChangeCycle).toHaveBeenCalled();
    expect(d.preflight.run).toHaveBeenCalledWith('a.com');
    expect(d.ssl.requestPrimaryDomainCertificate).toHaveBeenCalledWith('a.com');
    expect(r.issued).toBe(true);
  });
  it('surfaces reused: true when the underlying call reports the cert was reused (no-op re-issue)', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'], reused: true });
    const r = await svc.issueLetsEncrypt();
    expect(r.reused).toBe(true);
  });
  it('surfaces reused: false when the underlying call actually issued/renewed', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'], reused: false });
    const r = await svc.issueLetsEncrypt();
    expect(r.reused).toBe(false);
  });
  it('snapshots BEFORE issuing so the OLD cert is the rollback baseline', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'] });
    await svc.issueLetsEncrypt();
    const snapOrder = d.snap.snapshotForChangeCycle.mock.invocationCallOrder[0];
    const issueOrder = d.ssl.requestPrimaryDomainCertificate.mock.invocationCallOrder[0];
    expect(snapOrder).toBeLessThan(issueOrder);
  });
  it('throws when preflight fails, without requesting a cert', async () => {
    const { d, svc } = build();
    d.preflight.run.mockResolvedValue({ ok: false, checks: [] });
    await expect(svc.issueLetsEncrypt()).rejects.toThrow();
    expect(d.ssl.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
  });
  it('throws when a serving revert is pending, without snapshotting or issuing', async () => {
    const { d, svc } = build();
    d.snap.readPendingRevert.mockReturnValue({ deadlineMs: Date.now() + 1000, appliedAt: Date.now() });
    await expect(svc.issueLetsEncrypt()).rejects.toThrow();
    expect(d.snap.snapshotForChangeCycle).not.toHaveBeenCalled();
    expect(d.ssl.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
  });
});
