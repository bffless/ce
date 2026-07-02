import { Request, Response, NextFunction } from 'express';
import { extractClientIp } from '../common/utils/request-ip.util';
import { formatAccessLogLine } from './access-log.util';
import { TrafficEvent } from './traffic-event.interface';
import { TrafficEventsService } from './traffic-events.service';

/** The SSE live-tail endpoint itself must not feed the stream it serves. */
const OBSERVER_EXEMPT_PATHS = ['/api/traffic/stream'];

let eventCounter = 0;

/**
 * The application interceptor's observation seam (ADR-0003).
 *
 * Installed with `app.use()` in main.ts — ABOVE all Nest module middleware —
 * so it observes every request that reaches the app, including ones
 * short-circuited by ProxyMiddleware or answered by guards/filters, in every
 * topology (docker-compose and GKE). It never alters a response; it counts
 * response bytes and publishes a TrafficEvent when the response finishes.
 *
 * Classification: a 404 response means the request resolved to no deployment,
 * alias, or asset — an Unmatched request. Everything else is matched.
 */
export function createTrafficObserver(events: TrafficEventsService) {
  return function trafficObserver(req: Request, res: Response, next: NextFunction): void {
    if (OBSERVER_EXEMPT_PATHS.some((p) => req.path === p)) {
      return next();
    }

    let bytes = 0;
    const countChunk = (chunk: unknown, encoding?: unknown): void => {
      if (chunk) {
        bytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
      }
    };

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = function (chunk: any, ...args: any[]): boolean {
      countChunk(chunk, args[0]);
      return originalWrite(chunk, ...args);
    } as Response['write'];

    res.end = function (chunk?: any, ...args: any[]): Response {
      countChunk(chunk, args[0]);
      return originalEnd(chunk, ...args);
    } as Response['end'];

    res.on('finish', () => {
      const timestamp = new Date().toISOString();
      const withoutLine: Omit<TrafficEvent, 'line'> = {
        id: `${Date.now()}-${eventCounter++}`,
        timestamp,
        ip: extractClientIp(req) || '-',
        method: req.method,
        path: req.originalUrl,
        httpVersion: req.httpVersion,
        status: res.statusCode,
        bytes,
        referer: (req.headers.referer as string) || null,
        userAgent: (req.headers['user-agent'] as string) || null,
        host: (req.headers['x-forwarded-host'] as string) || req.headers.host || null,
        classification: res.statusCode === 404 ? 'unmatched' : 'matched',
      };
      events.emit({ ...withoutLine, line: formatAccessLogLine(withoutLine) });
    });

    next();
  };
}
