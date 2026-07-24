import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client';
import {
  domainMappings,
  sslRenewalHistory,
  sslSettings,
  users,
  SslRenewalHistoryRecord,
} from '../db/schema';
import { SslCertificateService } from './ssl-certificate.service';
import { SslInfoService } from './ssl-info.service';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';
import { EmailService } from '../email/email.service';
import { loadInstanceConfig } from '../bootstrap/instance-config';

interface RenewalResult {
  domain: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  newExpiresAt?: Date;
}

@Injectable()
export class SslRenewalService {
  private readonly logger = new Logger(SslRenewalService.name);
  private isRunning = false;

  constructor(
    private readonly sslCertificateService: SslCertificateService,
    private readonly sslInfoService: SslInfoService,
    private readonly nginxConfigService: NginxConfigService,
    private readonly nginxReloadService: NginxReloadService,
    private readonly projectsService: ProjectsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Run daily at 3 AM to check and renew expiring certificates
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async checkAndRenewCertificates(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Renewal job already running, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting SSL certificate renewal check');

    try {
      const thresholdDays = await this.getRenewalThreshold();
      const results: RenewalResult[] = [];

      // 1. Check wildcard certificate
      const wildcardResult = await this.checkAndRenewWildcard(thresholdDays);
      if (wildcardResult) {
        results.push(wildcardResult);
      }

      // 1b. Primary-domain LE cert (bootstrap direct + Let's Encrypt installs)
      const primaryResult = await this.checkAndRenewPrimary(thresholdDays);
      if (primaryResult) results.push(primaryResult);

      // 1c. Pasted primary cert — cannot auto-renew (the box can't re-fetch a
      // CDN origin cert or a BYO cert). Warn before it silently expires.
      await this.checkAndRemindPrimaryPaste(thresholdDays);

      // 2. Check individual domain certificates
      const domainResults = await this.checkAndRenewDomains(thresholdDays);
      results.push(...domainResults);

      // 3. Log summary
      const successful = results.filter((r) => r.status === 'success').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;

      this.logger.log(
        `Renewal check complete: ${successful} renewed, ${failed} failed, ${skipped} skipped`,
      );

      // 4. Send notifications for failures. The wildcard's "needs DNS API
      // integration" failure is excluded here — it recurs every run until the
      // wildcard is manually renewed, and it already gets its own throttled
      // reminder (sendWildcardExpiryReminder) rather than piling into the
      // generic failure digest every single day. The exclusion is scoped to
      // *the wildcard result specifically* (domain starts with "*.") so a
      // non-wildcard cert that happens to share error wording still reaches
      // the digest, and so a wildcard failure for any other reason still
      // reaches the digest too.
      const notifiableFailures = results.filter(
        (r) =>
          r.status === 'failed' &&
          !(r.domain.startsWith('*.') && r.error?.includes('DNS API integration')),
      );
      if (notifiableFailures.length > 0) {
        await this.sendFailureNotifications(notifiableFailures);
      }
    } catch (error) {
      this.logger.error('Renewal check failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check and renew wildcard certificate if needed
   */
  private async checkAndRenewWildcard(thresholdDays: number): Promise<RenewalResult | null> {
    // M1 (review finding): a paste/cloudflare/selfsigned install's
    // wildcard.<domain>.crt is just the pasted primary/origin cert copied
    // onto the render-contract filename (see
    // SslCertificateService.savePrimaryCertificate) — even when that copy
    // genuinely carries a *.<domain> SAN (e.g. a Cloudflare Origin CA cert),
    // it was never DNS-01 issued here and can't auto-renew via this path.
    // checkAndRemindPrimaryPaste already reminds the admin to re-paste, so
    // without this gate a Cloudflare/paste install could get BOTH reminders —
    // the second with DNS-01 TXT-record instructions that make no sense for
    // a pasted origin cert. Only skip when instance.json is present AND
    // explicitly non-LE; a legacy env-only install (no instance.json) still
    // goes through this path unchanged.
    const instanceCfg = loadInstanceConfig();
    if (instanceCfg?.state === 'applied' && instanceCfg.sslMode !== 'letsencrypt') {
      return null;
    }

    // Check if wildcard auto-renew is enabled
    const wildcardAutoRenew = await this.getSetting('wildcard_auto_renew');
    if (wildcardAutoRenew === 'false') {
      return null;
    }

    const wildcardInfo = await this.sslInfoService.getWildcardCertInfo();
    if (!wildcardInfo) {
      // No wildcard cert exists
      return null;
    }

    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    if (wildcardInfo.daysUntilExpiry > thresholdDays) {
      // Not expiring soon
      return {
        domain: `*.${baseDomain}`,
        status: 'skipped',
      };
    }

    this.logger.log(`Wildcard cert expires in ${wildcardInfo.daysUntilExpiry} days, renewing...`);

    try {
      const result = await this.sslCertificateService.renewWildcardCertificate();

      if (!result.success && result.error?.includes('DNS API integration')) {
        await this.sendWildcardExpiryReminder(wildcardInfo.daysUntilExpiry);
      }

      await this.logRenewal({
        certificateType: 'wildcard',
        domain: `*.${baseDomain}`,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.error,
        previousExpiresAt: wildcardInfo.expiresAt,
        newExpiresAt: result.expiresAt,
        triggeredBy: 'auto',
      });

      return {
        domain: `*.${baseDomain}`,
        status: result.success ? 'success' : 'failed',
        error: result.error,
        newExpiresAt: result.expiresAt,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await this.logRenewal({
        certificateType: 'wildcard',
        domain: `*.${baseDomain}`,
        status: 'failed',
        errorMessage: errorMsg,
        previousExpiresAt: wildcardInfo.expiresAt,
        triggeredBy: 'auto',
      });

      return {
        domain: `*.${baseDomain}`,
        status: 'failed',
        error: errorMsg,
      };
    }
  }

  /**
   * Renews the primary cert issued by the bootstrap wizard's LE path. Only
   * active when instance.json says sslMode=letsencrypt — paste installs renew
   * by re-pasting, and env-only legacy installs have no instance.json at all.
   * The cert write lands in ssl/, which the nginx watcher observes → automatic
   * re-render + reload; this service never touches nginx for the primary cert.
   */
  private async checkAndRenewPrimary(thresholdDays: number): Promise<RenewalResult | null> {
    const cfg = loadInstanceConfig();
    if (cfg?.state !== 'applied' || cfg.sslMode !== 'letsencrypt' || !cfg.primaryDomain) return null;
    const daysLeft = this.sslCertificateService.getPrimaryCertificateExpiryDays();
    if (daysLeft === null || daysLeft > thresholdDays) {
      return { domain: cfg.primaryDomain, status: 'skipped' };
    }
    this.logger.log(`Primary LE cert expires in ${daysLeft} days, renewing…`);
    // Env-adopted installs (legacy certbot certs) may carry SANs the wizard
    // set doesn't (minio.<domain>) — renew with them preserved (spec §4).
    const currentSans =
      cfg.origin === 'env'
        ? (this.sslCertificateService.getPrimaryCertificateSans() ?? undefined)
        : undefined;
    // target stays defaulted to 'live' — the renewal cron writes the live cert.
    const result = await this.sslCertificateService.requestPrimaryDomainCertificate(
      cfg.primaryDomain,
      currentSans ? { extraSans: currentSans } : {},
    );
    await this.logRenewal({
      certificateType: 'individual',
      domain: cfg.primaryDomain,
      status: result.success ? 'success' : 'failed',
      errorMessage: result.error,
      newExpiresAt: result.expiresAt,
      triggeredBy: 'auto',
    });
    return {
      domain: cfg.primaryDomain,
      status: result.success ? 'success' : 'failed',
      error: result.error,
      newExpiresAt: result.expiresAt,
    };
  }

  /**
   * A pasted primary cert (Cloudflare Origin, another CDN's origin cert, or a
   * BYO cert on a direct box) can't auto-renew — the box has nothing to
   * re-fetch. Send a throttled reminder so it doesn't expire silently.
   * Explicitly skips 'letsencrypt' (auto-renews via checkAndRenewPrimary) and
   * 'selfsigned' (behind a verify-off proxy; its expiry is irrelevant).
   */
  private async checkAndRemindPrimaryPaste(thresholdDays: number): Promise<void> {
    const cfg = loadInstanceConfig();
    if (cfg?.state !== 'applied' || cfg.sslMode !== 'paste' || !cfg.primaryDomain) return;
    const daysLeft = this.sslCertificateService.getPrimaryCertificateExpiryDays();
    if (daysLeft === null || daysLeft > thresholdDays) return;

    const last = await this.getSetting('primary_cert_reminder_last_sent');
    if (last && Date.now() - new Date(last).getTime() < 7 * 86_400_000) return;
    const to = await this.getReminderRecipient();
    if (!to) {
      this.logger.warn('Primary cert expiring but no reminder recipient (no notification_email, no admin user)');
      return;
    }
    const domain = cfg.primaryDomain;
    const result = await this.emailService.sendEmail({
      to,
      subject: `Action needed: the certificate for ${domain} expires in ${daysLeft} days`,
      html:
        `<p>The certificate for <strong>${domain}</strong> expires in <strong>${daysLeft} days</strong> ` +
        `and cannot renew automatically (it was pasted in, not issued here).</p>` +
        `<p>Re-paste or re-issue it under <strong>Admin → Settings → SSL</strong> on ` +
        `<a href="https://admin.${domain}">admin.${domain}</a> before then. If your server is reachable ` +
        `for Let's Encrypt, switching to an auto-renewing certificate there avoids this in future.</p>`,
    });
    if (result.success) {
      await this.updateSetting('primary_cert_reminder_last_sent', new Date().toISOString());
    } else {
      this.logger.error(`Failed to send primary cert expiry reminder for ${domain}: ${result.error}`);
    }
  }

  /**
   * Check and renew individual domain certificates
   */
  private async checkAndRenewDomains(thresholdDays: number): Promise<RenewalResult[]> {
    const results: RenewalResult[] = [];

    // Get all custom domains with SSL enabled and auto-renew on
    const domains = await db
      .select()
      .from(domainMappings)
      .where(
        and(
          eq(domainMappings.domainType, 'custom'),
          eq(domainMappings.sslEnabled, true),
          eq(domainMappings.autoRenewSsl, true),
          eq(domainMappings.isActive, true),
        ),
      );

    for (const domain of domains) {
      const certInfo = await this.sslInfoService.getDomainSslInfo(domain.domain, 'custom');

      if (!certInfo) {
        results.push({
          domain: domain.domain,
          status: 'skipped',
          error: 'Certificate not found',
        });
        continue;
      }

      if (certInfo.daysUntilExpiry > thresholdDays) {
        results.push({
          domain: domain.domain,
          status: 'skipped',
        });
        continue;
      }

      this.logger.log(`${domain.domain} expires in ${certInfo.daysUntilExpiry} days, renewing...`);

      try {
        const result = await this.sslCertificateService.requestCustomDomainCertificate(
          domain.domain,
        );

        // Update domain record
        await db
          .update(domainMappings)
          .set({
            sslRenewedAt: new Date(),
            sslRenewalStatus: result.success ? 'success' : 'failed',
            sslRenewalError: result.error || null,
            sslExpiresAt: result.expiresAt || null,
            updatedAt: new Date(),
          })
          .where(eq(domainMappings.id, domain.id));

        // Regenerate nginx config if renewal succeeded
        if (result.success) {
          try {
            let config: string;

            // Handle redirect domains separately
            if (domain.domainType === 'redirect') {
              config = await this.nginxConfigService.generateRedirectDomainConfig({
                id: domain.id,
                domain: domain.domain,
                redirectTarget: domain.redirectTarget!,
                redirectType: domain.redirectType,
                sslEnabled: domain.sslEnabled,
              });
            } else if (domain.projectId) {
              const project = await this.projectsService.getProjectById(domain.projectId);
              config = await this.nginxConfigService.generateConfig(domain, project);
            } else {
              this.logger.warn(`Skipping nginx config for ${domain.domain} - no projectId`);
              continue;
            }

            const { tempPath, finalPath } = await this.nginxConfigService.writeConfigFile(
              domain.id,
              config,
            );
            await this.nginxReloadService.validateAndReload(tempPath, finalPath);
          } catch (nginxError) {
            this.logger.warn(
              `Failed to regenerate nginx config for ${domain.domain}: ${nginxError}`,
            );
          }
        }

        await this.logRenewal({
          domainId: domain.id,
          certificateType: 'individual',
          domain: domain.domain,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error,
          previousExpiresAt: certInfo.expiresAt,
          newExpiresAt: result.expiresAt,
          triggeredBy: 'auto',
        });

        results.push({
          domain: domain.domain,
          status: result.success ? 'success' : 'failed',
          error: result.error,
          newExpiresAt: result.expiresAt,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        await db
          .update(domainMappings)
          .set({
            sslRenewalStatus: 'failed',
            sslRenewalError: errorMsg,
            updatedAt: new Date(),
          })
          .where(eq(domainMappings.id, domain.id));

        await this.logRenewal({
          domainId: domain.id,
          certificateType: 'individual',
          domain: domain.domain,
          status: 'failed',
          errorMessage: errorMsg,
          previousExpiresAt: certInfo.expiresAt,
          triggeredBy: 'auto',
        });

        results.push({
          domain: domain.domain,
          status: 'failed',
          error: errorMsg,
        });
      }
    }

    return results;
  }

  /**
   * Log renewal attempt to history
   */
  private async logRenewal(record: {
    domainId?: string;
    certificateType: 'wildcard' | 'individual';
    domain: string;
    status: 'success' | 'failed' | 'skipped';
    errorMessage?: string;
    previousExpiresAt?: Date;
    newExpiresAt?: Date;
    triggeredBy: 'auto' | 'manual';
  }): Promise<void> {
    await db.insert(sslRenewalHistory).values(record);
  }

  /**
   * Get renewal threshold from settings
   */
  private async getRenewalThreshold(): Promise<number> {
    const setting = await this.getSetting('renewal_threshold_days');
    return setting ? parseInt(setting, 10) : 30;
  }

  /**
   * Get setting value
   */
  private async getSetting(key: string): Promise<string | null> {
    const [setting] = await db.select().from(sslSettings).where(eq(sslSettings.key, key)).limit(1);

    return setting?.value || null;
  }

  /**
   * Sends an at-most-once-per-7-days reminder email when the wildcard cert is
   * within the renewal threshold but can't auto-renew (no DNS API integration
   * configured, so the DNS-01 challenge needs a human).
   */
  private async sendWildcardExpiryReminder(daysUntilExpiry: number): Promise<void> {
    const last = await this.getSetting('wildcard_reminder_last_sent');
    if (last && Date.now() - new Date(last).getTime() < 7 * 86_400_000) return;
    const to = await this.getReminderRecipient();
    if (!to) {
      this.logger.warn('Wildcard cert expiring but no reminder recipient (no notification_email, no admin user)');
      return;
    }
    const baseDomain = process.env.PRIMARY_DOMAIN || '';
    const result = await this.emailService.sendEmail({
      to,
      subject: `Action needed: wildcard certificate for *.${baseDomain} expires in ${daysUntilExpiry} days`,
      html:
        `<p>The wildcard certificate for <strong>*.${baseDomain}</strong> expires in ` +
        `<strong>${daysUntilExpiry} days</strong> and cannot renew automatically ` +
        `(DNS-01 wildcards need manual TXT records).</p>` +
        `<p>Renew it under <strong>Admin → Settings → SSL</strong> on ` +
        `<a href="https://admin.${baseDomain}">admin.${baseDomain}</a> — re-running the wildcard ` +
        `step gives you fresh TXT records to add and verify.</p>` +
        `<p>Until renewed, preview subdomains will show certificate warnings after expiry.</p>`,
    });
    if (result.success) {
      await this.updateSetting('wildcard_reminder_last_sent', new Date().toISOString());
    } else {
      this.logger.error(
        `Failed to send wildcard expiry reminder for *.${baseDomain}: ${result.error}`,
      );
    }
  }

  /**
   * Recipient resolution shared by the wildcard reminder and failure
   * notifications: an explicit notification_email setting wins, else the
   * first admin user, else null (log-only, no email sent).
   */
  private async getReminderRecipient(): Promise<string | null> {
    const configured = await this.getSetting('notification_email');
    if (configured) return configured;
    const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    return admin?.email ?? null;
  }

  private async updateSetting(key: string, value: string): Promise<void> {
    await db
      .insert(sslSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: sslSettings.key, set: { value, updatedAt: new Date() } });
  }

  /**
   * Send failure notifications
   */
  private async sendFailureNotifications(failures: RenewalResult[]): Promise<void> {
    const to = await this.getReminderRecipient();
    if (!to) {
      this.logger.warn('No notification recipient configured for renewal failures');
      this.logger.error(
        `SSL renewal failures (${failures.length}): ${failures.map((f) => `${f.domain}: ${f.error}`).join(', ')}`,
      );
      return;
    }

    const result = await this.emailService.sendEmail({
      to,
      subject: 'SSL renewal failures',
      html:
        `<p>The following SSL certificate renewals failed:</p><ul>` +
        failures.map((f) => `<li>${f.domain}: ${f.error || 'Unknown error'}</li>`).join('') +
        `</ul>`,
      text: failures.map((f) => `${f.domain}: ${f.error || 'Unknown error'}`).join('\n'),
    });

    if (!result.success) {
      this.logger.error(`Failed to send SSL renewal failure notification email: ${result.error}`);
    }
  }

  /**
   * Get renewal history for a domain
   */
  async getRenewalHistory(domainId: string, limit = 10): Promise<SslRenewalHistoryRecord[]> {
    return db
      .select()
      .from(sslRenewalHistory)
      .where(eq(sslRenewalHistory.domainId, domainId))
      .orderBy(desc(sslRenewalHistory.createdAt))
      .limit(limit);
  }

  /**
   * Get all renewal history (for admin)
   */
  async getAllRenewalHistory(limit = 50): Promise<SslRenewalHistoryRecord[]> {
    return db
      .select()
      .from(sslRenewalHistory)
      .orderBy(desc(sslRenewalHistory.createdAt))
      .limit(limit);
  }

  /**
   * Update global SSL settings
   */
  async updateSettings(settings: {
    renewalThresholdDays?: number;
    notificationEmail?: string;
    wildcardAutoRenew?: boolean;
  }): Promise<void> {
    const updates: { key: string; value: string }[] = [];

    if (settings.renewalThresholdDays !== undefined) {
      updates.push({
        key: 'renewal_threshold_days',
        value: settings.renewalThresholdDays.toString(),
      });
    }
    if (settings.notificationEmail !== undefined) {
      updates.push({ key: 'notification_email', value: settings.notificationEmail });
    }
    if (settings.wildcardAutoRenew !== undefined) {
      updates.push({ key: 'wildcard_auto_renew', value: settings.wildcardAutoRenew.toString() });
    }

    for (const update of updates) {
      await db
        .insert(sslSettings)
        .values({ ...update, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: sslSettings.key,
          set: { value: update.value, updatedAt: new Date() },
        });
    }
  }

  /**
   * Get current SSL settings
   */
  async getSettings(): Promise<{
    renewalThresholdDays: number;
    notificationEmail: string | null;
    wildcardAutoRenew: boolean;
  }> {
    const allSettings = await db.select().from(sslSettings);

    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

    return {
      renewalThresholdDays: parseInt(settingsMap.get('renewal_threshold_days') || '30', 10),
      notificationEmail: settingsMap.get('notification_email') || null,
      wildcardAutoRenew: settingsMap.get('wildcard_auto_renew') !== 'false',
    };
  }

  /**
   * Manually trigger renewal check (for testing)
   */
  async triggerRenewalCheck(): Promise<void> {
    await this.checkAndRenewCertificates();
  }
}
