import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setCurrentRepo, setCurrentRef, setCurrentFilePath } from '@/store/slices/repoSlice';
import { toggleSidebar, setSidebarOpen } from '@/store/slices/uiSlice';
import { setRefSelectorOpen, toggleRefSelector } from '@/store/slices/refSelectorSlice';
import { useGetFileTreeQuery, useGetRepositoryRefsQuery } from '@/services/repoApi';
import type { RepositoryRefsResponse } from '@/services/repoApi';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Menu, AlertCircle, RefreshCw, GitBranch, ChevronRight } from 'lucide-react';
import { FileBrowserSidebar } from '@/components/repo/FileBrowserSidebar';
import { RepoBreadcrumb } from '@/components/repo/RepoBreadcrumb';
import { ContentViewer } from '@/components/repo/ContentViewer';
import { DirectoryViewer } from '@/components/repo/DirectoryViewer';
import { RefSelectorSidebar } from '@/components/repo/RefSelectorSidebar';
import { CommitOverview } from '@/components/repo/CommitOverview';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { ImperativePanelHandle } from 'react-resizable-panels';

/**
 * Determines the default ref to use when no explicit ref is specified in the URL.
 * Priority: production alias → main alias → main branch → master branch → latest commit
 */
function determineDefaultRef(refsData: RepositoryRefsResponse): string | null {
  // 1. Check for "production" alias
  const productionAlias = refsData.aliases.find((a) => a.name === 'production');
  if (productionAlias) return productionAlias.commitSha;

  // 2. Check for "main" alias
  const mainAlias = refsData.aliases.find((a) => a.name === 'main');
  if (mainAlias) return mainAlias.commitSha;

  // 3. Check for "main" branch
  const mainBranch = refsData.branches.find((b) => b.name === 'main');
  if (mainBranch) return mainBranch.latestCommit;

  // 4. Check for "master" branch
  const masterBranch = refsData.branches.find((b) => b.name === 'master');
  if (masterBranch) return masterBranch.latestCommit;

  // 5. Fall back to most recent commit
  if (refsData.recentCommits.length > 0) {
    return refsData.recentCommits[0].sha;
  }

  // No refs available
  return null;
}

