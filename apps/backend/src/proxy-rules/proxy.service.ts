import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProxyRule, ProxyHeaderConfig } from '../db/schema/proxy-rules.schema';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  /**
   * Forward a request to the proxy target
   */
  async forward(req: Request, res: Response, rule: ProxyRule, subpath: string): Promise<void> {
    const targetUrl = this.buildTargetUrl(rule, subpath);

    // Preserve query string from original request
    const originalUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    targetUrl.search = originalUrl.search;

    const headers = this.buildHeaders(req, rule);
    const body = this.getRequestBody(req);

    // Debug logging for proxy requests
    this.logger.debug(
      `Proxying: ${req.method} ${subpath} → ${targetUrl.toString()} ` +
        `(body: ${body === null ? 'null' : typeof body === 'string' ? `${body.length} chars` : 'buffer'}, ` +
        `cookies: ${rule.forwardCookies ? 'yes' : 'no'}, timeout: ${rule.timeout}ms)`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), rule.timeout);

    try {
      const response = await fetch(targetUrl.toString(), {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
        // @ts-expect-error - duplex needed for streaming in Node.js fetch
        duplex: 'half',
      });

      clearTimeout(timeoutId);
      this.logger.debug(`Proxy response: ${response.status} from ${targetUrl.toString()}`);
      res.status(response.status);
      this.forwardResponseHeaders(response, res);

      if (response.body) {
        const reader = response.body.getReader();
        await this.streamResponse(reader, res);
      } else {
        res.end();
      }
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      const err = error as Error;

      if (err.name === 'AbortError') {
        this.logger.warn(`Proxy timeout: ${targetUrl.toString()}`);
        if (!res.headersSent) {
          res.status(504).json({ error: 'Gateway Timeout' });
        }
      } else {
        this.logger.error(`Proxy error: ${err.message}`);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Bad Gateway' });
        }
      }
    }
  }

  /**
   * Build the target URL for the proxied request.
   * Handles stripPrefix correctly by preserving targetUrl.pathname.
   *
   * This matches nginx behavior:
   * - If targetUrl = http://controlplane:3000/api and pathPattern = /api/platform/*
   * - Request /api/platform/organizations → /api/organizations (not /organizations)
   */
  private buildTargetUrl(rule: ProxyRule, subpath: string): URL {
    const baseUrl = new URL(rule.targetUrl);

    if (!rule.stripPrefix) {
      // No stripping - just append subpath to target URL
      const targetPath = this.joinPaths(baseUrl.pathname, subpath);
      return new URL(targetPath, baseUrl.origin);
    }

    // Strip the matched prefix from the request path
    const strippedPath = this.stripMatchedPrefix(rule.pathPattern, subpath);

    // Combine with target URL's pathname (mimicking nginx behavior)
    // nginx: rewrite ^/api/platform/(.*)$ /api/$1 break;
    // So /api/platform/organizations with targetUrl http://host/api → /api/organizations
    const targetPath = this.joinPaths(baseUrl.pathname, strippedPath);
    return new URL(targetPath, baseUrl.origin);
  }

  /**
   * Join two path segments, handling slashes correctly
   */
  private joinPaths(basePath: string, appendPath: string): string {
    // If nothing to append (e.g., exact match stripped the entire path), return base path
    if (appendPath === '') {
      return basePath;
    }

    // Normalize: remove trailing slash from base, ensure leading slash on append
    const normalizedBase = basePath.replace(/\/+$/, '');
    const normalizedAppend = appendPath.startsWith('/') ? appendPath : '/' + appendPath;

    // If base is empty or just '/', return the append path
    if (!normalizedBase || normalizedBase === '') {
      return normalizedAppend;
    }

    return normalizedBase + normalizedAppend;
  }

  /**
   * Strip the matched prefix from the path based on the pattern.
   * Returns the remaining path (e.g., /organizations from /api/platform/organizations)
   */
  private stripMatchedPrefix(pattern: string, path: string): string {
    // Handle wildcard patterns: /api/*
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (path.startsWith(prefix + '/')) {
        return path.substring(prefix.length) || '/';
      }
      if (path === prefix) {
        return '/';
      }
    }

    // Handle exact matches: /env.json matches /env.json exactly
    // Strip the entire path so target URL is used directly
    if (path === pattern) {
      return '';
    }

    return path;
  }

  /**
   * Build headers for the proxied request
   */
  private buildHeaders(req: Request, rule: ProxyRule): Record<string, string> {
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
      const cookieValue = this.extractCookieValue(req, rule.authTransform.cookieName);
      if (cookieValue) {
        headers['authorization'] = `Bearer ${cookieValue}`;
        this.logger.debug(
          `Applied cookie-to-bearer: ${rule.authTransform.cookieName} -> Authorization header`,
        );
      } else {
        this.logger.debug(
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

    // Add forwarding headers
    headers['x-forwarded-for'] = req.ip || req.socket?.remoteAddress || '';
    headers['x-forwarded-proto'] = req.protocol;
    headers['x-forwarded-host'] = req.hostname;

    return headers;
  }

  /**
   * Extract a cookie value from the request
   */
  private extractCookieValue(req: Request, cookieName: string): string | null {
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

  /**
   * Get the request body for proxying
   * Returns null for methods that shouldn't have a body
   */
  private getRequestBody(req: Request): BodyInit | null {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return null;
    }

    // Express with body-parser stores the parsed body in req.body
    // For raw body access, we need to handle different scenarios
    if (Buffer.isBuffer(req.body)) {
      // Convert Buffer to Uint8Array for fetch compatibility
      return new Uint8Array(req.body);
    }

    // If body is an object (parsed JSON), re-serialize it
    if (req.body && typeof req.body === 'object') {
      return JSON.stringify(req.body);
    }

    // If body is a string, return it directly
    if (typeof req.body === 'string') {
      return req.body;
    }

    return null;
  }

  /**
   * Forward response headers from the proxied response
   */
  private forwardResponseHeaders(response: globalThis.Response, res: Response): void {
    // Headers to skip (hop-by-hop headers that shouldn't be forwarded)
    // Also skip content-encoding because Node.js fetch automatically decompresses
    // the response body, so we'd be sending decompressed content with a
    // compression header, causing ERR_CONTENT_DECODING_FAILED in browsers
    const skipHeaders = new Set([
      'transfer-encoding',
      'content-encoding', // Skip because fetch auto-decompresses
      'content-length', // Skip because length changes after decompression
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'upgrade',
    ]);

    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
  }

  /**
   * Stream the response body to the client
   */
  private async streamResponse(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    res: Response,
  ): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        // Check if the response is still writable
        if (!res.writableEnded) {
          res.write(value);
        } else {
          // Client disconnected, cancel the reader
          await reader.cancel();
          return;
        }
      }
    } catch (error) {
      // Handle streaming errors gracefully
      this.logger.error(`Streaming error: ${(error as Error).message}`);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
