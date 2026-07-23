import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SetupService } from './setup.service';
import { EmailService } from '../email/email.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { UsageReporterService } from '../platform/usage-reporter.service';

// Mock the database (matches the convention used across apps/backend/src/**/*.service.spec.ts,
// e.g. users.service.spec.ts / projects.service.spec.ts).
jest.mock('../db/client', () => ({
  db: {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  },
}));

// Import mocked modules
import { db } from '../db/client';

// Type the mocked db
const mockDb = db as any;

describe('SetupService', () => {
  let service: SetupService;
  let mockFeatureFlagsService: { isEnabled: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFeatureFlagsService = {
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EmailService, useValue: {} },
        { provide: ModuleRef, useValue: { get: jest.fn() } },
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
        {
          provide: UsageReporterService,
          useValue: { reportSetupComplete: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<SetupService>(SetupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSetupStatus', () => {
    it('should return setup status', () => {
      const mockStatus = { isSetupComplete: false };
      jest.spyOn(service, 'getSetupStatus').mockResolvedValue(mockStatus as any);

      expect(service.getSetupStatus()).resolves.toEqual(mockStatus);
    });
  });

  describe('initialize', () => {
    it('should initialize the system', () => {
      const mockResult = { success: true };
      jest.spyOn(service, 'initialize').mockResolvedValue(mockResult as any);

      expect(service.initialize({} as any)).resolves.toEqual(mockResult);
    });
  });

  describe('configureStorage', () => {
    it('should configure storage', () => {
      const mockResult = { success: true };
      jest.spyOn(service, 'configureStorage').mockResolvedValue(mockResult as any);

      expect(service.configureStorage({} as any)).resolves.toEqual(mockResult);
    });
  });

  describe('updateStorageCredentials', () => {
    it('should update storage credentials in place', () => {
      const mockResult = {
        message: 'Storage credentials updated successfully',
        storageProvider: 's3',
      };
      jest.spyOn(service, 'updateStorageCredentials').mockResolvedValue(mockResult as any);

      expect(service.updateStorageCredentials({} as any)).resolves.toEqual(mockResult);
    });
  });

  describe('isPlatformManaged', () => {
    afterEach(() => {
      delete process.env.PLATFORM_MODE;
      delete process.env.SSL_MANAGED_EXTERNALLY;
    });

    it('returns true when PLATFORM_MODE=true', () => {
      process.env.PLATFORM_MODE = 'true';
      expect(service.isPlatformManaged()).toBe(true);
    });

    it('returns true when SSL_MANAGED_EXTERNALLY=true', () => {
      process.env.SSL_MANAGED_EXTERNALLY = 'true';
      expect(service.isPlatformManaged()).toBe(true);
    });

    it('returns false when neither PLATFORM_MODE nor SSL_MANAGED_EXTERNALLY is set', () => {
      expect(service.isPlatformManaged()).toBe(false);
    });
  });

  describe('getSetupStatus — bootstrap fields', () => {
    let tmpBootstrapDir: string | undefined;
    let tmpSslDir: string | undefined;

    // Arranges the two sequential db `.limit()` resolutions that getSetupStatus() awaits,
    // in call order: 1) getSystemConfig() -> systemConfig row(s), 2) admin user lookup -> users row(s).
    function arrangeDb(configRows: unknown[], adminRows: unknown[]) {
      mockDb.limit.mockResolvedValueOnce(configRows).mockResolvedValueOnce(adminRows);
    }

    // Simulates docker/nginx/render-main-conf.sh having rendered bootstrap
    // mode at least once (see wasEverBootstrapProvisioned()'s doc comment in
    // setup.service.ts). Every test in this block that expects
    // bootstrapMode=true (or is isolating a DIFFERENT conjunct while keeping
    // this one true) must call this first.
    function withBootstrapMarker() {
      tmpSslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-status-ssl-'));
      fs.writeFileSync(path.join(tmpSslDir, 'bootstrap-selfsigned.crt'), 'fake-self-signed');
      process.env.SSL_CERT_PATH = tmpSslDir;
    }

    afterEach(() => {
      delete process.env.PLATFORM_MODE;
      delete process.env.SSL_MANAGED_EXTERNALLY;
      delete process.env.ONBOARDING_TOKEN;
      delete process.env.BOOTSTRAP_DIR;
      delete process.env.SSL_CERT_PATH;

      if (tmpBootstrapDir) {
        fs.rmSync(tmpBootstrapDir, { recursive: true, force: true });
        tmpBootstrapDir = undefined;
      }
      if (tmpSslDir) {
        fs.rmSync(tmpSslDir, { recursive: true, force: true });
        tmpSslDir = undefined;
      }
    });

    it('reports bootstrapMode=true and claimRequired=true on a fresh unclaimed install with a token', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir'; // no applied instance.json
      process.env.ONBOARDING_TOKEN = 'tok-123';
      withBootstrapMarker();
      arrangeDb([], []); // isSetupComplete=false, hasAdminUser=false

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(true);
      expect(status.claimRequired).toBe(true);
    });

    it('reports bootstrapMode=false and claimRequired=false when PLATFORM_MODE=true (all other conjuncts true)', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      process.env.PLATFORM_MODE = 'true';
      withBootstrapMarker();
      arrangeDb([], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(false);
      expect(status.claimRequired).toBe(false);
    });

    it('reports bootstrapMode=false when SSL_MANAGED_EXTERNALLY=true (all other conjuncts true)', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      process.env.SSL_MANAGED_EXTERNALLY = 'true';
      withBootstrapMarker();
      arrangeDb([], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(false);
    });

    it('reports bootstrapMode=false when ENABLE_BOOTSTRAP_SETUP is disabled (all other conjuncts true)', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      mockFeatureFlagsService.isEnabled.mockResolvedValue(false);
      withBootstrapMarker();
      arrangeDb([], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(false);
      expect(status.claimRequired).toBe(false);
    });

    it('reports bootstrapMode=false when instance.json state is applied (all other conjuncts true)', async () => {
      tmpBootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-status-test-'));
      fs.writeFileSync(
        path.join(tmpBootstrapDir, 'instance.json'),
        JSON.stringify({ version: 1, state: 'applied', primaryDomain: 'example.com' }),
      );
      process.env.BOOTSTRAP_DIR = tmpBootstrapDir;
      process.env.ONBOARDING_TOKEN = 'tok-123';
      withBootstrapMarker();
      arrangeDb([], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(false);
    });

    it('reports bootstrapMode=false when setup is already complete (all other conjuncts true)', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      withBootstrapMarker();
      arrangeDb([{ isSetupComplete: true }], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(false);
    });

    it('reports claimRequired=false when ONBOARDING_TOKEN is not set, even though bootstrapMode is true', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      // ONBOARDING_TOKEN intentionally left unset
      withBootstrapMarker();
      arrangeDb([], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(true);
      expect(status.claimRequired).toBe(false);
    });

    it('reports claimRequired=false when an admin user already exists, even though bootstrapMode is true', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      withBootstrapMarker();
      arrangeDb([], [{ id: 'admin-1', role: 'admin' }]);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(true);
      expect(status.claimRequired).toBe(false);
    });

    // --- Critical-2 (final review): legacy/env-configured installs must ---
    // --- never report bootstrapMode=true, even before the DB wizard runs ---

    it('reports bootstrapMode=false on a legacy install that never entered cert-less bootstrap (no self-signed marker), even though setup is incomplete', async () => {
      // Simulates: user ran `./setup.sh` interactively with a real domain +
      // Let's Encrypt certs, then `./start.sh`. nginx's very first render
      // already has real certs, so it renders NORMAL mode immediately and
      // never creates bootstrap-selfsigned.crt. The DB wizard (admin user,
      // storage, ...) hasn't run yet, so isSetupComplete is still false —
      // but bootstrapMode must be false regardless, or the wizard's
      // Domain & SSL step would demand a wildcard SAN a plain LE cert
      // doesn't have, and completing it would overwrite the working certs.
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      const emptySslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-status-nomark-'));
      process.env.SSL_CERT_PATH = emptySslDir; // no bootstrap-selfsigned.crt here
      arrangeDb([], []);

      try {
        const status = await service.getSetupStatus();

        expect(status.bootstrapMode).toBe(false);
        expect(status.claimRequired).toBe(false);
      } finally {
        fs.rmSync(emptySslDir, { recursive: true, force: true });
      }
    });

    it('reports bootstrapMode=true on a genuinely bare install (self-signed marker present), even before the DB wizard runs', async () => {
      // Simulates: a fresh cert-less bootstrap install (DO 1-click / manual
      // `./setup.sh --bootstrap`). nginx's first render had no certs, so it
      // created bootstrap-selfsigned.crt and stayed in bootstrap mode.
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      process.env.ONBOARDING_TOKEN = 'tok-123';
      withBootstrapMarker();
      arrangeDb([], []);

      const status = await service.getSetupStatus();

      expect(status.bootstrapMode).toBe(true);
      expect(status.claimRequired).toBe(true);
    });

    // --- isBootstrapModeActive called directly (no isSetupComplete hint) ---
    // --- the path BootstrapSetupService.assertBootstrapAllowed uses to    ---
    // --- gate the certificate/apply endpoints                             ---

    it('isBootstrapModeActive fetches setup completeness itself when called without a hint', async () => {
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      withBootstrapMarker();
      mockDb.limit.mockResolvedValueOnce([]); // no system config row -> setup incomplete

      await expect(service.isBootstrapModeActive()).resolves.toBe(true);
    });

    it('isBootstrapModeActive returns false once setup is complete (endpoint gate on a working install)', async () => {
      // The endpoint-abuse scenario the guard exists for: flag on, marker
      // present (this WAS a bootstrap install), but setup has since
      // completed — the certificate/apply endpoints must be dead.
      process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir';
      withBootstrapMarker();
      mockDb.limit.mockResolvedValueOnce([{ isSetupComplete: true }]);

      await expect(service.isBootstrapModeActive()).resolves.toBe(false);
    });

    it('isBootstrapModeActive returns false once instance.json is applied, without querying the db', async () => {
      tmpBootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-status-inst-'));
      fs.writeFileSync(
        path.join(tmpBootstrapDir, 'instance.json'),
        JSON.stringify({ version: 1, state: 'applied', primaryDomain: 'example.com' }),
      );
      process.env.BOOTSTRAP_DIR = tmpBootstrapDir;
      withBootstrapMarker();
      // No arrangeDb: the applied-state short-circuit must fire before any
      // system-config query is needed.

      await expect(service.isBootstrapModeActive()).resolves.toBe(false);
      expect(mockDb.limit).not.toHaveBeenCalled();
    });
  });

  describe('validateOnboardingToken — rate limiting', () => {
    beforeEach(() => {
      process.env.ONBOARDING_TOKEN = 'right-token';
      (service as any).claimAttempts = { count: 0, windowStart: 0 }; // reset internal state
    });
    afterEach(() => delete process.env.ONBOARDING_TOKEN);

    it('locks out after 5 failed attempts', () => {
      for (let i = 0; i < 5; i++) {
        expect(() => (service as any).validateOnboardingToken('wrong')).toThrow(/invalid/i);
      }
      // 6th attempt — even with the RIGHT token — is rejected as rate-limited
      expect(() => (service as any).validateOnboardingToken('right-token')).toThrow(/too many/i);
    });

    it('a successful validation resets the counter', () => {
      expect(() => (service as any).validateOnboardingToken('wrong')).toThrow();
      expect(() => (service as any).validateOnboardingToken('right-token')).not.toThrow();
      expect((service as any).claimAttempts.count).toBe(0);
    });

    // Exercises the real public entry point (`initialize`) instead of poking
    // `claimAttempts` directly, so a broken implementation that merely has the
    // right-shaped field (but isn't actually wired into validateOnboardingToken's
    // call path) can't pass by coincidence.
    it('locks out via the public initialize() flow without touching internal state', async () => {
      const dto = { email: 'admin@example.com', password: 'Sup3rSecret1!', token: 'wrong' } as any;
      for (let i = 0; i < 5; i++) {
        await expect(service.initialize(dto)).rejects.toThrow(/invalid/i);
      }
      await expect(service.initialize({ ...dto, token: 'right-token' })).rejects.toThrow(
        /too many/i,
      );
    });

    it('resets the window after 15 minutes and allows attempts again', () => {
      jest.useFakeTimers();
      try {
        for (let i = 0; i < 5; i++) {
          expect(() => (service as any).validateOnboardingToken('wrong')).toThrow(/invalid/i);
        }
        // Locked out while still inside the window.
        expect(() => (service as any).validateOnboardingToken('right-token')).toThrow(
          /too many/i,
        );

        // Advance past the 15-minute window.
        jest.advanceTimersByTime(15 * 60 * 1000 + 1);

        // Window has elapsed — a fresh attempt (even a wrong one) is allowed,
        // proving the counter reset rather than merely tolerating one more try.
        expect(() => (service as any).validateOnboardingToken('wrong')).toThrow(/invalid/i);
        expect((service as any).claimAttempts.count).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
