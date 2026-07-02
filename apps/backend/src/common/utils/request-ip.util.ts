import { Request } from 'express';

/**
 * Extract the real client IP address from a request.
 * Prefers X-Forwarded-For (set by nginx/Traefik in every CE topology; the app
 * does not set Express `trust proxy`, so req.ip is the proxy's socket peer).
 * Strips the IPv6-mapped IPv4 prefix (::ffff:) for cleaner output.
 */
export function extractClientIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  let ip: string | undefined;

  if (forwardedFor) {
    // X-Forwarded-For can be a comma-separated list; first IP is the original client
    const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
    ip = forwardedIp?.trim();
  }

  if (!ip) {
    ip = req.ip || req.socket?.remoteAddress;
  }

  if (ip?.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  return ip;
}
