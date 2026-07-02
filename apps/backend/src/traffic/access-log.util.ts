import { TrafficEvent } from './traffic-event.interface';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Format a date like nginx's $time_local: 02/Jul/2026:10:15:30 +0000
 * (always UTC — the server's local offset is noise for a hosted log view).
 */
export function formatNginxTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getUTCDate())}/${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}` +
    `:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

/**
 * Render an observed request in nginx's combined log format:
 * $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
 */
export function formatAccessLogLine(
  event: Omit<TrafficEvent, 'line'>,
): string {
  const time = formatNginxTime(new Date(event.timestamp));
  const request = `${event.method} ${event.path} HTTP/${event.httpVersion}`;
  return (
    `${event.ip} - - [${time}] "${request}" ${event.status} ${event.bytes} ` +
    `"${event.referer ?? '-'}" "${event.userAgent ?? '-'}"`
  );
}
