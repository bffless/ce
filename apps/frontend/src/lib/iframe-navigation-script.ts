/**
 * Navigation script injected into preview iframes.
 * This script intercepts navigation events and reports them to the parent.
 *
 * IMPORTANT: This script must be self-contained with no external dependencies.
 * It will be converted to a string and injected via script.textContent.
 */

export const IFRAME_NAVIGATION_SCRIPT = `
(function() {
  // Prevent double initialization
  if (window.__WSA_NAV_INITIALIZED__) return;
  window.__WSA_NAV_INITIALIZED__ = true;

  // Configuration
  var MESSAGE_PREFIX = 'WSA_';
  var DEBOUNCE_MS = 50;

  // State
  var lastReportedPath = null;
  var debounceTimer = null;

  /**
   * Get the current route information
   */
  function getCurrentRoute() {
    return {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      fullPath: location.pathname + location.search + location.hash
    };
  }

  /**
   * Send a message to the parent frame
   */
  function sendToParent(type, data) {
    if (!parent || parent === window) return;

    try {
      parent.postMessage({
        type: MESSAGE_PREFIX + type,
        ...data,
        timestamp: Date.now()
      }, '*');
    } catch (e) {
      console.warn('[WSA Nav] Failed to send message:', e);
    }
  }

  /**
   * Report a route change to the parent (debounced)
   */
  function reportRouteChange(trigger) {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(function() {
      var route = getCurrentRoute();

      // Skip if route hasn't changed
      if (route.fullPath === lastReportedPath) return;

      lastReportedPath = route.fullPath;

      sendToParent('ROUTE_CHANGE', {
        trigger: trigger,
        route: route
      });
    }, DEBOUNCE_MS);
  }

  /**
   * Patch the history API to intercept navigation
   */
  function patchHistoryAPI() {
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    history.pushState = function(state, title, url) {
      originalPushState.call(this, state, title, url);
      reportRouteChange('pushState');
    };

    history.replaceState = function(state, title, url) {
      originalReplaceState.call(this, state, title, url);
      reportRouteChange('replaceState');
    };
  }

  /**
   * Set up event listeners for navigation events
   */
  function setupEventListeners() {
    // Back/forward navigation
    window.addEventListener('popstate', function() {
      reportRouteChange('popstate');
    });

    // Hash-based routing
    window.addEventListener('hashchange', function() {
      reportRouteChange('hashchange');
    });

    // Full page unload (navigation away)
    window.addEventListener('beforeunload', function() {
      sendToParent('UNLOAD', {
        route: getCurrentRoute()
      });
    });
  }

  /**
   * Handle incoming messages from parent
   */
  function setupMessageHandler() {
    window.addEventListener('message', function(event) {
      // Basic validation (origin check should be done, but we can't know parent origin)
      if (!event.data || typeof event.data.type !== 'string') return;
      if (!event.data.type.startsWith(MESSAGE_PREFIX)) return;

      var type = event.data.type.replace(MESSAGE_PREFIX, '');

      switch (type) {
        case 'NAVIGATE':
          handleNavigate(event.data);
          break;

        case 'PING':
          sendToParent('PONG', { route: getCurrentRoute() });
          break;
      }
    });
  }

  /**
   * Handle navigation command from parent
   */
  function handleNavigate(data) {
    var path = data.path;
    var method = data.method || 'push';

    if (!path) {
      sendToParent('NAVIGATE_RESULT', {
        success: false,
        error: 'No path provided',
        requestedPath: path,
        actualPath: getCurrentRoute().fullPath
      });
      return;
    }

    try {
      // Perform navigation
      if (method === 'replace') {
        history.replaceState(null, '', path);
      } else {
        history.pushState(null, '', path);
      }

      // Trigger popstate to notify SPA routers
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      // Small delay to let SPA router process
      setTimeout(function() {
        var actualRoute = getCurrentRoute();

        sendToParent('NAVIGATE_RESULT', {
          success: true,
          requestedPath: path,
          actualPath: actualRoute.fullPath
        });

        // Also report as route change
        lastReportedPath = actualRoute.fullPath;
        sendToParent('ROUTE_CHANGE', {
          trigger: 'navigate',
          route: actualRoute
        });
      }, 100);

    } catch (e) {
      sendToParent('NAVIGATE_RESULT', {
        success: false,
        error: e.message,
        requestedPath: path,
        actualPath: getCurrentRoute().fullPath
      });
    }
  }

  /**
   * Initialize the navigation tracking
   */
  function init() {
    patchHistoryAPI();
    setupEventListeners();
    setupMessageHandler();

    // Report ready state with initial route
    sendToParent('READY', {
      initialRoute: getCurrentRoute()
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

/**
 * Get the navigation script as a minified string for injection
 */
export function getNavigationScript(): string {
  // In production, this could be minified
  return IFRAME_NAVIGATION_SCRIPT;
}