export function RepositoryPage() {
  const {
    owner,
    repo,
    ref,
    '*': filepath,
  } = useParams<{
    owner: string;
    repo: string;
    ref: string;
    '*': string;
  }>();

  const dispatch = useAppDispatch();
  const sidebarOpen = useAppSelector((state) => state.ui.sidebarOpen);
  const refSelectorOpen = useAppSelector((state) => state.refSelector.isOpen);

  // Detect if we're on mobile (<768px) - Sheet should only render on mobile
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Refs for imperative panel control (to collapse/expand without remounting)
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  // Collapse/expand panels when sidebar states change (without remounting)
  useEffect(() => {
    if (isMobile) return;

    if (sidebarOpen) {
      leftPanelRef.current?.expand();
    } else {
      leftPanelRef.current?.collapse();
    }
  }, [sidebarOpen, isMobile]);

  useEffect(() => {
    if (isMobile) return;

    if (refSelectorOpen) {
      rightPanelRef.current?.expand();
    } else {
      rightPanelRef.current?.collapse();
    }
  }, [refSelectorOpen, isMobile]);

  // Update Redux store when URL params change
  useEffect(() => {
    if (owner && repo) {
      dispatch(setCurrentRepo({ owner, repo }));
    }
  }, [owner, repo, dispatch]);

  useEffect(() => {
    if (ref) {
      dispatch(setCurrentRef(ref));
    }
  }, [ref, dispatch]);

  useEffect(() => {
    dispatch(setCurrentFilePath(filepath || null));
  }, [filepath, dispatch]);

  // Fetch repository refs first (needed for default ref resolution)
  const {
    data: refsData,
    isLoading: isLoadingRefs,
    error: refsError,
  } = useGetRepositoryRefsQuery(
    {
      owner: owner!,
      repo: repo!,
    },
    {
      skip: !owner || !repo,
    },
  );

  // Determine effective ref to use (handles default ref resolution)
  const effectiveRef = useMemo(() => {
    if (ref) return ref; // Explicit ref in URL takes precedence
    if (!refsData) return null; // Wait for refs data to load

    return determineDefaultRef(refsData);
  }, [ref, refsData]);

  // Determine the display label for the current ref
  const currentRefLabel = useMemo(() => {
    if (!effectiveRef || !refsData) return 'Select ref...';

    // Check if it's an alias
    const alias = refsData.aliases.find(
      (a) => a.commitSha === effectiveRef || a.name === effectiveRef
    );
    if (alias) return alias.name;

    // Check if it's a branch
    const branch = refsData.branches.find(
      (b) => b.latestCommit === effectiveRef || b.name === effectiveRef
    );
    if (branch) return branch.name;

    // Check if it's a commit
    const commit = refsData.recentCommits.find((c) => c.sha === effectiveRef);
    if (commit) return commit.shortSha;

    // Fallback: show shortened SHA
    return effectiveRef.substring(0, 7);
  }, [effectiveRef, refsData]);

  // Fetch file tree using the effective ref
  const {
    data: fileTreeData,
    isLoading: isLoadingFileTree,
    error: fileTreeError,
  } = useGetFileTreeQuery(
    {
      owner: owner!,
      repo: repo!,
      commitSha: effectiveRef!,
    },
    {
      skip: !owner || !repo || !effectiveRef,
    },
  );

  // Determine if the current path is a file or directory (must be before early returns)
  const currentFileData = fileTreeData?.files.find((file) => file.path === filepath);

  const isDirectory = useMemo(() => {
    if (!filepath || !fileTreeData) return false;

    // If we found an exact file match, it's a file
    if (currentFileData) return false;

    // Check if any files start with this path (indicating it's a directory)
    const normalizedPath = filepath.endsWith('/') ? filepath : filepath + '/';
    return fileTreeData.files.some((file) => file.path.startsWith(normalizedPath));
  }, [filepath, fileTreeData, currentFileData]);

  // Check if the directory contains an index.html (for auto-preview)
  const directoryIndexHtml = useMemo(() => {
    if (!filepath || !fileTreeData || !isDirectory) return null;

    const normalizedPath = filepath.endsWith('/') ? filepath : filepath + '/';
    const indexPath = `${normalizedPath}index.html`.replace(/^\//, ''); // Remove leading slash if present

    return fileTreeData.files.find(
      (file) => file.path.toLowerCase() === indexPath.toLowerCase()
    );
  }, [filepath, fileTreeData, isDirectory]);

  // Loading state
  if (isLoadingFileTree || isLoadingRefs) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-8 w-96" />
          <div className="mt-8 grid grid-cols-4 gap-4">
            <div className="col-span-1 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
            <div className="col-span-3">
              <Skeleton className="h-96 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (fileTreeError || refsError) {
    return (
      <div className="bg-background">
        <div className="p-8">
          <Alert variant="destructive" className="max-w-2xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-3">
                <div>
                  <p className="font-medium">Error Loading Repository</p>
                  <p className="text-sm mt-1">
                    {fileTreeError
                      ? 'Failed to load file tree'
                      : 'Failed to load repository references'}
                  </p>
                  <p className="text-sm mt-2">
                    Repository: {owner}/{repo}
                  </p>
                  {ref && <p className="text-sm">Ref: {ref}</p>}
                </div>
                <Button
                  onClick={() => window.location.reload()}
                  size="sm"
                  variant="outline"
                  className="w-fit"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reload Page
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Helper to render commit overview
  const renderCommitOverview = (showExpandButton = false) => {
    if (!owner || !repo || !effectiveRef) return null;
    return (
      <CommitOverview
        owner={owner}
        repo={repo}
        commitSha={effectiveRef}
        leftActions={
          showExpandButton ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch(setSidebarOpen(true))}
              className="h-7 px-2 text-xs shrink-0"
              title="Expand file tree"
            >
              <Menu className="h-3.5 w-3.5" />
            </Button>
          ) : undefined
        }
      />
    );
  };

  // Helper to render main content
  const renderMainContent = (showExpandButton = false) => {
    // No filepath → show commit overview
    if (!filepath || !effectiveRef) {
      return renderCommitOverview(showExpandButton);
    }

    // Filepath is a directory with index.html → show preview
    if (isDirectory && directoryIndexHtml && effectiveRef) {
      // Use the directory path (with trailing slash) for the preview
      // This ensures the base tag and relative paths work correctly
      const previewPath = filepath.endsWith('/') ? filepath : `${filepath}/`;
      return (
        <ContentViewer
          owner={owner!}
          repo={repo!}
          gitRef={effectiveRef}
          filepath={previewPath}
          fileData={directoryIndexHtml}
          leftActions={
            showExpandButton ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch(setSidebarOpen(true))}
                className="h-7 px-2 text-xs shrink-0"
                title="Expand file tree"
              >
                <Menu className="h-3.5 w-3.5" />
              </Button>
            ) : undefined
          }
        />
      );
    }

    // Filepath is a directory without index.html → show directory listing
    if (isDirectory && fileTreeData) {
      return (
        <DirectoryViewer
          files={fileTreeData.files}
          currentPath={filepath}
          owner={owner!}
          repo={repo!}
          gitRef={effectiveRef}
          leftActions={
            showExpandButton ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch(setSidebarOpen(true))}
                className="h-7 px-2 text-xs shrink-0"
                title="Expand file tree"
              >
                <Menu className="h-3.5 w-3.5" />
              </Button>
            ) : undefined
          }
        />
      );
    }

    // Filepath is a file → show file content
    if (currentFileData) {
      return (
        <ContentViewer
          owner={owner!}
          repo={repo!}
          gitRef={effectiveRef}
          filepath={filepath}
          fileData={currentFileData}
          leftActions={
            showExpandButton ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch(setSidebarOpen(true))}
                className="h-7 px-2 text-xs shrink-0"
                title="Expand file tree"
              >
                <Menu className="h-3.5 w-3.5" />
              </Button>
            ) : undefined
          }
        />
      );
    }

    // Path not found
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-card p-8 text-center">
          <h3 className="text-lg font-semibold mb-2">Path Not Found</h3>
          <p className="text-sm text-muted-foreground">
            The path <code className="bg-muted px-1 py-0.5 rounded">{filepath}</code> doesn't exist
            in this repository.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header with Breadcrumb and RefSelector */}
      <div className="border-b">
        <div className="px-4 py-3 flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Hamburger menu for mobile only */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch(toggleSidebar())}
              className="md:hidden h-8 w-8 p-0 shrink-0"
              title="Toggle file browser"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <RepoBreadcrumb
              owner={owner!}
              repo={repo!}
              gitRef={effectiveRef || undefined}
              filepath={filepath}
            />
          </div>

          {/* Ref Selector Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {effectiveRef && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch(toggleRefSelector())}
                className="h-8 min-w-[120px] justify-between font-mono text-xs"
                title="Open references panel"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{currentRefLabel}</span>
                </div>
                <ChevronRight className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  refSelectorOpen && "rotate-180"
                )} />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        {/* Mobile layout (<768px): Sheet drawers */}
        {isMobile ? (
          <div className="h-full">
            {/* File browser sheet (left) */}
            <Sheet open={sidebarOpen} onOpenChange={(open) => dispatch(setSidebarOpen(open))}>
              <SheetContent
                side="left"
                className="w-[280px] p-0"
              >
                <SheetTitle className="sr-only">File Browser</SheetTitle>
                <FileBrowserSidebar
                  files={fileTreeData?.files || []}
                  isLoading={isLoadingFileTree}
                  error={fileTreeError ? 'Failed to load file tree' : null}
                  currentFilePath={filepath}
                  onCollapse={() => dispatch(setSidebarOpen(false))}
                  autoCollapseOnSelect={true}
                />
              </SheetContent>
            </Sheet>

            {/* Ref selector sheet (right) */}
            <Sheet open={refSelectorOpen} onOpenChange={(open) => dispatch(setRefSelectorOpen(open))}>
              <SheetContent side="right" className="w-[360px] p-0">
                <SheetTitle className="sr-only">References</SheetTitle>
                <RefSelectorSidebar
                  owner={owner!}
                  repo={repo!}
                  currentRef={effectiveRef!}
                  currentFilePath={filepath}
                  autoCloseOnSelect={true}
                />
              </SheetContent>
            </Sheet>

            <div className="h-full overflow-auto">{renderMainContent()}</div>
          </div>
        ) : (
          /* Desktop/Tablet layout (≥768px): Resizable panels */
          <div className="h-full">
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full"
            >
              {/* File browser sidebar (left) - always rendered, collapsed when hidden */}
              <ResizablePanel
                ref={leftPanelRef}
                defaultSize={sidebarOpen ? 20 : 0}
                minSize={15}
                maxSize={35}
                collapsible
                collapsedSize={0}
                onCollapse={() => dispatch(setSidebarOpen(false))}
                onExpand={() => dispatch(setSidebarOpen(true))}
                className={cn(!sidebarOpen && 'min-w-0')}
              >
                <FileBrowserSidebar
                  files={fileTreeData?.files || []}
                  isLoading={isLoadingFileTree}
                  error={fileTreeError ? 'Failed to load file tree' : null}
                  currentFilePath={filepath}
                  onCollapse={() => dispatch(setSidebarOpen(false))}
                  autoCollapseOnSelect={false}
                />
              </ResizablePanel>

              <ResizableHandle withHandle className={cn(!sidebarOpen && 'hidden')} />

              {/* Content area (center) */}
              <ResizablePanel
                defaultSize={55}
                minSize={40}
              >
                <div className="h-full overflow-auto">{renderMainContent(!sidebarOpen)}</div>
              </ResizablePanel>

              <ResizableHandle withHandle className={cn(!refSelectorOpen && 'hidden')} />

              {/* Ref selector sidebar (right) - always rendered, collapsed when hidden */}
              <ResizablePanel
                ref={rightPanelRef}
                defaultSize={refSelectorOpen ? 30 : 0}
                minSize={20}
                maxSize={45}
                collapsible
                collapsedSize={0}
                onCollapse={() => dispatch(setRefSelectorOpen(false))}
                onExpand={() => dispatch(setRefSelectorOpen(true))}
                className={cn(!refSelectorOpen && 'min-w-0')}
              >
                <RefSelectorSidebar
                  owner={owner!}
                  repo={repo!}
                  currentRef={effectiveRef!}
                  currentFilePath={filepath}
                  autoCloseOnSelect={false}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}
      </div>
    </div>
  );
}
