/**
 * A single request observed by the application interceptor (the traffic
 * observer middleware). This is the unit of the Traffic live stream and,
 * in later slices, the persisted Request log.
 */
export interface TrafficEvent {
  /** Monotonic id for client-side keying (not persisted) */
  id: string;
  /** ISO 8601 timestamp of when the response finished */
  timestamp: string;
  /** Client IP (X-Forwarded-For aware) */
  ip: string;
  /** HTTP method */
  method: string;
  /** Original request URL (path + query) */
  path: string;
  /** HTTP protocol version, e.g. "1.1" */
  httpVersion: string;
  /** Response status code */
  status: number;
  /** Response body bytes sent */
  bytes: number;
  /** Referer header, if any */
  referer: string | null;
  /** User-Agent header, if any */
  userAgent: string | null;
  /** Host the client requested (X-Forwarded-Host aware) */
  host: string | null;
  /**
   * matched: the request resolved to a real asset/API/deployment.
   * unmatched: it resolved to no deployment, alias, or asset (bot scans
   * for /.env, /wp-login, ... produce these).
   * blocked: refused by the Blocklist with a bare 403 (issue #391).
   */
  classification: 'matched' | 'unmatched' | 'blocked';
  /** The event rendered as an nginx combined-access-log line */
  line: string;
}
