import { Request } from 'express';

/**
 * Classifies a request as a top-level browser navigation (can act on a 302)
 * or an API client (expects a JSON status, never a redirect).
 *
 * This is the one place that decides it. `SessionAuthGuard`,
 * `EmailVerificationGuard`, `AuthMiddleware` and `ProxyMiddleware` all branch
 * their failure response on it; they used to carry private copies that drifted
 * apart (issues #775, #778).
 *
 * Only a real navigation may get a redirect. The admin SPA's own fetch() calls
 * (`apps/frontend/src/services/api.ts`) send no Accept header at all - the
 * browser fills in `*\/*` - together with `Sec-Fetch-Mode: cors`/`same-origin`.
 * If those were redirected, fetch() would follow the 302 to the login or
 * verify-email page's HTML with a 200, and the frontend's real handling (which
 * keys on a 401 to silently refresh, or a 403 `EMAIL_NOT_VERIFIED` to route to
 * /verify-email) would never run. So the default is API, and "browser" requires
 * a positive signal: `Sec-Fetch-Mode: navigate` (set by browsers on navigation,
 * never by fetch/XHR) or an Accept header that asks for text/html.
 *
 * Explicit API signals win over navigation hints.
 */
export function isBrowserNavigation(request: Request): boolean {
  const acceptHeader = request.headers.accept || '';
  const contentType = request.headers['content-type'] || '';

  // XHR/fetch requests typically want JSON
  if (acceptHeader.includes('application/json')) {
    return false;
  }

  // Requests sending JSON are likely API calls
  if (contentType.includes('application/json')) {
    return false;
  }

  // X-Requested-With header indicates AJAX
  if (request.headers['x-requested-with'] === 'XMLHttpRequest') {
    return false;
  }

  // API key header indicates programmatic access
  if (request.headers['x-api-key']) {
    return false;
  }

  // Top-level browser navigation: can act on a redirect
  if (request.headers['sec-fetch-mode'] === 'navigate') {
    return true;
  }
  if (acceptHeader.includes('text/html')) {
    return true;
  }

  // Default: API client (fetch()/XHR with Accept: */*, curl, no Accept at all)
  return false;
}

/**
 * The complement of {@link isBrowserNavigation}: true for anything that should
 * be answered with a JSON status (401/403) rather than a redirect.
 */
export function isApiRequest(request: Request): boolean {
  return !isBrowserNavigation(request);
}
