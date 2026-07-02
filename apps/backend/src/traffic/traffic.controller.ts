import { Controller, MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Observable, interval, map, merge } from 'rxjs';
// Import from the concrete files (not the ../auth barrel): the barrel pulls in
// auth.module -> settings.module, a cycle that leaves Roles undefined when this
// controller is loaded first (e.g. in unit tests).
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TrafficEventsService } from './traffic-events.service';

/** Keep-alive cadence so idle SSE connections survive proxy read timeouts. */
const HEARTBEAT_MS = 30_000;

@ApiTags('Traffic')
@Controller('api/traffic')
@UseGuards(ApiKeyGuard, RolesGuard)
export class TrafficController {
  constructor(private readonly trafficEvents: TrafficEventsService) {}

  @Sse('stream')
  @Roles('admin')
  @SkipThrottle()
  @ApiOperation({ summary: 'Live tail of app-observed requests (SSE, admin only)' })
  stream(@Req() req: Request): Observable<MessageEvent> {
    // nginx must not buffer the event stream
    req.res?.setHeader('X-Accel-Buffering', 'no');
    req.res?.setHeader('Cache-Control', 'no-cache, no-transform');

    const events$ = this.trafficEvents
      .stream()
      .pipe(map((event): MessageEvent => ({ type: 'request', data: event })));

    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: '' })),
    );

    return merge(events$, heartbeat$);
  }
}
