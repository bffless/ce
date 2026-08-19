// Task 8: LE primary renewal + wildcard expiry reminder email.
//
// The db mock below is deliberately key-aware (not a generic FIFO queue):
// tests set values directly on `settingsStore`/`adminUserStore` and assert
// against them, mirroring how a real `ssl_settings` row / admin user would
// behave. To make that possible without parsing real drizzle SQL, `eq` is
// also mocked to a plain `{ value }` marker — schema files only ever import
// `relations` from 'drizzle-orm' (verified via grep), so this doesn't affect
// table definitions, only the service's own `.where(eq(...))` calls.
jest.mock('drizzle-orm', () => {
  const actual = jest.requireActual('drizzle-orm');
  return {
    ...actual,
    eq: (_col: unknown, value: unknown) => ({ value }),
    and: (...conds: unknown[]) => ({ conds }),
    desc: (col: unknown) => ({ col }),
  };
});

let settingsStore: Record<string, string> = {};
let adminUserStore: { email: string } | null = null;
let domainRowsStore: Array<Record<string, unknown>> = [];
const renewalHistoryStore: Array<Record<string, unknown>> = [];

jest.mock('../db/client', () => {
  const schema = jest.requireActual('../db/schema');
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (cond: { value?: unknown }) => {
            let rows: unknown[] = [];
            if (table === schema.sslSettings) {
              const key = cond?.value as string | undefined;
              rows =
                key !== undefined && settingsStore[key] !== undefined
                  ? [{ key, value: settingsStore[key] }]
                  : [];
            } else if (table === schema.users) {
              rows = adminUserStore ? [adminUserStore] : [];
            } else if (table === schema.domainMappings) {
              rows = domainRowsStore;
            }
            const p = Promise.resolve(rows) as Promise<unknown[]> & {
              limit?: (n: number) => Promise<unknown[]>;
            };
            p.limit = async (n: number) => rows.slice(0, n);
            return p;
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (record: Record<string, unknown>) => {
          const schemaMod = jest.requireActual('../db/schema');
          if (table === schemaMod.sslRenewalHistory) {
            renewalHistoryStore.push(record);
          }
          const p = Promise.resolve(undefined) as Promise<unknown> & {
            onConflictDoUpdate?: () => Promise<void>;
          };
          p.onConflictDoUpdate = async () => {
            if (table === schemaMod.sslSettings) {
              settingsStore[record.key as string] = record.value as string;
            }
          };
          return p;
        },
      }),
      // checkAndRenewDomains persists renewal status back onto the domain row;
      // no test here asserts on the write, so this just needs to not throw.
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    },
  };
});

jest.mock('../bootstrap/instance-config');

import { Logger } from '@nestjs/common';
import { SslRenewalService } from './ssl-renewal.service';
import { SslCertificateService } from './ssl-certificate.service';
import { SslInfoService } from './ssl-info.service';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';
import { EmailService } from '../email/email.service';
import { loadInstanceConfig, pendingServingRevertExists } from '../bootstrap/instance-config';
import type { SslCertificateInfo } from './ssl-info.service';

/** Minimal SslCertificateInfo fixture (SslInfoService's real return shape). */
const certInfo = (overrides: Partial<SslCertificateInfo> = {}): SslCertificateInfo => ({
  type: 'wildcard',
  commonName: '*.example.com',
  issuer: "Let's Encrypt",
  issuedAt: new Date(),
  expiresAt: new Date(),
  daysUntilExpiry: 15,
  isValid: true,
  isExpiringSoon: true,
  serialNumber: '01',
  fingerprint: 'aa:bb:cc',
  ...overrides,
});

