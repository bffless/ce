import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PipelineSchedulesService } from './pipeline-schedules.service';

/**
 * Minute-resolution poller for pipeline schedules. Thin by design: it delegates
 * to {@link PipelineSchedulesService.runDueSchedules}, which is a plain method
 * unit tests can drive directly (no fake timers). A process-local guard skips a
 * tick if the previous one is still running; the durable double-fire protection
 * is the DB atomic claim inside runDueSchedules, not this flag.
 */
@Injectable()
export class PipelineSchedulesScheduler {
  private readonly logger = new Logger(PipelineSchedulesScheduler.name);
  private isRunning = false;

  constructor(private readonly schedulesService: PipelineSchedulesService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async pollDueSchedules(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const { due, ran } = await this.schedulesService.runDueSchedules();
      if (ran > 0) {
        this.logger.log(`Pipeline schedules: ${ran}/${due} due schedule(s) fired`);
      }
    } catch (error) {
      this.logger.error(`Pipeline schedule poll failed: ${String(error)}`);
    } finally {
      this.isRunning = false;
    }
  }
}
