import { BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { BootstrapSetupController } from './bootstrap-setup.controller';
import { ApplyBootstrapDto } from './setup.dto';
import * as staging from './ssl-staging';

jest.mock('./ssl-staging', () => ({
  promoteStagedCertificates: jest.fn().mockReturnValue([]),
  discardStagedCertificates: jest.fn(),
  stagingPartiallyPopulated: jest.fn().mockReturnValue(false),
}));

describe('BootstrapSetupController', () => {
  let controller: BootstrapSetupController;
  const svc = {
    assertBootstrapAllowed: jest.fn(),
    validateClaimToken: jest.fn(),
    validateCertificatePair: jest
      .fn()
      .mockReturnValue({ sans: ['example.com', '*.example.com'], wildcardCovered: true }),
    saveCertificates: jest.fn(),
    certificatesPresent: jest.fn().mockReturnValue(true),
    assertStagedCertificateCovers: jest.fn(),
    validateDomain: jest.fn((d: string) => d.toLowerCase()),
    validateApplyConfig: jest.fn((dto: any) => ({
      proxyMode: dto.proxyMode,
      sslMode: dto.sslMode,
      // Mirrors the real validateApplyConfig default (m13): 'redirect' for
      // every path when port80 is not chosen explicitly, Cloudflare included.
      port80: dto.port80 ?? 'redirect',
      realIp:
        dto.proxyMode === 'cloudflare'
          ? { preset: 'cloudflare' }
          : dto.realIp
            ? { header: dto.realIp.header, ranges: dto.realIp.ranges }
            : null,
    })),
    finalizeSetup: jest.fn(),
    unfinalizeSetup: jest.fn(),
  };
  const preflight = {
    run: jest.fn(),
  };
  const sslCert = {
    initialize: jest.fn(),
    requestPrimaryDomainCertificate: jest.fn(),
    startWildcardCertificateRequest: jest.fn(),
    completeWildcardCertificateRequest: jest.fn(),
  };
  const exitFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    svc.assertBootstrapAllowed.mockResolvedValue(undefined);
    svc.validateClaimToken.mockReturnValue(undefined);
    svc.validateCertificatePair.mockReturnValue({
      sans: ['example.com', '*.example.com'],
      wildcardCovered: true,
    });
    svc.certificatesPresent.mockReturnValue(true);
    svc.assertStagedCertificateCovers.mockReturnValue(undefined);
    svc.validateDomain.mockImplementation((d: string) => d.toLowerCase());
    svc.finalizeSetup.mockResolvedValue(undefined);
    svc.unfinalizeSetup.mockResolvedValue(undefined);
    preflight.run.mockResolvedValue({ ok: true, checks: [] });
    sslCert.initialize.mockResolvedValue(undefined);
    const featureFlags = { reconcileWildcardSslVisibility: jest.fn().mockResolvedValue(undefined) };
    controller = new BootstrapSetupController(svc as any, preflight as any, sslCert as any, featureFlags as any);
    (controller as any).scheduleExit = exitFn; // do not actually exit in tests
  });

  describe('uploadCertificates', () => {
    it('awaits assertBootstrapAllowed, then validates and saves certificates', async () => {
      const res = await controller.uploadCertificates({
        domain: 'example.com',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
        servingMode: 'cloudflare',
      });
      expect(svc.assertBootstrapAllowed).toHaveBeenCalled();
      expect(svc.validateCertificatePair).toHaveBeenCalledWith('CERT', 'KEY', 'example.com', 'cloudflare');
      expect(svc.saveCertificates).toHaveBeenCalledWith('CERT', 'KEY', 'example.com');
      expect(res).toEqual({ saved: true, sans: ['example.com', '*.example.com'], wildcardCovered: true });
    });

    it('validates the claim token (after the mode gate, before any cert work)', async () => {
      await controller.uploadCertificates({
        domain: 'example.com',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
        servingMode: 'cloudflare',
        token: 'claim-123',
      });
      // m5: validateClaimToken now also forwards the client IP via
      // extractClientIp(); the test doesn't pass a mock request, so it's
      // undefined here.
      expect(svc.validateClaimToken).toHaveBeenCalledWith('claim-123', undefined);
    });

    it('forwards the X-Forwarded-For-derived IP, not the raw socket peer (req.ip)', async () => {
      // Only nginx ever connects directly to the backend (no exposed ports),
      // so req.ip/req.socket.remoteAddress is always nginx's own address —
      // using it for per-IP rate limiting would collapse every client into
      // one bucket, reproducing the lockout DoS this rate limiter exists to
      // prevent. extractClientIp() must be used instead, which reads the
      // client IP nginx forwards in X-Forwarded-For.
      const mockReq = {
        headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.5' },
        ip: '10.0.0.5',
        socket: { remoteAddress: '10.0.0.5' },
      };

      await controller.uploadCertificates(
        {
          domain: 'example.com',
          certificatePem: 'CERT',
          privateKeyPem: 'KEY',
          servingMode: 'cloudflare',
          token: 'claim-123',
        },
        mockReq as any,
      );

      expect(svc.validateClaimToken).toHaveBeenCalledWith('claim-123', '203.0.113.7');
    });

    it('rejects a bad claim token before touching the cert (session-less auth gate)', async () => {
      // The wizard is session-less, so the token IS the auth boundary. A bad
      // token must 401 before the cert is parsed or written — otherwise an
      // unauthenticated caller on a public IP could install certs.
      svc.validateClaimToken.mockImplementationOnce(() => {
        throw new BadRequestException('Invalid onboarding token');
      });
      await expect(
        controller.uploadCertificates({
          domain: 'example.com',
          certificatePem: 'CERT',
          privateKeyPem: 'KEY',
          servingMode: 'cloudflare',
          token: 'wrong',
        }),
      ).rejects.toThrow('Invalid onboarding token');
      expect(svc.validateCertificatePair).not.toHaveBeenCalled();
      expect(svc.saveCertificates).not.toHaveBeenCalled();
    });

    it('never validates or saves certificates when the bootstrap guard rejects (order matters)', async () => {
      // Pins the ordering explicitly: a platform-managed deployment (or a
      // disabled feature flag) must be refused before ANY other work runs,
      // not merely refused eventually. If assertBootstrapAllowed were
      // awaited after validateCertificatePair/saveCertificates instead of
      // before, this test fails because the mocks would have been called
      // despite the guard rejecting.
      svc.assertBootstrapAllowed.mockRejectedValueOnce(new BadRequestException('Bootstrap setup is disabled'));
      await expect(
        controller.uploadCertificates({
          domain: 'example.com',
          certificatePem: 'CERT',
          privateKeyPem: 'KEY',
          servingMode: 'cloudflare',
        }),
      ).rejects.toThrow('Bootstrap setup is disabled');
      expect(svc.validateCertificatePair).not.toHaveBeenCalled();
      expect(svc.saveCertificates).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('awaits the guard, writes instance config, and schedules exit', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      const res = await controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' });
      expect(svc.assertBootstrapAllowed).toHaveBeenCalled();
      expect(svc.assertStagedCertificateCovers).toHaveBeenCalledWith('example.com', 'cloudflare');
      expect(writeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'applied', primaryDomain: 'example.com', proxyMode: 'cloudflare' }),
      );
      expect(res).toEqual({ applying: true, adminUrl: 'https://admin.example.com' });
      // m5: second arg is the client IP via extractClientIp() — undefined
      // since no mock request was passed to this call.
      expect(svc.validateClaimToken).toHaveBeenCalledWith(undefined, undefined);
      // Setup is marked complete as part of apply, so the restarted backend
      // lands the user at login instead of back in the wizard.
      expect(svc.finalizeSetup).toHaveBeenCalled();
      expect(exitFn).toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('apply stamps origin wizard so the install graduates from env adoption', async () => {
      // Identity change (apply) is the graduation event: an install adopted
      // from a legacy .env (origin:'env') must become wizard-owned once the
      // wizard writes a new identity, per the graduation rule in the plan.
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      await controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' });
      expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'wizard' }));
      writeSpy.mockRestore();
    });

    it('writes the v2 instance config shape (proxyMode/sslMode/port80/realIp) for a custom realIp proxy install', async () => {
      // v2 apply: validateApplyConfig resolves the knobs, and the controller
      // must pass all four through to writeInstanceConfig rather than the
      // old v1 shape (version 1, proxyMode/sslMode only).
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      const res = await controller.apply({
        domain: 'example.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        realIp: { header: 'True-Client-IP', ranges: ['151.101.0.0/16'] },
      });
      expect(svc.validateApplyConfig).toHaveBeenCalledWith(
        expect.objectContaining({ proxyMode: 'proxy', sslMode: 'paste' }),
      );
      expect(writeSpy).toHaveBeenCalledWith({
        version: 2,
        state: 'applied',
        origin: 'wizard',
        primaryDomain: 'example.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        port80: 'redirect',
        realIp: { header: 'True-Client-IP', ranges: ['151.101.0.0/16'] },
      });
      expect(res).toEqual({ applying: true, adminUrl: 'https://admin.example.com' });
      writeSpy.mockRestore();
    });

    it('rejects a bad claim token before applying or scheduling exit', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      svc.validateClaimToken.mockImplementationOnce(() => {
        throw new BadRequestException('Invalid onboarding token');
      });
      await expect(
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste', token: 'wrong' }),
      ).rejects.toThrow('Invalid onboarding token');
      expect(svc.certificatesPresent).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitFn).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('routes the domain through validateDomain before writing instance config', async () => {
      // Closes the gap flagged in the task-6 corrections: writeInstanceConfig
      // is called directly by the controller, not through a service method
      // that validates/normalizes internally like saveCertificates or
      // certificatesPresent do. A mixed-case domain must come out
      // lowercased in both the written config and the response adminUrl, so
      // it matches the lowercased wildcard cert filenames on disk and stays
      // consistent with derived nginx/cookie config.
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      const res = await controller.apply({ domain: 'Example.COM', proxyMode: 'none', sslMode: 'paste' });
      expect(svc.validateDomain).toHaveBeenCalledWith('Example.COM');
      expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({ primaryDomain: 'example.com' }));
      expect(res.adminUrl).toBe('https://admin.example.com');
      writeSpy.mockRestore();
    });

    it('rejects a domain with shell metacharacters via validateDomain, never reaching writeInstanceConfig', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      svc.validateDomain.mockImplementationOnce(() => {
        throw new BadRequestException('Invalid domain name');
      });
      await expect(
        controller.apply({ domain: 'example.com; rm -rf /', proxyMode: 'none', sslMode: 'paste' }),
      ).rejects.toThrow(BadRequestException);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitFn).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('refuses with 400 when certs are missing, before writing config or scheduling exit', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      svc.certificatesPresent.mockReturnValueOnce(false);
      await expect(
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' }),
      ).rejects.toThrow(BadRequestException);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitFn).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('refuses when the staged fullchain does not cover the domain, before writing config', async () => {
      // The change-of-mind path: certs uploaded for a different domain after
      // this one overwrote the generic fullchain.pem, so applying this
      // domain must be rejected even though certificatesPresent still
      // passes on the stale wildcard.* files.
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      svc.assertStagedCertificateCovers.mockImplementationOnce(() => {
        throw new BadRequestException('Certificate does not cover example.com');
      });
      await expect(
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' }),
      ).rejects.toThrow(/does not cover/i);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitFn).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('refuses when staging is partially populated (torn stage), before checking cert presence or writing config', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      (staging.stagingPartiallyPopulated as jest.Mock).mockReturnValueOnce(true);
      await expect(
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' }),
      ).rejects.toThrow(/incomplete/i);
      expect(svc.certificatesPresent).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitFn).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('never checks certificate presence when the bootstrap guard rejects (order matters)', async () => {
      // Pins that assertBootstrapAllowed runs before the certificate
      // presence check — a platform-managed deployment must be refused
      // without touching the filesystem at all.
      svc.assertBootstrapAllowed.mockRejectedValueOnce(new Error('Not available on platform-managed deployments'));
      await expect(
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' }),
      ).rejects.toThrow('Not available on platform-managed deployments');
      expect(svc.certificatesPresent).not.toHaveBeenCalled();
      expect(svc.validateDomain).not.toHaveBeenCalled();
      expect(exitFn).not.toHaveBeenCalled();
    });

    it('applies a selfsigned proxy install without requiring staged certs', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      svc.validateDomain.mockReturnValue('example.com');
      svc.validateApplyConfig.mockReturnValue({
        proxyMode: 'proxy', sslMode: 'selfsigned', port80: 'redirect', realIp: null,
      });
      const res = await controller.apply({
        domain: 'example.com', proxyMode: 'proxy', sslMode: 'selfsigned',
      } as ApplyBootstrapDto);
      expect(svc.certificatesPresent).not.toHaveBeenCalled();
      expect(svc.assertStagedCertificateCovers).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2, state: 'applied', sslMode: 'selfsigned', proxyMode: 'proxy' }),
      );
      expect(res.adminUrl).toBe('https://admin.example.com');
      writeSpy.mockRestore();
    });

    it('apply promotes staged certs BEFORE writing instance config (non-selfsigned)', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      // Pin explicitly (mockReturnValueOnce): an earlier test in this
      // describe block ('applies a selfsigned proxy install...') leaves
      // svc.validateApplyConfig permanently stubbed via mockReturnValue
      // (no `Once`), so relying on the shared default dto-passthrough
      // implementation here would be order-dependent.
      svc.validateApplyConfig.mockReturnValueOnce({
        proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: null,
      });
      await controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' });
      expect(staging.promoteStagedCertificates).toHaveBeenCalled();
      const promoteOrder = (staging.promoteStagedCertificates as jest.Mock).mock.invocationCallOrder[0];
      const writeOrder = writeSpy.mock.invocationCallOrder[0];
      expect(promoteOrder).toBeLessThan(writeOrder);
      writeSpy.mockRestore();
    });

    it('apply with selfsigned discards staging and does not promote', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => undefined);
      svc.validateApplyConfig.mockReturnValueOnce({
        proxyMode: 'proxy', sslMode: 'selfsigned', port80: 'redirect', realIp: null,
      });
      await controller.apply({
        domain: 'example.com', proxyMode: 'proxy', sslMode: 'selfsigned',
      } as ApplyBootstrapDto);
      expect(staging.discardStagedCertificates).toHaveBeenCalled();
      expect(staging.promoteStagedCertificates).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('M3: un-finalizes setup and returns 500 when writeInstanceConfig throws (box stays browser-recoverable)', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => {
          throw new Error('ENOSPC: no space left on device');
        });
      await expect(
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' }),
      ).rejects.toThrow(InternalServerErrorException);
      expect(svc.finalizeSetup).toHaveBeenCalled();
      expect(svc.unfinalizeSetup).toHaveBeenCalled();
      // scheduleExit is overridden with exitFn (a plain jest.fn) in
      // beforeEach — asserting on it is equivalent to spying on the
      // prototype method, which the override already shadows.
      expect(exitFn).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('M3 follow-up (#525): a rejecting unfinalizeSetup() does not mask the write failure — both errors logged, friendly 500 still thrown', async () => {
      const writeSpy = jest
        .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
        .mockImplementation(() => {
          throw new Error('ENOSPC: no space left on device');
        });
      svc.unfinalizeSetup.mockRejectedValue(new Error('connection to database lost'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        // The DB rejection must not propagate raw: the browser still gets the
        // actionable disk-space 500, not an opaque database error.
        await expect(
          controller.apply({ domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste' }),
        ).rejects.toThrow(InternalServerErrorException);
        // Both the original (more actionable) disk error AND the recovery
        // failure must reach the log.
        const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(logged).toContain('ENOSPC');
        expect(logged).toContain('connection to database lost');
        expect(exitFn).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
        writeSpy.mockRestore();
      }
    });
  });

  describe('scheduleExit (real timer, not invoked through the mocked override)', () => {
    it('schedules an unref-ed 500ms timer that calls process.exit(0)', () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((() => {
        // Never actually exit the Jest worker.
        return undefined as never;
      }) as unknown) as (code?: number) => never);

      const freshController = new BootstrapSetupController(
        svc as any,
        preflight as any,
        sslCert as any,
        { reconcileWildcardSslVisibility: jest.fn().mockResolvedValue(undefined) } as any,
      );
      (freshController as any).scheduleExit();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
      const timer = setTimeoutSpy.mock.results[0].value;
      // A real Timeout object exposes hasRef(); confirm it was unref'd so a
      // stray handle can never keep the Jest worker (or, in production, an
      // otherwise-idle process) alive on its own.
      expect(typeof timer.hasRef).toBe('function');
      expect(timer.hasRef()).toBe(false);

      jest.advanceTimersByTime(500);
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('LE endpoints', () => {
    it('dns-preflight gates then delegates with the validated domain', async () => {
      preflight.run.mockResolvedValue({ ok: true, checks: [] });
      const res = await controller.dnsPreflight({ domain: 'Example.com', token: 't' });
      expect(svc.assertBootstrapAllowed).toHaveBeenCalled();
      // m5: second arg is the client IP via extractClientIp() — undefined
      // since no mock request was passed to this call.
      expect(svc.validateClaimToken).toHaveBeenCalledWith('t', undefined);
      expect(svc.validateDomain).toHaveBeenCalledWith('Example.com');
      expect(preflight.run).toHaveBeenCalledWith('example.com');
      expect(res.ok).toBe(true);
    });

    it('issue-certificate re-runs preflight server-side and 400s when it fails', async () => {
      preflight.run.mockResolvedValue({ ok: false, checks: [] });
      await expect(
        controller.issueCertificate({ domain: 'example.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(sslCert.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
    });

    it('issue-certificate returns SANs on success, delegating with the validated domain', async () => {
      preflight.run.mockResolvedValue({ ok: true, checks: [] });
      sslCert.requestPrimaryDomainCertificate.mockResolvedValue({
        success: true, sans: ['example.com', 'www.example.com', 'admin.example.com'],
      });
      const res = await controller.issueCertificate({ domain: 'Example.com' });
      expect(svc.validateDomain).toHaveBeenCalledWith('Example.com');
      expect(sslCert.requestPrimaryDomainCertificate).toHaveBeenCalledWith('example.com', { target: 'staging' });
      expect(res).toEqual({ issued: true, sans: ['example.com', 'www.example.com', 'admin.example.com'] });
    });

    it('issue-certificate surfaces the ACME error as a 400', async () => {
      preflight.run.mockResolvedValue({ ok: true, checks: [] });
      sslCert.requestPrimaryDomainCertificate.mockResolvedValue({ success: false, error: 'rateLimited' });
      await expect(controller.issueCertificate({ domain: 'example.com' })).rejects.toThrow(/rateLimited/);
    });

    it('wildcard start delegates with the validated domain', async () => {
      sslCert.startWildcardCertificateRequest.mockResolvedValue({
        domain: 'example.com', recordName: '_acme-challenge.example.com',
        recordValue: 'v1', recordValues: ['v1', 'v2'], token: 'tok', expiresAt: new Date('2026-08-01T00:00:00Z'),
      });
      const start = await controller.wildcardStart({ domain: 'Example.com' });
      expect(svc.validateDomain).toHaveBeenCalledWith('Example.com');
      expect(sslCert.startWildcardCertificateRequest).toHaveBeenCalledWith('example.com');
      expect(start.recordName).toBe('_acme-challenge.example.com');
      expect(start.recordValues).toEqual(['v1', 'v2']);
      expect(start.expiresAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('wildcard complete delegates with the validated domain', async () => {
      sslCert.completeWildcardCertificateRequest.mockResolvedValue({ success: true });
      const done = await controller.wildcardComplete({ domain: 'Example.com' });
      expect(svc.validateDomain).toHaveBeenCalledWith('Example.com');
      expect(sslCert.completeWildcardCertificateRequest).toHaveBeenCalledWith('example.com');
      expect(done.success).toBe(true);
    });
  });
});
