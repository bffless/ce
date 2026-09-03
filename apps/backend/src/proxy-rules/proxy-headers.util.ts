import { Logger } from '@nestjs/common';
import { Request } from 'express';
import { ProxyRule, ProxyHeaderConfig } from '../db/schema/proxy-rules.schema';

/**
 * The headers an `external_proxy` rule sends to its target, built from the
 * caller's request under the rule's own controls — `forwardCookies` (cookie
 * off by default), `authorization` stripped by default, `headerConfig.forward` /
 * `strip` / `add`, and `authTransform: cookie-to-bearer`. One implementation for
 * every path that reaches such a rule: the edge (`ProxyService`) and the
 * in-process sibling call (`RuleInvokerService`). A new caller of a rule must
 * come through here rather than copy headers itself, or the rule's controls
 * silently stop applying to it.
 */
export function buildProxyHeaders(
  req: Request,
  rule: ProxyRule,
  logger?: Logger,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const config: ProxyHeaderConfig = rule.headerConfig || {};

  // Default safe headers to forward
  // NOTE: content-length is intentionally NOT forwarded because:
  // 1. The body may be re-serialized (changing its length)
  // 2. If body parsing failed, we send null body but original content-length
  // 3. This mismatch causes the receiving server to hang waiting for bytes
  // Let fetch() calculate the correct content-length from the actual body
  const defaultForwardHeaders = [
    'accept',
    'accept-language',
    'content-type',
    'user-agent',
    'x-request-id',
  ];

  // Add cookie to forward list if forwardCookies is enabled
  if (rule.forwardCookies) {
    defaultForwardHeaders.push('cookie');
  }

  const forwardHeaders = config.forward || defaultForwardHeaders;

  // Default headers to strip (hop-by-hop + sensitive)
  const defaultStripHeaders = [
    'host',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'authorization', // Strip by default for security
  ];

  // Only strip cookies if forwardCookies is false (default behavior)
  if (!rule.forwardCookies) {
    defaultStripHeaders.push('cookie');
  }

  const stripHeaders = config.strip || defaultStripHeaders;

  // Create a set for faster lookup
  const stripSet = new Set(stripHeaders.map((h) => h.toLowerCase()));
  const forwardSet = new Set(forwardHeaders.map((h) => h.toLowerCase()));

  // Copy allowed headers
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (forwardSet.has(lowerKey) && !stripSet.has(lowerKey) && typeof value === 'string') {
      headers[key] = value;
    }
  }

  // Add configured headers (already decrypted by ProxyRulesService)
  if (config.add) {
    Object.assign(headers, config.add);
  }

  // Apply authTransform (e.g., cookie-to-bearer token)
  // This matches nginx behavior for domain mappings
  if (rule.authTransform?.type === 'cookie-to-bearer') {
    const cookieValue = extractCookieValue(req, rule.authTransform.cookieName);
    if (cookieValue) {
      headers['authorization'] = `Bearer ${cookieValue}`;
      logger?.debug(
        `Applied cookie-to-bearer: ${rule.authTransform.cookieName} -> Authorization header`,
      );
    } else {
      logger?.debug(
        `Cookie "${rule.authTransform.cookieName}" not found for cookie-to-bearer transform`,
      );
    }
  }

  // Set host header based on preserveHost setting
  if (!rule.preserveHost) {
    try {
      headers['host'] = new URL(rule.targetUrl).host;
    } catch {
      // If URL parsing fails, don't set host header
    }
  }

  // Add forwarding headers — preserve the original client IP from the proxy chain
  const existingForwardedFor = req.headers['x-forwarded-for'];
  if (existingForwardedFor) {
    headers['x-forwarded-for'] = String(existingForwardedFor);
  } else {
    headers['x-forwarded-for'] = req.ip || req.socket?.remoteAddress || '';
  }
  headers['x-forwarded-proto'] = req.protocol;
  headers['x-forwarded-host'] = req.hostname;

  return headers;
}

/** A cookie's value from the parsed jar when present, else from the raw header. */
export function extractCookieValue(req: Request, cookieName: string): string | null {
  // First try parsed cookies (if cookie-parser middleware is used)
  if (req.cookies && req.cookies[cookieName]) {
    return req.cookies[cookieName];
  }

  // Fall back to parsing Cookie header manually
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').reduce(
    (acc, cookie) => {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name) {
        acc[name] = valueParts.join('='); // Handle values with '=' in them
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  return cookies[cookieName] || null;
}
