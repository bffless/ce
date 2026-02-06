import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

@Injectable()
export class RetentionScheduler {
  private readonly logger = new Logger(RetentionScheduler.name);
  private isRunning = false;

  constructor(private readonly retentionService: RetentionService) {}

  /**
   * Run scheduled retention rules at 3 AM UTC daily
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runScheduledRetention(): Promise<void> {
    // Check environment variable to enable/disable scheduler
    if (process.env.RETENTION_ENABLED === 'false') {
      this.logger.debug('Retention scheduler is disabled via RETENTION_ENABLED=false');
      return;
    }

    // Prevent overlapping runs
    if (this.isRunning) {
      this.logger.warn('Retention job already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    this.logger.log('Starting scheduled retention run');

    try {
      // Find all rules due for execution
      const dueRules = await this.retentionService.findDueRules();

      if (dueRules.length === 0) {
        this.logger.log('No retention rules due for execution');
        return;
      }

      this.logger.log(`Found ${dueRules.length} retention rules due for execution`);

      let successCount = 0;
      let failCount = 0;
      let totalDeletedCommits = 0;
      let totalPartialCommits = 0;
      let totalDeletedAssets = 0;
      let totalFreed = 0;

      for (const rule of dueRules) {
        try {
          // Check for dry run mode
          if (process.env.RETENTION_DRY_RUN === 'true') {
            const preview = await this.retentionService.previewDeletion(
              rule.id,
              'system', // System user for scheduled runs
              'admin',
            );
            const partialCount = preview.commits.filter((c) => c.isPartial).length;
            const fullCount = preview.commits.length - partialCount;
            this.logger.log({
              event: 'retention_dry_run',
              ruleId: rule.id,
              ruleName: rule.name,
              projectId: rule.projectId,
              wouldDeleteFull: fullCount,
              wouldDeletePartial: partialCount,
              wouldFree: preview.totalBytes,
            });
            successCount++;
            continue;
          }

          // Execute the rule
          const result = await this.retentionService.executeRuleInternal(rule);

          successCount++;
          totalDeletedCommits += result.deletedCommits;
          totalPartialCommits += result.partialCommits;
          totalDeletedAssets += result.deletedAssets;
          totalFreed += result.freedBytes;

          if (result.errors && result.errors.length > 0) {
            this.logger.warn({
              event: 'retention_rule_partial_success',
              ruleId: rule.id,
              ruleName: rule.name,
              deletedCommits: result.deletedCommits,
              partialCommits: result.partialCommits,
              deletedAssets: result.deletedAssets,
              freedBytes: result.freedBytes,
              errorCount: result.errors.length,
            });
          }
        } catch (error) {
          failCount++;
          this.logger.error({
            event: 'retention_rule_execution_failed',
            ruleId: rule.id,
            ruleName: rule.name,
            projectId: rule.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log({
        event: 'retention_run_completed',
        rulesProcessed: dueRules.length,
        successCount,
        failCount,
        totalDeletedCommits,
        totalPartialCommits,
        totalDeletedAssets,
        totalFreedBytes: totalFreed,
        totalFreedMB: Math.round(totalFreed / (1024 * 1024)),
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error({
        event: 'retention_run_failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check if scheduler is currently running
   */
  isCurrentlyRunning(): boolean {
    return this.isRunning;
  }
}
