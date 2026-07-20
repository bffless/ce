import { BadRequestException } from '@nestjs/common';
import { BootstrapSetupController } from './bootstrap-setup.controller';

describe('BootstrapSetupController', () => {
  let controller: BootstrapSetupController;
  const svc = {
    assertBootstrapAllowed: jest.fn(),
    validateCertificatePair: jest.fn().mockReturnValue({ sans: ['example.com', '*.example.com'] }),
    saveCertificates: jest.fn(),
    certificatesPresent: jest.fn().mockReturnValue(true),
    assertStagedCertificateCovers: jest.fn(),
    validateDomain: jest.fn((d: string) => d.toLowerCase()),
  };
  const exitFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    svc.assertBootstrapAllowed.mockResolvedValue(undefined);
    svc.validateCertificatePair.mockReturnValue({ sans: ['example.com', '*.example.com'] });
    svc.certificatesPresent.mockReturnValue(true);
    svc.assertStagedCertificateCovers.mockReturnValue(undefined);
    svc.validateDomain.mockImplementation((d: string) => d.toLowerCase());
    controller = new BootstrapSetupController(svc as any);
    (controller as any).scheduleExit = exitFn; // do not actually exit in tests
  });

  describe('uploadCertificates', () => {
    it('awaits assertBootstrapAllowed, then validates and saves certificates', async () => {
      const res = await controller.uploadCertificates({
        domain: 'example.com',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
      });
      expect(svc.assertBootstrapAllowed).toHaveBeenCalled();
      expect(svc.validateCertificatePair).toHaveBeenCalledWith('CERT', 'KEY', 'example.com');
      expect(svc.saveCertificates).toHaveBeenCalledWith('CERT', 'KEY', 'example.com');
      expect(res).toEqual({ saved: true, sans: ['example.com', '*.example.com'] });
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
      const res = await controller.apply({ domain: 'example.com', proxyMode: 'cloudflare' });
      expect(svc.assertBootstrapAllowed).toHaveBeenCalled();
      expect(svc.assertStagedCertificateCovers).toHaveBeenCalledWith('example.com');
      expect(writeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'applied', primaryDomain: 'example.com', proxyMode: 'cloudflare' }),
      );
      expect(res).toEqual({ applying: true, adminUrl: 'https://admin.example.com' });
      expect(exitFn).toHaveBeenCalled();
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
      const res = await controller.apply({ domain: 'Example.COM', proxyMode: 'none' });
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
        controller.apply({ domain: 'example.com; rm -rf /', proxyMode: 'none' }),
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
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare' }),
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
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare' }),
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
        controller.apply({ domain: 'example.com', proxyMode: 'cloudflare' }),
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
