import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, AlertCircle, Copy, ExternalLink, Check } from 'lucide-react';
import { useIframeNavigation } from '@/hooks/useIframeNavigation';
import { useAppDispatch } from '@/store/hooks';
import { setCurrentRoute } from '@/store/slices/iframeNavigationSlice';
import { useGetPathPreferenceQuery, useUpdatePathPreferenceMutation, useGetCommitDetailsQuery } from '@/services/repoApi';
import { useToast } from '@/hooks/use-toast';
import { buildPublicUrl, getPublicUrlPath, buildPreviewAliasUrl, isCommitSha } from '@/lib/utils';
const VITE_API_URL = import.meta.env.VITE_API_URL || '';

interface HtmlPreviewProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
}

export function HtmlPreview({ owner, repo, gitRef, filepath }: HtmlPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [key, setKey] = useState(0); // Used to force iframe reload
  const [copied, setCopied] = useState(false);
  // Track the current navigated path within the iframe (relative to commit SHA)
  // This is used to preserve navigation when switching commits for non-SPA content
  // We use a ref to track it without causing re-renders, and state to apply it on gitRef change
  const lastNavigatedPath = useRef<string | null>(null);
  const [appliedNavigatedPath, setAppliedNavigatedPath] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dispatch = useAppDispatch();
  const { toast } = useToast();

  // Track previous restore status to show toast only on transitions
  const prevRestoreStatus = useRef<string>('idle');
  // Track previous gitRef to detect commit switches
  const prevGitRef = useRef(gitRef);

  // Build the base path pattern for the iframe (used to strip prefix when storing routes)
  // This pattern should match ANY commit SHA, not just the current one
  // Format: /public/owner/repo/commits/[SHA]/filepath or /public/owner/repo/alias/[alias]/filepath
  const apiBaseUrl = VITE_API_URL || '';

  // Normalize filepath - remove trailing slash for consistent path matching
  const normalizedFilepath = filepath.endsWith('/') ? filepath.slice(0, -1) : filepath;
  // Use a regex-escapable pattern - we'll pass the parts separately
  // Include the ref type (commits or alias) in the prefix
  const refPath = getPublicUrlPath(gitRef);
  const basePathPrefix = `${apiBaseUrl}/public/${owner}/${repo}/${refPath}/`;
  const basePathSuffix = normalizedFilepath ? `/${normalizedFilepath}` : '';

  // Fetch SPA mode from database (persisted setting shared across all users)
  const { data: pathPref, isLoading: isPrefLoading } = useGetPathPreferenceQuery({
    owner,
    repo,
    filepath: normalizedFilepath,
  });

  // Fetch commit details to check for preview aliases (only when gitRef is a commit SHA)
  // We need to wait for this to load before rendering the iframe to avoid
  // loading with the wrong URL (path-based) before the alias URL is available
  const isCommitRef = isCommitSha(gitRef);
  const { data: commitData, isLoading: isCommitDataLoading } = useGetCommitDetailsQuery(
    { owner, repo, commitSha: gitRef },
    { skip: !isCommitRef }
  );

  // Don't render iframe until commit data is loaded (when viewing a commit SHA)
  // This prevents a race condition where the iframe loads with path-based URL first,
  // causing 404s for relative asset references, then reloads with subdomain URL
  const waitingForCommitData = isCommitRef && isCommitDataLoading;

  // Find a preview alias that matches the current filepath
  // Preview aliases have a basePath (e.g., /build) that maps to a subdomain
  const matchingPreviewAlias = commitData?.aliases?.find((alias) => {
    if (!alias.isAutoPreview || !alias.basePath) return false;
    // Normalize basePath: remove leading/trailing slashes
    const normalizedBasePath = alias.basePath.replace(/^\//, '').replace(/\/$/, '');
    // basePath "/" normalizes to "" and matches all files
    if (normalizedBasePath === '') return true;
    // Check if filepath starts with or equals the basePath
    return (
      normalizedFilepath === normalizedBasePath ||
      normalizedFilepath.startsWith(normalizedBasePath + '/')
    );
  });

  const [updatePathPref, { isError: isUpdateError }] = useUpdatePathPreferenceMutation();

  // Use database value (defaults to false via API)
  const spaMode = pathPref?.spaMode ?? false;

  // Handler for toggling SPA mode - updates database with optimistic update
  const handleSpaModeChange = useCallback(
    (checked: boolean) => {
      updatePathPref({
        owner,
        repo,
        filepath: normalizedFilepath,
        spaMode: checked,
      });
    },
    [owner, repo, normalizedFilepath, updatePathPref],
  );

  // Show toast on mutation error
  useEffect(() => {
    if (isUpdateError) {
      toast({
        title: 'Failed to save preference',
        description: 'Could not save SPA mode setting.',
        variant: 'destructive',
      });
    }
  }, [isUpdateError, toast]);

  // Path key for route persistence (scoped per repo + filepath)
  const spaPathKey = `${owner}/${repo}:${normalizedFilepath}`;

  // Iframe navigation tracking with route persistence
  // Include filepath in key so routes are scoped per-folder (different folders have different SPAs)
  // Only enable persistence when spaMode is true
  const repoKey = spaMode ? spaPathKey : undefined;
  const { currentRoute, scriptReady, injectionStatus, restoreStatus } = useIframeNavigation(
    iframeRef,
    {
      repoKey,
      basePathPrefix,
      basePathSuffix,
      enableRestoration: spaMode,
      onRouteChange: (route) => {
        console.log('[WSA Parent] Route changed:', route);
        // Extract the path relative to the commit SHA or alias for non-SPA navigation persistence
        // Pattern: /public/owner/repo/commits/{sha}/{relativePath} or /public/owner/repo/alias/{name}/{relativePath}
        // Store in ref (not state) to avoid triggering re-renders/reloads
        const match = route.match(/^\/public\/[^/]+\/[^/]+\/(?:commits|alias)\/[^/]+\/(.+)$/);
        if (match) {
          lastNavigatedPath.current = match[1];
        }
      },
      onReady: () => {
        console.log('[WSA Parent] Navigation script ready');
      },
      onRestoreComplete: (success, error) => {
        console.log('[WSA Parent] Restoration complete:', { success, error });
      },
    },
  );

  // Show toast notifications for restoration status changes
  useEffect(() => {
    // Only show toast on status transitions
    if (restoreStatus === prevRestoreStatus.current) return;

    const previousStatus = prevRestoreStatus.current;
    prevRestoreStatus.current = restoreStatus;

    // Don't show toast for initial idle state or when going to pending
    if (restoreStatus === 'idle' || restoreStatus === 'pending') return;

    // Only show toast if we were actually attempting restoration
    if (previousStatus !== 'pending') return;

    switch (restoreStatus) {
      case 'success':
        // Silent success - no toast needed, the route change is visible
        break;

      case 'not-found':
        toast({
          title: 'Page not found',
          description: 'The previous route does not exist in this version.',
          variant: 'destructive',
        });
        break;

      case 'failed':
        toast({
          title: 'Navigation failed',
          description: 'Could not restore previous route.',
          variant: 'destructive',
        });
        break;
    }
  }, [restoreStatus, toast]);

  // Debug logging for state changes
  useEffect(() => {
    console.log('[WSA Parent] State:', {
      currentRoute,
      scriptReady,
      injectionStatus,
      appliedNavigatedPath,
    });
  }, [currentRoute, scriptReady, injectionStatus, appliedNavigatedPath]);

  // When gitRef changes (commit switch), apply the last navigated path for non-SPA content
  useEffect(() => {
    if (prevGitRef.current !== gitRef) {
      // Commit changed - apply the last navigated path if we have one and not in SPA mode
      if (!spaMode && lastNavigatedPath.current) {
        setAppliedNavigatedPath(lastNavigatedPath.current);
      }
      prevGitRef.current = gitRef;
    }
  }, [gitRef, spaMode]);

  // Build the public URL for the file
  // For non-SPA content: use appliedNavigatedPath if available (preserves navigation across commit switches)
  // For SPA content: always use filepath (SPA handles routing internally via history API)
  const effectivePath = !spaMode && appliedNavigatedPath ? appliedNavigatedPath : filepath;

  // If a matching preview alias exists, use the subdomain URL for proper SPA routing
  // Otherwise, use the standard path-based URL
  const iframeSrc = (() => {
    if (matchingPreviewAlias) {
      // Calculate the path relative to the basePath
      const normalizedBasePath = matchingPreviewAlias.basePath!.replace(/^\//, '').replace(/\/$/, '');
      let relativePath = effectivePath;
      if (effectivePath.startsWith(normalizedBasePath + '/')) {
        relativePath = effectivePath.slice(normalizedBasePath.length + 1);
      } else if (effectivePath === normalizedBasePath) {
        relativePath = '';
      }
      return buildPreviewAliasUrl(matchingPreviewAlias.name, relativePath);
    }
    return buildPublicUrl(apiBaseUrl, owner, repo, gitRef, effectivePath);
  })();

  // Handle iframe load
  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  // Handle iframe error
  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  // Refresh iframe
  const handleRefresh = () => {
    setIsLoading(true);
    setHasError(false);
    setKey((prev) => prev + 1); // Change key to force remount
  };

  // Determine if injection failed
  const injectionFailed = injectionStatus.attempted && !injectionStatus.success;

  // Compute the display path from currentRoute
  // currentRoute from iframe is the full location.pathname (e.g., /public/owner/repo/commits/sha/apps/frontend/coverage/...)
  // We need to strip the prefix and show just the path after the commit SHA or alias
  const getDisplayPath = () => {
    if (!currentRoute || currentRoute === '/') {
      return filepath;
    }

    // The prefix pattern: /public/owner/repo/commits/sha/ or /public/owner/repo/alias/name/
    // We want to strip everything up to and including the ref
    const prefixPattern = `/public/${owner}/${repo}/${refPath}/`;

    if (currentRoute.startsWith(prefixPattern)) {
      // Return everything after the prefix (this is the actual file path in the repo)
      return currentRoute.slice(prefixPattern.length);
    }

    // If current route doesn't match expected pattern, just return filepath
    return filepath;
  };
  const displayPath = getDisplayPath();

  // Construct full URL for copy/open actions (use base iframe URL, not SPA route)
  const fullUrl = iframeSrc.startsWith('http')
    ? iframeSrc
    : `${window.location.origin}${iframeSrc}`;

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  }, [fullUrl]);

  // Handle open in new tab
  const handleOpenNewTab = useCallback(() => {
    window.open(fullUrl, '_blank', 'noopener,noreferrer');
  }, [fullUrl]);

  // Reset navigated path tracking when filepath prop changes (user clicked different file in sidebar)
  const prevFilepath = useRef(filepath);
  useEffect(() => {
    if (prevFilepath.current !== filepath) {
      prevFilepath.current = filepath;
      lastNavigatedPath.current = null;
      setAppliedNavigatedPath(null);
    }
  }, [filepath]);

  // Reset loading/error state and currentRoute when the URL changes.
  // We intentionally do NOT change the `key` here because changing the iframe's
  // `src` prop already triggers navigation. Incrementing `key` would unmount/remount
  // the iframe, causing the in-flight request to be cancelled and a duplicate
  // request to be made.
  const prevSrc = useRef(iframeSrc);
  useEffect(() => {
    if (prevSrc.current !== iframeSrc) {
      prevSrc.current = iframeSrc;
      setIsLoading(true);
      setHasError(false);
      // Reset currentRoute to prevent stale route from previous file showing briefly
      dispatch(setCurrentRoute(null));
    }
  }, [iframeSrc, dispatch]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Unified Toolbar */}
      <TooltipProvider>
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <div className="flex-1 text-sm text-muted-foreground truncate min-w-0">
            <span>Preview: </span>
            <code className="font-mono" title={displayPath}>
              {displayPath}
            </code>
            {injectionFailed && (
              <span className="ml-2 text-xs text-yellow-600">(route tracking unavailable)</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* SPA Mode Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 px-2 h-7">
                  <Checkbox
                    id="spa-mode"
                    checked={spaMode}
                    onCheckedChange={(checked) => handleSpaModeChange(checked === true)}
                    disabled={isPrefLoading}
                    className="h-3.5 w-3.5"
                  />
                  <label
                    htmlFor="spa-mode"
                    className="text-xs text-muted-foreground cursor-pointer select-none"
                  >
                    SPA
                  </label>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Enable SPA mode to persist routes when switching commits
              </TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 w-7 p-0">
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied!' : 'Copy URL'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenNewTab}
                  className="h-7 w-7 p-0"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in new tab</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  className="h-7 w-7 p-0"
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh preview</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Preview content */}
      <div className="flex-1 relative overflow-hidden bg-white">
        {/* Loading spinner - show while waiting for commit data or iframe to load */}
        {(isLoading || waitingForCommitData) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading preview...</span>
            </div>
          </div>
        )}

        {/* Route restoration indicator */}
        {!isLoading && !waitingForCommitData && restoreStatus === 'pending' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-background/90 border rounded-full shadow-sm">
              <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Restoring navigation...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10 p-8">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-3">
                  <div>
                    <p className="font-medium">Failed to load preview</p>
                    <p className="text-sm mt-1">
                      The file may not be valid HTML, or it may reference resources that are not
                      available.
                    </p>
                  </div>
                  <Button onClick={handleRefresh} size="sm" variant="outline" className="w-fit">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Try Again
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Sandboxed iframe - only render after commit data is loaded to avoid race condition */}
        {!waitingForCommitData && (
          <iframe
            ref={iframeRef}
            key={key}
            src={iframeSrc}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            onLoad={handleLoad}
            onError={handleError}
            title={`Preview of ${filepath}`}
          />
        )}
      </div>
    </div>
  );
}
