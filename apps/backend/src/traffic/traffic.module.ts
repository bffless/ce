import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { TrafficController } from './traffic.controller';
import { BlocklistsController } from './blocklists.controller';
import { TrafficEventsService } from './traffic-events.service';
import { RequestLogService } from './request-log.service';
import { BlocklistService } from './blocklist.service';
import { TrafficRetentionScheduler } from './traffic-retention.scheduler';

/**
 * Bot protection & request observability (issue #383).
 *
 * Slice #389 provided the observation seam: the traffic observer middleware
 * (installed in main.ts) publishes every app-observed request to
 * TrafficEventsService, and TrafficController exposes an admin-only SSE live
 * tail. Slice #390 added the Request log: RequestLogService persists the
 * Unmatched and blocked subset with bounded retention and a per-IP rollup,
 * exposed through admin read/export endpoints. Slice #391 adds the Blocklist
 * library + Baseline: BlocklistService compiles them into the in-memory
 * matcher the observer middleware enforces (bare 403) app-side.
 */
@Module({
  imports: [ScheduleModule.forRoot(), FeatureFlagsModule],
  controllers: [TrafficController, BlocklistsController],
  providers: [TrafficEventsService, RequestLogService, BlocklistService, TrafficRetentionScheduler],
  exports: [TrafficEventsService, BlocklistService],
})
export class TrafficModule {}
