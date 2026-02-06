import { getNavigationScript } from './iframe-navigation-script';

/**
 * Result of script injection attempt
 */
export interface InjectionResult {
  success: boolean;
  error?: string;
  reason?: 'cross-origin' | 'no-document' | 'already-injected' | 'unknown';
}

/**
 * Inject the navigation tracking script into an iframe
 *
 * @param iframe - The iframe element to inject into
 * @returns Result indicating success or failure
 */
export function injectNavigationScript(iframe: HTMLIFrameElement): InjectionResult {
  try {
    // Check if we can access the iframe's document
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    if (!doc || !win) {
      return {
        success: false,
        error: 'Cannot access iframe document',
        reason: 'no-document',
      };
    }

    // Check if already injected
    if ((win as Window & { __WSA_NAV_INITIALIZED__?: boolean }).__WSA_NAV_INITIALIZED__) {
      return {
        success: true,
        reason: 'already-injected',
      };
    }

    // Create and inject script element
    const script = doc.createElement('script');
    script.textContent = getNavigationScript();
    script.setAttribute('data-wsa-navigation', 'true');

    // Inject into head (or body if head not available)
    const target = doc.head || doc.body || doc.documentElement;
    if (!target) {
      return {
        success: false,
        error: 'No valid injection target found',
        reason: 'no-document',
      };
    }

    target.appendChild(script);

    return { success: true };
  } catch (error) {
    // Most likely a cross-origin error
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('cross-origin') || message.includes('SecurityError')) {
      return {
        success: false,
        error: 'Cross-origin iframe cannot be accessed',
        reason: 'cross-origin',
      };
    }

    return {
      success: false,
      error: message,
      reason: 'unknown',
    };
  }
}

/**
 * Check if an iframe is same-origin and accessible
 */
export function isIframeSameOrigin(iframe: HTMLIFrameElement): boolean {
  try {
    // Attempt to access the iframe's location
    // If this succeeds without throwing, we have same-origin access
    void iframe.contentWindow?.location.href;
    return true;
  } catch {
    return false;
  }
}

/**
 * Read iframe location directly (same-origin only)
 */
export function getIframeRoute(iframe: HTMLIFrameElement): string | null {
  try {
    const win = iframe.contentWindow;
    if (!win) return null;

    // Check for about:blank - this is the default state before iframe loads
    // about:blank has pathname "blank" which is not a valid route
    if (win.location.href === 'about:blank') {
      return null;
    }

    return win.location.pathname + win.location.search + win.location.hash;
  } catch {
    return null; // Cross-origin
  }
}
