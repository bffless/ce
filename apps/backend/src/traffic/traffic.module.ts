import { Module } from '@nestjs/common';
import { TrafficController } from './traffic.controller';
import { TrafficEventsService } from './traffic-events.service';

/**
 * Bot protection & request observability (issue #383).
 *
 * This slice (#389) provides the observation seam: the traffic observer
 * middleware (installed in main.ts) publishes every app-observed request to
 * TrafficEventsService, and TrafficController exposes an admin-only SSE live
 * tail. Persistence and the Blocklist arrive in later slices.
 */
@Module({
  controllers: [TrafficController],
  providers: [TrafficEventsService],
  exports: [TrafficEventsService],
})
export class TrafficModule {}
