import { Controller, Get, MessageEvent, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Observable, interval, map, merge } from 'rxjs';
// Import from the concrete files (not the ../auth barrel): the barrel pulls in
// auth.module -> settings.module, a cycle that leaves Roles undefined when this
// controller is loaded first (e.g. in unit tests).
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TrafficEventsService } from './traffic-events.service';
import { RequestLogService } from './request-log.service';
import {
  ExportTrafficIpRollupsQueryDto,
  ExportTrafficRequestsQueryDto,
  ListTrafficIpRollupsQueryDto,
  ListTrafficRequestsQueryDto,
} from './traffic.dto';

/** Keep-alive cadence so idle SSE connections survive proxy read timeouts. */
const HEARTBEAT_MS = 30_000;

@ApiTags('Traffic')
@Controller('api/traffic')
@UseGuards(ApiKeyGuard, RolesGuard)
export class TrafficController {
  constructor(
    private readonly trafficEvents: TrafficEventsService,
    private readonly requestLog: RequestLogService,
  ) {}

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

  @Get('requests')
  @Roles('admin')
  @ApiOperation({ summary: 'Persisted Request log (Unmatched/blocked), filterable (admin only)' })
  async listRequests(@Query() query: ListTrafficRequestsQueryDto) {
    const { page = 1, pageSize = 50, ...filters } = query;
    return this.requestLog.listRequests(filters, page, pageSize);
  }

  @Get('requests/export')
  @Roles('admin')
  @ApiOperation({ summary: 'Export the persisted Request log as CSV or JSON (admin only)' })
  async exportRequests(
    @Query() query: ExportTrafficRequestsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { format = 'csv', limit = 10_000, ...filters } = query;
    const body = await this.requestLog.exportRequests(filters, format, limit);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="request-log.${format}"`);
    res.send(body);
  }

  @Get('ips')
  @Roles('admin')
  @ApiOperation({ summary: 'Per-IP rollup of persisted requests (admin only)' })
  async listIpRollups(@Query() query: ListTrafficIpRollupsQueryDto) {
    const {
      page = 1,
      pageSize = 50,
      sortBy = 'requestCount',
      sortOrder = 'desc',
      ...filters
    } = query;
    return this.requestLog.listIpRollups(filters, sortBy, sortOrder, page, pageSize);
  }

  @Get('ips/export')
  @Roles('admin')
  @ApiOperation({ summary: 'Export the per-IP rollup as CSV or JSON (admin only)' })
  async exportIpRollups(
    @Query() query: ExportTrafficIpRollupsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { format = 'csv', limit = 10_000, ...filters } = query;
    const body = await this.requestLog.exportIpRollups(filters, format, limit);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ip-rollup.${format}"`);
    res.send(body);
  }
}
