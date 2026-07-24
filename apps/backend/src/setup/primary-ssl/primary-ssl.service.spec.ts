import { ForbiddenException, Logger } from '@nestjs/common';
import { PrimarySslService } from './primary-ssl.service';
import * as staging from '../ssl-staging';
import { writeInstanceConfig } from '../../bootstrap/instance-config';

const domain = 'a.com';

let mockCur: any;

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
    getStagedPrimaryCertInfo: jest.fn().mockResolvedValue(null),
  },
  snap: { snapshot: jest.fn(), snapshotForChangeCycle: jest.fn(), clearSnapshot: jest.fn(), restore: jest.fn(), hasSnapshot: jest.fn().mockReturnValue(false), writePendingRevert: jest.fn(), readPendingRevert: jest.fn().mockReturnValue(null), clearPendingRevert: jest.fn(), isApplied: jest.fn().mockReturnValue(false), markApplied: jest.fn() },
});

jest.mock('../../bootstrap/instance-config', () => ({
  loadInstanceConfig: () => mockCur,
  writeInstanceConfig: jest.fn(),
}));

jest.mock('../ssl-staging', () => ({
  stagingPopulated: jest.fn().mockReturnValue(false),
  stagingPartiallyPopulated: jest.fn().mockReturnValue(false),
  promoteStagedCertificates: jest.fn().mockReturnValue([]),
  discardStagedCertificates: jest.fn(),
}));

const build = () => { const d = makeDeps(); return { d, svc: new PrimarySslService(d.bootstrap as any, d.ssl as any, d.preflight as any, d.info as any, d.snap as any) }; };

