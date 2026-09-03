import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { ProxyRule } from '../db/schema/proxy-rules.schema';
import { buildProxyHeaders, extractCookieValue } from './proxy-headers.util';

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
   * Build headers for the proxied request (shared with the in-process invoker).
   */
  private buildHeaders(req: Request, rule: ProxyRule): Record<string, string> {
    return buildProxyHeaders(req, rule, this.logger);
  }

  /**
   * Extract a cookie value from the request
   */
  private extractCookieValue(req: Request, cookieName: string): string | null {
    return extractCookieValue(req, cookieName);
  }

  /**
   * Get the request body for proxying
   * Returns null for methods that shouldn't have a body
   */
  private getRequestBody(req: Request): BodyInit | null {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return null;
    }

    // Multipart: NestJS body-parser doesn't handle multipart/form-data, so the
    // raw stream is still readable. Stream it directly to fetch so file bytes
    // (and the multipart boundary) survive the proxy hop. Without this, req.body
    // is {} and we'd forward "{}" with the original multipart Content-Type
    // header, which fails downstream with "Unexpected end of form".
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.startsWith('multipart/')) {
      return Readable.toWeb(req) as unknown as BodyInit;
    }

    // Prefer the raw bytes captured by NestJS rawBody:true when available, so
    // forwarded JSON/text bodies are byte-identical to what the client sent.
    const reqWithRaw = req as Request & { rawBody?: Buffer };
    if (reqWithRaw.rawBody && reqWithRaw.rawBody.length > 0) {
      return new Uint8Array(reqWithRaw.rawBody);
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

    // Handle Set-Cookie separately — Headers.forEach() combines multiple
    // Set-Cookie values with ", " per the Fetch spec, which breaks cookie parsing.
    // Use getSetCookie() to get each Set-Cookie header individually.
    const setCookies = response.headers.getSetCookie?.();
    if (setCookies && setCookies.length > 0) {
      res.setHeader('set-cookie', setCookies);
    }

    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase()) && key.toLowerCase() !== 'set-cookie') {
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
