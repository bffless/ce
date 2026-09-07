import { Request } from 'express';
import { isApiRequest, isBrowserNavigation } from './request-kind';

const requestWith = (headers: Record<string, string>): Request =>
  ({ headers }) as unknown as Request;

describe('request-kind', () => {
  describe('isApiRequest / isBrowserNavigation', () => {
    it('treats a request with no headers at all as an API client', () => {
      const req = requestWith({});
      expect(isApiRequest(req)).toBe(true);
      expect(isBrowserNavigation(req)).toBe(false);
    });

    it("treats the admin SPA's own fetch() profile (Accept: */*, Sec-Fetch-Mode: cors) as an API client", () => {
      // apps/frontend/src/services/api.ts sets no Accept header; the browser fills
      // in */* and marks the fetch as cors/same-origin, never navigate.
      const req = requestWith({ accept: '*/*', 'sec-fetch-mode': 'cors' });
      expect(isApiRequest(req)).toBe(true);
    });

    it('treats Accept: application/json as an API client', () => {
      expect(isApiRequest(requestWith({ accept: 'application/json' }))).toBe(true);
    });

    it('treats a JSON request body as an API client', () => {
      expect(isApiRequest(requestWith({ 'content-type': 'application/json' }))).toBe(true);
    });

    it('treats X-Requested-With: XMLHttpRequest as an API client', () => {
      expect(isApiRequest(requestWith({ 'x-requested-with': 'XMLHttpRequest' }))).toBe(true);
    });

    it('treats an X-API-Key header as an API client', () => {
      expect(isApiRequest(requestWith({ 'x-api-key': 'bff_abc' }))).toBe(true);
    });

    it("treats a browser's page-load Accept header (text/html,...) as a browser navigation", () => {
      const req = requestWith({
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
      expect(isBrowserNavigation(req)).toBe(true);
      expect(isApiRequest(req)).toBe(false);
    });

    it('treats Sec-Fetch-Mode: navigate as a browser navigation even with Accept: */*', () => {
      const req = requestWith({ accept: '*/*', 'sec-fetch-mode': 'navigate' });
      expect(isBrowserNavigation(req)).toBe(true);
    });

    it('lets explicit API signals win over navigation hints', () => {
      expect(
        isApiRequest(
          requestWith({
            accept: 'text/html',
            'sec-fetch-mode': 'navigate',
            'x-requested-with': 'XMLHttpRequest',
          }),
        ),
      ).toBe(true);
      expect(isApiRequest(requestWith({ accept: 'text/html', 'x-api-key': 'bff_abc' }))).toBe(true);
      expect(isApiRequest(requestWith({ accept: 'text/html, application/json' }))).toBe(true);
    });

    it('does not mistake other application/* Accept values for a navigation', () => {
      expect(isApiRequest(requestWith({ accept: 'application/xml' }))).toBe(true);
    });
  });
});
