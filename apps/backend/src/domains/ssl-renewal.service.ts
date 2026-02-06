import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client';
import {
  domainMappings,
  sslRenewalHistory,
  sslSettings,
  SslRenewalHistoryRecord,
} from '../db/schema';
import { SslCertificateService } from './ssl-certificate.service';
import { SslInfoService } from './ssl-info.service';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';

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

      // 4. Send notifications for failures
      if (failed > 0) {
        await this.sendFailureNotifications(results.filter((r) => r.status === 'failed'));
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
   * Send failure notifications
   */
  private async sendFailureNotifications(failures: RenewalResult[]): Promise<void> {
    const notificationEmail = await this.getSetting('notification_email');

    if (!notificationEmail) {
      this.logger.warn('No notification email configured for renewal failures');
      return;
    }

    // TODO: Implement email notification
    // For now, just log
    this.logger.error(
      `SSL renewal failures (${failures.length}): ${failures.map((f) => `${f.domain}: ${f.error}`).join(', ')}`,
    );
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
