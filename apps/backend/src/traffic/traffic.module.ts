import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TrafficController } from './traffic.controller';
import { TrafficEventsService } from './traffic-events.service';
import { RequestLogService } from './request-log.service';
import { TrafficRetentionScheduler } from './traffic-retention.scheduler';

/**
 * Bot protection & request observability (issue #383).
 *
 * Slice #389 provided the observation seam: the traffic observer middleware
 * (installed in main.ts) publishes every app-observed request to
 * TrafficEventsService, and TrafficController exposes an admin-only SSE live
 * tail. Slice #390 adds the Request log: RequestLogService persists the
 * Unmatched (and, with #391, blocked) subset with bounded retention and a
 * per-IP rollup, exposed through admin read/export endpoints.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [TrafficController],
  providers: [TrafficEventsService, RequestLogService, TrafficRetentionScheduler],
  exports: [TrafficEventsService],
})
export class TrafficModule {}