beforeEach(() => {
  mockCur = { version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null };
  // Module mocks persist across tests (no global resetMocks), so re-baseline
  // the staging module's defaults here — same reason mockCur is reset above.
  (staging.stagingPopulated as jest.Mock).mockReset().mockReturnValue(false);
  (staging.stagingPartiallyPopulated as jest.Mock).mockReset().mockReturnValue(false);
  // Stateful (M1): promote/discard flip stagingPopulated() back to false when
  // invoked, mirroring the real ssl-staging.ts module (a promoted or
  // discarded stage is no longer populated). This makes certAffecting's
  // ordering (must read stagingPopulated() BEFORE promote/discard runs)
  // test-observable — computing it after would silently see `false` here,
  // just as it would against the real filesystem.
  (staging.promoteStagedCertificates as jest.Mock).mockReset().mockImplementation(() => {
    (staging.stagingPopulated as jest.Mock).mockReturnValue(false);
    return [];
  });
  (staging.discardStagedCertificates as jest.Mock).mockReset().mockImplementation(() => {
    (staging.stagingPopulated as jest.Mock).mockReturnValue(false);
  });
});

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

  it('getStatus reports stagedCert from getStagedPrimaryCertInfo', async () => {
    const { d, svc } = build();
    d.info.getStagedPrimaryCertInfo.mockResolvedValue({ commonName: 'staged.example.com' });
    const status = await svc.getStatus();
    expect(status.stagedCert).toEqual({ commonName: 'staged.example.com' });
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

  it('stagePaste validates then saves WITHOUT touching the snapshot (staging is provisional)', () => {
    const { d, svc } = build();
    const res = svc.stagePaste({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any);
    expect(d.bootstrap.validateCertificatePair).toHaveBeenCalledWith('C', 'K', domain, 'none');
    expect(d.bootstrap.saveCertificates).toHaveBeenCalledWith('C', 'K', domain);
    expect(res.wildcardCovered).toBe(true);
    // saveCertificates now writes into staging/, not the live dir — nothing
    // live changes yet, so there's nothing to snapshot until apply() promotes.
    expect(d.snap.snapshotForChangeCycle).not.toHaveBeenCalled();
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
  it('cert-only change behind a proxy writes config with no pending revert, and marks the snapshot applied', async () => {
    const { d, svc } = build();
    mockCur.proxyMode = 'cloudflare';
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true); // a cert was staged this cycle
    const r = await svc.apply({ proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(r.deadlineMs).toBeUndefined();
    expect(d.snap.snapshotForChangeCycle).toHaveBeenCalled();
    expect(d.snap.writePendingRevert).not.toHaveBeenCalled();
    expect(d.snap.markApplied).toHaveBeenCalled();
  });

  it('cert change on direct serving gets the confirm window (pending revert + deadline, kind stays cert-only)', async () => {
    const { d, svc } = build();
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true); // staged-but-unpromoted cert in flight
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(typeof r.deadlineMs).toBe('number');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
    expect(d.snap.markApplied).not.toHaveBeenCalled();
  });

  it('sslMode-only swap on direct serving gets the confirm window even with no staged files', async () => {
    const { d, svc } = build();
    d.snap.hasSnapshot.mockReturnValue(false);
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'selfsigned', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(typeof r.deadlineMs).toBe('number');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
  });

  it('a no-op direct-mode apply with nothing staged and no sslMode change does not trigger the confirm window', async () => {
    const { d, svc } = build();
    // stagingPopulated() defaults to false (beforeEach) and sslMode is
    // unchanged, so certAffecting is simply false — there's no "stale applied
    // snapshot" leftover state to guard against under the new staging model.
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.deadlineMs).toBeUndefined();
    expect(d.snap.writePendingRevert).not.toHaveBeenCalled();
    expect(d.snap.markApplied).toHaveBeenCalled();
  });

  it('apply promotes staging after snapshotting, in that order', async () => {
    const { d, svc } = build();
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true);
    await svc.apply({ proxyMode: 'proxy', sslMode: 'paste', port80: 'closed' } as any);
    expect(staging.promoteStagedCertificates).toHaveBeenCalled();
    const snapOrder = d.snap.snapshotForChangeCycle.mock.invocationCallOrder[0];
    const promoteOrder = (staging.promoteStagedCertificates as jest.Mock).mock.invocationCallOrder[0];
    expect(snapOrder).toBeLessThan(promoteOrder);
  });

  it('apply with sslMode selfsigned DISCARDS staging instead of promoting', async () => {
    const { svc } = build();
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true);
    await svc.apply({ proxyMode: 'proxy', sslMode: 'selfsigned' } as any);
    expect(staging.discardStagedCertificates).toHaveBeenCalled();
    expect(staging.promoteStagedCertificates).not.toHaveBeenCalled();
  });

  it('a populated stage on direct serving triggers the confirm window (certAffecting)', async () => {
    const { d, svc } = build(); // current config: proxyMode 'none', sslMode 'paste' — same next values
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true);
    const res = await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect' } as any);
    expect(res.deadlineMs).toBeDefined();
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
  });

  it('rejects apply when staging is partially populated (torn stage), before promoting', async () => {
    const { d, svc } = build();
    (staging.stagingPartiallyPopulated as jest.Mock).mockReturnValue(true);
    await expect(
      svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect' } as any),
    ).rejects.toThrow(/incomplete/i);
    expect(staging.promoteStagedCertificates).not.toHaveBeenCalled();
    expect(staging.discardStagedCertificates).not.toHaveBeenCalled();
    expect(d.snap.snapshotForChangeCycle).not.toHaveBeenCalled();
  });

  it('discardStaged clears the staging dir', () => {
    const { svc } = build();
    expect(svc.discardStaged()).toEqual({ discarded: true });
    expect(staging.discardStagedCertificates).toHaveBeenCalled();
  });

  it('apply stamps origin: wizard, graduating an env-adopted install to UI-managed identity', async () => {
    const { svc } = build();
    const dto = { proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any;
    mockCur.proxyMode = 'cloudflare'; // no reachability change; mirrors the "cert-only change behind a proxy" case above

    // A wizard (origin-absent) install stays wizard-owned; the write makes it explicit.
    await svc.apply(dto);
    const calls = (writeInstanceConfig as jest.Mock).mock.calls;
    const wizardWrite = calls[calls.length - 1][0];
    expect(wizardWrite.origin).toBe('wizard');

    // Day-2 apply on an env-adopted install (origin:'env') GRADUATES it: the
    // written config becomes origin:'wizard' so the boot re-sync no longer
    // treats .env as authoritative for identity (spec §3).
    mockCur.origin = 'env';
    await svc.apply(dto);
    const graduatedWrite = calls[calls.length - 1][0];
    expect(graduatedWrite).toEqual(expect.objectContaining({ origin: 'wizard' }));
  });

  it('logs a graduation notice on an env-origin install, and not on a wizard-origin install', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { svc } = build();
      // No reachability change (proxyMode matches cur) so apply commits cleanly.
      mockCur.proxyMode = 'cloudflare';
      const dto = { proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any;

      // env-origin apply graduates the install -> a graduation notice is logged.
      mockCur.origin = 'env';
      await svc.apply(dto);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('graduated'));

      // wizard-origin apply is unchanged -> nothing to graduate, no notice.
      warn.mockClear();
      mockCur.origin = 'wizard';
      await svc.apply(dto);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('serving change writes a pending revert with a deadline and does not mark applied', async () => {
    process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS = '1000';
    const { d, svc } = build();
    const r = await svc.apply({ proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('serving');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
    expect(typeof r.deadlineMs).toBe('number');
    expect(d.snap.markApplied).not.toHaveBeenCalled();
    delete process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS;
  });

  it('rejects a second apply while a revert is pending', async () => {
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
  it('preflights, then requests the cert into staging', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'] });
    const r = await svc.issueLetsEncrypt();
    expect(d.preflight.run).toHaveBeenCalledWith('a.com');
    expect(d.ssl.requestPrimaryDomainCertificate).toHaveBeenCalledWith('a.com', { target: 'staging' });
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
  it('issueLetsEncrypt never snapshots — nothing live is written until apply', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'] });
    await svc.issueLetsEncrypt();
    expect(d.snap.snapshotForChangeCycle).not.toHaveBeenCalled();
    expect(d.snap.snapshot).not.toHaveBeenCalled();
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
