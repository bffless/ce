import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  injectNavigationScript,
  getIframeRoute,
  InjectionResult,
} from '@/lib/iframe-script-injector';
import {
  setCurrentRoute,
  setScriptReady,
  setInjectionStatus,
  storeRoute,
  clearStoredRoute,
  setRestoreStatus,
  selectCurrentRoute,
  selectScriptReady,
  selectInjectionStatus,
  selectStoredRoute,
  selectRestoreStatus,
} from '@/store/slices/iframeNavigationSlice';

interface IframeRoute {
  pathname: string;
  search: string;
  hash: string;
  fullPath: string;
}

interface IframeNavigationMessage {
  type: string;
  route?: IframeRoute;
  initialRoute?: IframeRoute;
  trigger?: string;
  timestamp?: number;
  success?: boolean;
  error?: string;
  requestedPath?: string;
  actualPath?: string;
}

interface UseIframeNavigationOptions {
  /** Repository key (owner/repo) for storing routes */
  repoKey?: string;
  /**
   * Base path prefix including the ref type and SHA/alias.
   * e.g., '/public/owner/repo/commits/abc123/' or '/public/owner/repo/alias/main/' (note trailing slash)
   */
  basePathPrefix?: string;
  /**
   * Base path suffix after the ref.
   * e.g., '/apps/frontend/dist' (note leading slash)
   */
  basePathSuffix?: string;
  /** Called when iframe route changes */
  onRouteChange?: (route: string) => void;
  /** Called when navigation script is ready */
  onReady?: () => void;
  /** Called when navigation attempt completes */
  onNavigateResult?: (success: boolean, error?: string) => void;
  /** Called when route restoration completes */
  onRestoreComplete?: (success: boolean, error?: string) => void;
  /** Whether to enable route restoration (default: true) */
  enableRestoration?: boolean;
}

// Stale route threshold: 24 hours
const STALE_ROUTE_MS = 24 * 60 * 60 * 1000;

