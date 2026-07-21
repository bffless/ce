import { BadRequestException } from '@nestjs/common';
import { BootstrapSetupController } from './bootstrap-setup.controller';

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
      port80: dto.port80 ?? (dto.proxyMode === 'cloudflare' ? 'closed' : 'redirect'),
      realIp:
        dto.proxyMode === 'cloudflare'
          ? { preset: 'cloudflare' }
          : dto.realIp
            ? { header: dto.realIp.header, ranges: dto.realIp.ranges }
            : null,
    })),
    finalizeSetup: jest.fn(),
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
    controller = new BootstrapSetupController(svc as any);
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
      expect(svc.validateClaimToken).toHaveBeenCalledWith('claim-123');
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
      expect(svc.validateClaimToken).toHaveBeenCalledWith(undefined);
      // Setup is marked complete as part of apply, so the restarted backend
      // lands the user at login instead of back in the wizard.
      expect(svc.finalizeSetup).toHaveBeenCalled();
      expect(exitFn).toHaveBeenCalled();
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
  });

  describe('scheduleExit (real timer, not invoked through the mocked override)', () => {
    it('schedules an unref-ed 500ms timer that calls process.exit(0)', () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((() => {
        // Never actually exit the Jest worker.
        return undefined as never;
      }) as unknown) as (code?: number) => never);

      const freshController = new BootstrapSetupController(svc as any);
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
});