describe('SslRenewalService', () => {
  let service: SslRenewalService;
  let sslCert: jest.Mocked<
    Pick<
      SslCertificateService,
      | 'getPrimaryCertificateExpiryDays'
      | 'requestPrimaryDomainCertificate'
      | 'renewWildcardCertificate'
      | 'requestCustomDomainCertificate'
      | 'getPrimaryCertificateSans'
    >
  >;
  let sslInfo: jest.Mocked<Pick<SslInfoService, 'getWildcardCertInfo' | 'getDomainSslInfo'>>;
  let email: jest.Mocked<Pick<EmailService, 'sendEmail'>>;

  beforeEach(() => {
    settingsStore = {};
    adminUserStore = null;
    domainRowsStore = [];
    renewalHistoryStore.length = 0;
    jest.clearAllMocks();

    sslCert = {
      getPrimaryCertificateExpiryDays: jest.fn().mockReturnValue(null),
      requestPrimaryDomainCertificate: jest.fn(),
      renewWildcardCertificate: jest.fn(),
      requestCustomDomainCertificate: jest.fn(),
      getPrimaryCertificateSans: jest.fn().mockReturnValue(null),
    };
    sslInfo = {
      getWildcardCertInfo: jest.fn().mockResolvedValue(null),
      getDomainSslInfo: jest.fn(),
    };
    email = {
      sendEmail: jest.fn().mockResolvedValue({ success: true }),
    };
    const nginxConfigService = {} as NginxConfigService;
    const nginxReloadService = {} as NginxReloadService;
    const projectsService = {} as ProjectsService;

    service = new SslRenewalService(
      sslCert as unknown as SslCertificateService,
      sslInfo as unknown as SslInfoService,
      nginxConfigService,
      nginxReloadService,
      projectsService,
      email as unknown as EmailService,
    );

    (loadInstanceConfig as jest.Mock).mockReturnValue(null);
    // mockReturnValue persists across clearAllMocks (only mockReset would drop
    // it), so re-pin the default here or a prior test's
    // pendingServingRevertExists(true) leaks into later tests.
    (pendingServingRevertExists as jest.Mock).mockReturnValue(false);
  });

  describe('primary-domain LE renewal', () => {
    it('renews the primary cert when sslMode is letsencrypt and within threshold', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(20);
      sslCert.requestPrimaryDomainCertificate.mockResolvedValue({
        success: true,
        expiresAt: new Date(),
      });

      await service.checkAndRenewCertificates();

      expect(sslCert.requestPrimaryDomainCertificate).toHaveBeenCalledWith('example.com', {});
    });

    it('renews an env-adopted install with the current cert SAN list preserved', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        origin: 'env',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(5);
      sslCert.getPrimaryCertificateSans.mockReturnValue([
        'example.com',
        'www.example.com',
        'admin.example.com',
        'minio.example.com',
      ]);
      sslCert.requestPrimaryDomainCertificate.mockResolvedValue({ success: true });

      await service.checkAndRenewCertificates();

      expect(sslCert.requestPrimaryDomainCertificate).toHaveBeenCalledWith('example.com', {
        extraSans: ['example.com', 'www.example.com', 'admin.example.com', 'minio.example.com'],
      });
    });

    it('renews a wizard install without a SAN override', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(5);
      sslCert.requestPrimaryDomainCertificate.mockResolvedValue({ success: true });

      await service.checkAndRenewCertificates();

      expect(sslCert.requestPrimaryDomainCertificate).toHaveBeenCalledWith('example.com', {});
      expect(sslCert.getPrimaryCertificateSans).not.toHaveBeenCalled();
    });

    it('skips primary renewal when sslMode is paste', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'cloudflare',
        sslMode: 'paste',
      });

      await service.checkAndRenewCertificates();

      expect(sslCert.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
    });

    it('skips primary renewal when not within threshold', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(60);

      await service.checkAndRenewCertificates();

      expect(sslCert.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
    });

    it('m7: skips primary renewal while a serving-confirm window is pending', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(5); // inside threshold
      (pendingServingRevertExists as jest.Mock).mockReturnValue(true);

      const result = await (service as any).checkAndRenewPrimary(30);

      expect(result).toBeNull();
      expect(sslCert.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
    });
  });

  describe('wildcard expiry reminder', () => {
    beforeEach(() => {
      sslInfo.getWildcardCertInfo.mockResolvedValue(certInfo({ daysUntilExpiry: 15 }));
      sslCert.renewWildcardCertificate.mockResolvedValue({
        success: false,
        error:
          'Automatic wildcard renewal requires DNS API integration. Please renew manually via the DNS challenge flow.',
      });
    });

    it('emails when the wildcard cannot auto-renew', async () => {
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: expect.stringMatching(/wildcard/i),
        }),
      );
    });

    it('does not re-email within 7 days', async () => {
      settingsStore['notification_email'] = 'admin@example.com';
      settingsStore['wildcard_reminder_last_sent'] = new Date().toISOString();

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it('emails again after 7 days have passed', async () => {
      settingsStore['notification_email'] = 'admin@example.com';
      settingsStore['wildcard_reminder_last_sent'] = new Date(
        Date.now() - 8 * 86_400_000,
      ).toISOString();

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).toHaveBeenCalled();
    });

    it('falls back to the first admin user when no notification_email is set', async () => {
      adminUserStore = { email: 'root-admin@example.com' };

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'root-admin@example.com' }),
      );
    });

    it('logs only (no email) when no recipient can be resolved', async () => {
      await service.checkAndRenewCertificates();

      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it('does not send the wildcard-specific reminder for a non-DNS-API failure, but the generic digest still fires', async () => {
      // A generic ACME failure still goes through the ordinary
      // sendFailureNotifications path — this test asserts both halves: the
      // *wildcard reminder* is DNS-API-failure-scoped (not sent), AND the
      // failure still reaches the generic digest (not silently dropped).
      sslCert.renewWildcardCertificate.mockResolvedValue({
        success: false,
        error: 'Some other unrelated failure',
      });
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/wildcard/i) }),
      );
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: expect.stringMatching(/renewal/i),
          // baseDomain comes from process.env.PRIMARY_DOMAIN, defaulting to
          // "localhost" when unset (as it is in this spec file).
          text: expect.stringContaining('*.localhost'),
        }),
      );
    });

    it('logs an error and does not set the throttle timestamp when the reminder email send fails', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      settingsStore['notification_email'] = 'admin@example.com';
      email.sendEmail.mockResolvedValue({ success: false, error: 'SMTP outage' });

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/wildcard/i) }),
      );
      expect(settingsStore['wildcard_reminder_last_sent']).toBeUndefined();
      // sendWildcardExpiryReminder builds its own baseDomain independently
      // (defaults to '' rather than 'localhost' when PRIMARY_DOMAIN is
      // unset), so just assert the message names the wildcard + the error.
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/wildcard.*SMTP outage/is));
    });

    it('points the reminder body at Admin → Settings → SSL', async () => {
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Admin → Settings → SSL'),
        }),
      );
    });

    // M1 (review finding): a Cloudflare/paste install whose pasted origin
    // cert happens to carry a real *.<domain> SAN gets copied onto the
    // wildcard.<domain>.crt render-contract filename (see
    // ssl-certificate.service.ts) and so passes getWildcardCertInfo's
    // "genuinely covers the SAN" check — but it was never DNS-01 issued here
    // and can't auto-renew via this path. Without gating, such an install
    // would get BOTH the paste reminder (checkAndRemindPrimaryPaste) AND this
    // wildcard reminder, the latter with DNS-01 TXT-record instructions that
    // make no sense for a pasted origin cert. Only a genuinely LE-managed
    // instance (sslMode: 'letsencrypt') should reach this reminder.
    it('does NOT send the wildcard reminder (or attempt renewal) for a paste/cloudflare install', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'cloudflare',
        sslMode: 'paste',
      });
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(sslCert.renewWildcardCertificate).not.toHaveBeenCalled();
      expect(email.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/wildcard/i) }),
      );
    });

    it('does NOT send the wildcard reminder for a selfsigned install', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'proxy',
        sslMode: 'selfsigned',
      });
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(sslCert.renewWildcardCertificate).not.toHaveBeenCalled();
      expect(email.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/wildcard/i) }),
      );
    });

    it('DOES still send the wildcard reminder for a genuinely letsencrypt-managed install', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(sslCert.renewWildcardCertificate).toHaveBeenCalled();
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: expect.stringMatching(/wildcard/i),
        }),
      );
    });

    it('DOES still send the wildcard reminder for a legacy env-only install (no instance.json)', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue(null);
      settingsStore['notification_email'] = 'admin@example.com';

      await service.checkAndRenewCertificates();

      expect(sslCert.renewWildcardCertificate).toHaveBeenCalled();
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: expect.stringMatching(/wildcard/i),
        }),
      );
    });
  });

  describe('paste primary-cert expiry reminder', () => {
    it('emails when a pasted primary cert is within the threshold', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'paste',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
      settingsStore['notification_email'] = 'admin@example.com';
      await service.checkAndRenewCertificates();
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: expect.stringMatching(/certificate .* expires/i),
        }),
      );
    });

    it('points the paste reminder body at Admin → Settings → SSL for re-paste/re-issue', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'cloudflare',
        sslMode: 'paste',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
      settingsStore['notification_email'] = 'admin@example.com';
      await service.checkAndRenewCertificates();
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          html: expect.stringMatching(/re-paste or re-issue.*Admin → Settings → SSL/is),
        }),
      );
    });

    it('does not remind for a letsencrypt primary cert (it auto-renews)', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'letsencrypt',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
      sslCert.requestPrimaryDomainCertificate.mockResolvedValue({
        success: true,
        expiresAt: new Date(),
      });
      await service.checkAndRenewCertificates();
      // the LE path renews; it must not ALSO send the paste reminder
      expect(email.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/certificate .* expires/i) }),
      );
    });

    it('does not remind for a selfsigned install', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'proxy',
        sslMode: 'selfsigned',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(5);
      await service.checkAndRenewCertificates();
      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it('does not re-send within 7 days', async () => {
      (loadInstanceConfig as jest.Mock).mockReturnValue({
        version: 2,
        state: 'applied',
        primaryDomain: 'example.com',
        proxyMode: 'none',
        sslMode: 'paste',
      });
      sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
      settingsStore['notification_email'] = 'admin@example.com';
      settingsStore['primary_cert_reminder_last_sent'] = new Date().toISOString();
      await service.checkAndRenewCertificates();
      expect(email.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('sendFailureNotifications', () => {
    it('emails the recipient with one line per failed custom-domain renewal', async () => {
      settingsStore['notification_email'] = 'admin@example.com';
      domainRowsStore = [
        {
          id: 'd1',
          domain: 'fails.example.com',
          domainType: 'custom',
          sslEnabled: true,
          autoRenewSsl: true,
          isActive: true,
          projectId: null,
        },
      ];
      sslInfo.getDomainSslInfo.mockResolvedValue(
        certInfo({ type: 'individual', commonName: 'fails.example.com', daysUntilExpiry: 5 }),
      );
      sslCert.requestCustomDomainCertificate.mockResolvedValue({
        success: false,
        error: 'ACME failure',
      });

      await service.checkAndRenewCertificates();

      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: 'SSL renewal failures',
          text: expect.stringContaining('fails.example.com: ACME failure'),
        }),
      );
    });

    it('m8: failure digest is throttled to once per 7 days', async () => {
      settingsStore['notification_email'] = 'admin@example.com';
      settingsStore['renewal_failure_last_sent'] = new Date(
        Date.now() - 3 * 86_400_000,
      ).toISOString();

      await (service as any).sendFailureNotifications([
        { domain: 'x.com', status: 'failed', error: 'boom' },
      ]);

      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it('m8: failure digest sends again after the window and stamps the marker', async () => {
      settingsStore['notification_email'] = 'admin@example.com';
      settingsStore['renewal_failure_last_sent'] = new Date(
        Date.now() - 8 * 86_400_000,
      ).toISOString();
      const updateSettingSpy = jest.spyOn(service as any, 'updateSetting');

      await (service as any).sendFailureNotifications([
        { domain: 'x.com', status: 'failed', error: 'boom' },
      ]);

      expect(email.sendEmail).toHaveBeenCalled();
      expect(updateSettingSpy).toHaveBeenCalledWith(
        'renewal_failure_last_sent',
        expect.any(String),
      );
    });
  });
});