export function useIframeNavigation(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  options: UseIframeNavigationOptions = {},
) {
  const dispatch = useAppDispatch();
  const {
    repoKey,
    basePathPrefix,
    basePathSuffix,
    onRouteChange,
    onReady,
    onNavigateResult,
    onRestoreComplete,
    enableRestoration = true,
  } = options;

  // Track the previous repoKey to detect folder changes
  const prevRepoKey = useRef<string | undefined>(undefined);

  /**
   * Extract the SPA route from a full iframe path by stripping the base path pattern.
   * Pattern: {basePathPrefix}{basePathSuffix}{spaRoute}
   * e.g., '/public/owner/repo/commits/abc123/apps/frontend/dist/dashboard' -> '/dashboard'
   *
   * The basePathPrefix already includes the ref type (commits/alias) and SHA/alias name.
   */
  const extractSpaRoute = useCallback(
    (fullPath: string): string => {
      if (!basePathPrefix || !basePathSuffix) return fullPath;

      // Check if path starts with the prefix
      if (!fullPath.startsWith(basePathPrefix)) {
        return fullPath;
      }

      // Find where the suffix starts (after prefix + SHA)
      const afterPrefix = fullPath.slice(basePathPrefix.length);

      // The SHA is everything before the suffix
      // e.g., afterPrefix = "abc123/apps/frontend/dist/dashboard"
      // basePathSuffix = "/apps/frontend/dist"
      // We need to find "/apps/frontend/dist" in afterPrefix

      const suffixIndex = afterPrefix.indexOf(basePathSuffix);
      if (suffixIndex === -1) {
        // Suffix not found - this means we're viewing a different folder
        // than what basePathSuffix expects. Return '/' to indicate we can't
        // extract a meaningful SPA route (prevents storing full paths as routes)
        return '/';
      }

      // Everything after the suffix is the SPA route
      const spaRoute = afterPrefix.slice(suffixIndex + basePathSuffix.length);

      // If empty or just "/", return "/"
      if (!spaRoute || spaRoute === '/') {
        return '/';
      }

      // Ensure it starts with /
      return spaRoute.startsWith('/') ? spaRoute : '/' + spaRoute;
    },
    [basePathPrefix, basePathSuffix],
  );

  const currentRoute = useAppSelector(selectCurrentRoute);
  const scriptReady = useAppSelector(selectScriptReady);
  const injectionStatus = useAppSelector(selectInjectionStatus);
  const storedRoute = useAppSelector(repoKey ? selectStoredRoute(repoKey) : () => undefined);
  const restoreStatus = useAppSelector(selectRestoreStatus);

  // Track if we've attempted injection
  const injectionAttempted = useRef(false);
  // Track if we've attempted restoration for this session
  const restorationAttempted = useRef(false);
  // Track pending restoration path (to match against NAVIGATE_RESULT)
  const pendingRestorationPath = useRef<string | null>(null);

  /**
   * Navigate the iframe to a specific path
   * Defined before handleMessage since it's used there
   */
  const navigate = useCallback(
    (path: string, method: 'push' | 'replace' = 'push') => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) {
        console.warn('[WSA] Cannot navigate: iframe not available');
        return false;
      }

      try {
        iframe.contentWindow.postMessage(
          {
            type: 'WSA_NAVIGATE',
            path,
            method,
          },
          '*',
        );
        return true;
      } catch (e) {
        console.warn('[WSA] Cannot navigate: postMessage failed', e);
        return false;
      }
    },
    [iframeRef],
  );

  /**
   * Handle incoming postMessage events
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Validate message structure
      const data = event.data as IframeNavigationMessage;
      if (!data?.type?.startsWith('WSA_')) return;

      // Validate origin matches iframe (if we can check)
      const iframe = iframeRef.current;
      if (iframe) {
        try {
          const iframeOrigin = new URL(iframe.src).origin;
          if (event.origin !== iframeOrigin && event.origin !== window.location.origin) {
            console.warn('[WSA] Ignoring message from unexpected origin:', event.origin);
            return;
          }
        } catch {
          // Can't parse iframe src, accept if same origin as parent
          if (event.origin !== window.location.origin) return;
        }
      }

      // Process message
      const type = data.type.replace('WSA_', '');

      switch (type) {
        case 'READY':
          dispatch(setScriptReady(true));
          if (data.initialRoute) {
            dispatch(setCurrentRoute(data.initialRoute.fullPath));
            onRouteChange?.(data.initialRoute.fullPath);
          }
          onReady?.();

          // Attempt route restoration immediately when script is ready
          // This is more reliable than using a separate effect with setTimeout
          // because we handle it synchronously in the message handler
          if (enableRestoration && repoKey && storedRoute && !restorationAttempted.current) {
            const currentSpaRoute = data.initialRoute
              ? extractSpaRoute(data.initialRoute.fullPath)
              : '/';

            // Skip if already at stored route or if stored route is stale/root
            const isStale = Date.now() - storedRoute.timestamp > STALE_ROUTE_MS;
            const isRoot = storedRoute.path === '/' || storedRoute.path === '';
            const alreadyAtRoute = currentSpaRoute === storedRoute.path;

            if (!isStale && !isRoot && !alreadyAtRoute) {
              // Get base path from the initial route
              const initialFullPath = data.initialRoute?.fullPath || '';
              if (initialFullPath.startsWith(basePathPrefix || '')) {
                const afterPrefix = initialFullPath.slice((basePathPrefix || '').length);
                const suffixIndex = afterPrefix.indexOf(basePathSuffix || '');
                if (suffixIndex !== -1) {
                  const basePath =
                    (basePathPrefix || '') +
                    afterPrefix.slice(0, suffixIndex + (basePathSuffix || '').length);
                  // Ensure storedRoute.path starts with /
                  const normalizedPath = storedRoute.path.startsWith('/')
                    ? storedRoute.path
                    : '/' + storedRoute.path;
                  const fullNavigationPath = basePath + normalizedPath;

                  restorationAttempted.current = true;
                  pendingRestorationPath.current = fullNavigationPath;
                  dispatch(setRestoreStatus({ status: 'pending' }));

                  // Small delay to ensure message handler is fully ready
                  setTimeout(() => {
                    const success = navigate(fullNavigationPath, 'replace');

                    if (!success) {
                      pendingRestorationPath.current = null;
                      dispatch(
                        setRestoreStatus({ status: 'failed', error: 'Navigation command failed' }),
                      );
                      onRestoreComplete?.(false, 'Navigation command failed');
                    }
                  }, 50);
                }
              }
            } else if (isStale && repoKey) {
              dispatch(clearStoredRoute(repoKey));
            }
          }
          break;

        case 'ROUTE_CHANGE':
          if (data.route) {
            dispatch(setCurrentRoute(data.route.fullPath));
            onRouteChange?.(data.route.fullPath);

            // Store route if repoKey provided
            if (repoKey) {
              // Extract the SPA route (strip base path prefix)
              const spaRoute = extractSpaRoute(data.route.fullPath);
              // Only store non-root routes
              if (spaRoute !== '/' && spaRoute !== '') {
                dispatch(storeRoute({ repoKey, path: spaRoute }));
              }
            }
          }
          break;

        case 'NAVIGATE_RESULT':
          // Check if this is a restoration result
          // pendingRestorationPath stores the full navigation path that was requested
          if (
            pendingRestorationPath.current &&
            data.requestedPath === pendingRestorationPath.current
          ) {
            pendingRestorationPath.current = null;

            if (data.success) {
              dispatch(setRestoreStatus({ status: 'success' }));
              onRestoreComplete?.(true);
            } else {
              // Check if it's a 404/not-found scenario
              const isNotFound =
                data.error?.includes('not found') ||
                data.error?.includes('404') ||
                (data.actualPath &&
                  data.actualPath !== data.requestedPath &&
                  data.actualPath === '/');

              if (isNotFound) {
                dispatch(setRestoreStatus({ status: 'not-found', error: data.error }));
                // Clear the stored route since it doesn't exist
                if (repoKey) {
                  dispatch(clearStoredRoute(repoKey));
                }
              } else {
                dispatch(setRestoreStatus({ status: 'failed', error: data.error }));
              }
              onRestoreComplete?.(false, data.error);
            }

            // If SPA redirected to a different path, update stored route
            if (
              data.success &&
              data.actualPath &&
              data.actualPath !== data.requestedPath &&
              repoKey
            ) {
              dispatch(storeRoute({ repoKey, path: data.actualPath }));
            }
          }

          onNavigateResult?.(data.success ?? false, data.error);
          break;

        case 'UNLOAD':
          dispatch(setScriptReady(false));
          break;

        case 'PONG':
          // Response to PING - script is alive
          if (data.route) {
            dispatch(setCurrentRoute(data.route.fullPath));
          }
          break;
      }
    },
    [
      dispatch,
      iframeRef,
      onRouteChange,
      onReady,
      onNavigateResult,
      onRestoreComplete,
      repoKey,
      storedRoute,
      enableRestoration,
      basePathPrefix,
      basePathSuffix,
      extractSpaRoute,
      navigate,
    ],
  );

  /**
   * Inject navigation script into iframe
   */
  const injectScript = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const result: InjectionResult = injectNavigationScript(iframe);

    dispatch(
      setInjectionStatus({
        attempted: true,
        success: result.success,
        error: result.error,
        reason: result.reason,
      }),
    );

    if (!result.success && result.reason !== 'already-injected') {
      console.warn('[WSA] Script injection failed:', result.error);
    }
  }, [dispatch, iframeRef]);

  /**
   * Ping the iframe to check if script is alive
   */
  const ping = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return false;

    try {
      iframe.contentWindow.postMessage({ type: 'WSA_PING' }, '*');
      return true;
    } catch {
      return false;
    }
  }, [iframeRef]);

  // Set up message listener
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Inject script when iframe loads
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      // Reset state on new load
      injectionAttempted.current = false;
      restorationAttempted.current = false;
      pendingRestorationPath.current = null;
      dispatch(setScriptReady(false));
      dispatch(setRestoreStatus({ status: 'idle' }));

      // Try to read location directly (same-origin advantage)
      const directRoute = getIframeRoute(iframe);
      if (directRoute) {
        dispatch(setCurrentRoute(directRoute));

        // Store route if repoKey provided
        if (repoKey) {
          // Extract the SPA route (strip base path prefix)
          const spaRoute = extractSpaRoute(directRoute);
          // Only store non-root routes
          if (spaRoute !== '/' && spaRoute !== '') {
            dispatch(storeRoute({ repoKey, path: spaRoute }));
          }
        }
      }

      // Re-inject script for future SPA navigation
      // Small delay to ensure iframe DOM is ready
      setTimeout(() => {
        if (!injectionAttempted.current) {
          injectionAttempted.current = true;
          injectScript();
        }
      }, 100);
    };

    iframe.addEventListener('load', handleLoad);

    // If iframe is already loaded, inject immediately
    if (iframe.contentDocument?.readyState === 'complete') {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [iframeRef, dispatch, injectScript, repoKey, extractSpaRoute]);

  // Handle iframe errors
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleError = () => {
      dispatch(setScriptReady(false));
      dispatch(setCurrentRoute(null));
      dispatch(
        setInjectionStatus({
          attempted: false,
          success: false,
          error: 'Iframe failed to load',
          reason: 'unknown',
        }),
      );
    };

    iframe.addEventListener('error', handleError);
    return () => iframe.removeEventListener('error', handleError);
  }, [iframeRef, dispatch]);

  // Note: Route restoration is now handled in the READY message handler
  // This ensures restoration happens synchronously when the script reports ready,
  // avoiding race conditions with React's effect cleanup during URL changes

  // Clear stored route when navigating away from a folder
  // This prevents old deep routes from being restored when returning to the folder
  useEffect(() => {
    if (prevRepoKey.current && prevRepoKey.current !== repoKey) {
      // User navigated away from the previous folder - clear its stored route
      dispatch(clearStoredRoute(prevRepoKey.current));
    }
    prevRepoKey.current = repoKey;
  }, [repoKey, dispatch]);

  return {
    currentRoute,
    scriptReady,
    injectionStatus,
    restoreStatus,
    navigate,
    injectScript,
    ping,
  };
}
