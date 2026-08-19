import { Request, Response, NextFunction } from 'express';
import { extractClientIp } from '../common/utils/request-ip.util';
import { formatAccessLogLine } from './access-log.util';
import { TrafficEvent } from './traffic-event.interface';
import { TrafficEventsService } from './traffic-events.service';

/** The SSE live-tail endpoint itself must not feed the stream it serves. */
const OBSERVER_EXEMPT_PATHS = ['/api/traffic/stream'];

/**
 * The app's own control surfaces are never Blocklist-enforced: an admin must
 * always be able to reach the API that turns bot protection off, and auth
 * must keep working. These are still observed. Content-domain traffic is
 * unaffected — nginx rewrites it to /public/... before it reaches the app.
 */
const ENFORCEMENT_EXEMPT_PREFIXES = ['/api/', '/auth/'];

/** What the middleware needs from BlocklistService (kept as an interface so
 *  the middleware stays constructible without Nest in tests). `host` selects
 *  the domain's effective set (#393); unknown hosts use the default set. */
export interface BlocklistEnforcer {
  shouldBlock(pathname: string, host?: string | null): boolean;
}

let eventCounter = 0;

/**
 * The client-visible path for enforcement. Content requests are rewritten by
 * nginx (e.g. /wp-login.php -> /public/{owner}/{repo}/alias/{alias}/wp-login.php)
 * with the original URI preserved in X-Original-URI — the Blocklist matches
 * what the client asked for, not the internal rewrite. Query strings are not
 * matched.
 */
function clientVisiblePath(req: Request): string {
  const header = req.headers['x-original-uri'];
  const raw = typeof header === 'string' && header.startsWith('/') ? header : req.originalUrl;
  const queryStart = raw.indexOf('?');
  return queryStart === -1 ? raw : raw.slice(0, queryStart);
}

/**
 * The application interceptor's observation + enforcement seam (ADR-0003).
 *
 * Installed with `app.use()` in main.ts — ABOVE all Nest module middleware —
 * so it observes every request that reaches the app, including ones
 * short-circuited by ProxyMiddleware or answered by guards/filters, in every
 * topology (docker-compose and GKE). It counts response bytes and publishes a
 * TrafficEvent when the response finishes.
 *
 * Since #391 it is also the app-side Blocklist authority: a blocklisted
 * request is refused with a bare 403 (empty body — the same no-detail
 * discipline as the generic 404) BEFORE next(), and its event is classified
 * 'blocked'. For everything else, classification derives from the response
 * status: 404 means the request resolved to no deployment, alias, or asset —
 * an Unmatched request.
 */
export function createTrafficObserver(events: TrafficEventsService, blocklist?: BlocklistEnforcer) {
  return function trafficObserver(req: Request, res: Response, next: NextFunction): void {
    if (OBSERVER_EXEMPT_PATHS.some((p) => req.path === p)) {
      return next();
    }

    const clientHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || null;
    const blocked =
      blocklist !== undefined &&
      !ENFORCEMENT_EXEMPT_PREFIXES.some(
        (prefix) => req.path.startsWith(prefix) || req.path === prefix.slice(0, -1),
      ) &&
      blocklist.shouldBlock(clientVisiblePath(req), clientHost);

    let bytes = 0;
    const countChunk = (chunk: unknown, encoding?: unknown): void => {
      if (chunk) {
        bytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(
              String(chunk),
              typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
            );
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
        host: clientHost,
        classification: blocked ? 'blocked' : res.statusCode === 404 ? 'unmatched' : 'matched',
      };
      events.emit({ ...withoutLine, line: formatAccessLogLine(withoutLine) });
    });

    if (blocked) {
      // Bare 403, empty body: a scanner learns nothing, and the app does not
      // attempt to replicate nginx's 444 socket-close.
      res.status(403).end();
      return;
    }

    next();
  };
}
