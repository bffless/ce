import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestLogService } from './request-log.service';

/**
 * Hourly enforcement of the Request log's retention bounds (age window + hard
 * row caps on both traffic_requests and traffic_ip_rollups). The row cap is
 * additionally re-checked inline by RequestLogService during insert bursts, so
 * this schedule mainly handles age-based expiry and quiet-period cleanup.
 */
@Injectable()
export class TrafficRetentionScheduler {
  private readonly logger = new Logger(TrafficRetentionScheduler.name);
  private isRunning = false;

  constructor(private readonly requestLog: RequestLogService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleRetention(): Promise<void> {
    if (!this.requestLog.enabled) {
      return;
    }
    if (this.isRunning) {
      this.logger.warn({ event: 'traffic_retention_skipped', reason: 'previous run still in progress' });
      return;
    }
    this.isRunning = true;
    try {
      const summary = await this.requestLog.prune();
      const total =
        summary.requestsDeletedByAge +
        summary.requestsDeletedOverCap +
        summary.rollupsDeletedByAge +
        summary.rollupsDeletedOverCap;
      if (total > 0) {
        this.logger.log({ event: 'traffic_retention_pruned', ...summary });
      }
    } catch (error) {
      this.logger.error({ event: 'traffic_retention_failed', error: String(error) });
    } finally {
      this.isRunning = false;
    }
  }
}
