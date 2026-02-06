/**
 * Validates a redirect URL to prevent open redirect attacks.
 * Only allows relative paths or URLs within the same base domain.
 *
 * Examples of allowed redirects:
 * - /dashboard (relative path)
 * - https://storybook.demo.workspace.sahp.app/path (same base domain)
 * - https://app.sahp.app/path (same base domain)
 *
 * Examples of rejected redirects:
 * - https://evil.com/path (different domain)
 * - //evil.com/path (protocol-relative to different domain)
 */
export function validateRedirectUrl(url: string | null): string {
  if (!url) return '/';

  // Allow relative paths
  if (url.startsWith('/') && !url.startsWith('//')) {
    return url;
  }

  try {
    const parsed = new URL(url);
    const currentHost = window.location.hostname;

    // Extract the base domain (last 2 parts)
    // e.g., "storybook.demo.workspace.sahp.app" -> "sahp.app"
    // e.g., "demo.workspace.sahp.app" -> "sahp.app"
    const getBaseDomain = (hostname: string): string => {
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        return parts.slice(-2).join('.');
      }
      return hostname;
    };

    const currentBaseDomain = getBaseDomain(currentHost);
    const redirectBaseDomain = getBaseDomain(parsed.hostname);

    // Allow if within the same base domain
    // This handles:
    // - Exact match: storybook.demo.workspace.sahp.app -> storybook.demo.workspace.sahp.app
    // - Subdomain match: storybook.demo.workspace.sahp.app -> demo.workspace.sahp.app
    // - Platform aliases: foo.sahp.app -> bar.sahp.app (both under sahp.app)
    if (
      parsed.hostname === currentHost ||
      parsed.hostname.endsWith('.' + currentBaseDomain) ||
      redirectBaseDomain === currentBaseDomain
    ) {
      return url;
    }

    // Reject URLs to different domains
    console.warn('Redirect URL rejected - not within platform domain:', url);
    return '/';
  } catch {
    // Invalid URL, reject it
    return '/';
  }
}
