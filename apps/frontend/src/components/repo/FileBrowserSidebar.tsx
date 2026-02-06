import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, X, FolderOpen, AlertCircle, PanelLeftClose } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TreeNode } from './TreeNode';
import {
  buildFileTreeRecursive,
  filterTree,
  type TreeNode as TreeNodeType,
  type FileMetadata,
} from '@/lib/file-tree';
import { cn } from '@/lib/utils';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setFileBrowserSearchQuery,
  setFileBrowserExpandedPaths,
  toggleFileBrowserPath,
} from '@/store/slices/uiSlice';

export interface FileBrowserSidebarProps {
  files?: FileMetadata[];
  isLoading?: boolean;
  error?: string | null;
  currentFilePath?: string;
  className?: string;
  onCollapse?: () => void;
  /** Whether to automatically collapse the sidebar when a file is selected (useful for mobile) */
  autoCollapseOnSelect?: boolean;
}

/**
 * FileBrowserSidebar - Main sidebar component for browsing repository files
 */
export function FileBrowserSidebar({
  files = [],
  isLoading = false,
  error = null,
  currentFilePath,
  className,
  onCollapse,
  autoCollapseOnSelect = false,
}: FileBrowserSidebarProps) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { owner, repo, ref } = useParams<{
    owner: string;
    repo: string;
    ref: string;
  }>();

  // Get state from Redux
  const searchQuery = useAppSelector((state) => state.ui.fileBrowser.searchQuery);
  const expandedPathsArray = useAppSelector((state) => state.ui.fileBrowser.expandedPaths);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastAutoExpandedPathKey = useRef<string | null>(null);

  // Convert expanded paths array to Set for easier lookup
  const expandedPaths = useMemo(() => new Set(expandedPathsArray), [expandedPathsArray]);

  // Build file tree from flat file list (memoized to prevent unnecessary recalculations)
  const fileTree = useMemo(() => buildFileTreeRecursive(files), [files]);

  // Filter tree based on search query (memoized to prevent unnecessary recalculations)
  const displayTree = useMemo(
    () => (searchQuery.trim() ? filterTree(fileTree, searchQuery) : fileTree),
    [fileTree, searchQuery],
  );

  // Auto-expand directories when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      // Expand all directories in search results
      const newExpanded: string[] = [];
      const collectDirs = (nodes: TreeNodeType[]) => {
        nodes.forEach((node) => {
          if (node.type === 'directory') {
            newExpanded.push(node.path);
            collectDirs(node.children);
          }
        });
      };
      collectDirs(displayTree);

      // Only dispatch if the paths have actually changed
      const currentSet = new Set(expandedPathsArray);
      const newSet = new Set(newExpanded);
      const hasChanged =
        currentSet.size !== newSet.size || newExpanded.some((path) => !currentSet.has(path));

      if (hasChanged) {
        dispatch(setFileBrowserExpandedPaths(newExpanded));
      }
    }
  }, [searchQuery, displayTree, expandedPathsArray, dispatch]);

  // Auto-expand parent directories of current file
  useEffect(() => {
    if (!currentFilePath || searchQuery) {
      // Reset so a future selection can auto-expand again.
      lastAutoExpandedPathKey.current = null;
      return;
    }

    const scopeKey =
      owner && repo && ref ? `${owner}/${repo}/${ref}:${currentFilePath}` : currentFilePath;

    // Skip if we've already auto-expanded for this exact file selection.
    if (lastAutoExpandedPathKey.current === scopeKey) {
      return;
    }

    // Normalize path: remove trailing slash for consistent handling
    const normalizedPath = currentFilePath.endsWith('/')
      ? currentFilePath.slice(0, -1)
      : currentFilePath;

    const segments = normalizedPath.split('/');
    const parentPaths: string[] = [];
    let currentPath = '';

    // Collect all parent directory paths (excluding the current item itself)
    for (let i = 0; i < segments.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];
      parentPaths.push(currentPath);
    }

    // Check if any parent paths are missing from expanded paths
    const missingPaths = parentPaths.filter((path) => !expandedPaths.has(path));

    // Only update if there are missing paths
    if (missingPaths.length > 0) {
      const newExpanded = new Set(expandedPaths);
      missingPaths.forEach((path) => newExpanded.add(path));
      dispatch(setFileBrowserExpandedPaths(Array.from(newExpanded)));
    }

    lastAutoExpandedPathKey.current = scopeKey;
  }, [currentFilePath, searchQuery, expandedPaths, dispatch, owner, repo, ref]);

  const handleFileSelect = useCallback(
    (path: string, isDirectory: boolean, hasIndexHtml: boolean) => {
      if (owner && repo && ref) {
        if (isDirectory && !hasIndexHtml) {
          // Directory without index.html - navigate to directory view
          navigate(`/repo/${owner}/${repo}/${ref}/${path}`);
        } else if (isDirectory && hasIndexHtml) {
          // Directory with index.html - navigate to directory path (will load preview with trailing slash)
          // Adding trailing slash ensures the preview loads the directory, not index.html explicitly
          navigate(`/repo/${owner}/${repo}/${ref}/${path}/`);
        } else {
          // Regular file - navigate to file
          navigate(`/repo/${owner}/${repo}/${ref}/${path}`);
        }
        // Auto-close sidebar on mobile/tablet after file selection (if enabled)
        if (autoCollapseOnSelect) {
          onCollapse?.();
        }
      }
    },
    [navigate, owner, repo, ref, onCollapse, autoCollapseOnSelect],
  );

  const handleToggleExpand = useCallback(
    (path: string) => {
      dispatch(toggleFileBrowserPath(path));
    },
    [dispatch],
  );

  const handleClearSearch = useCallback(() => {
    dispatch(setFileBrowserSearchQuery(''));
    searchInputRef.current?.focus();
  }, [dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus search on '/'
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // Clear search on Escape
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        handleClearSearch();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClearSearch]);

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex flex-col h-full bg-background border-r', className)}>
        <div className="p-4 border-b">
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" style={{ marginLeft: `${(i % 3) * 12}px` }} />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn('flex flex-col h-full bg-background border-r', className)}>
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Files</h2>
        </div>
        <div className="flex-1 p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className={cn('flex flex-col h-full bg-background border-r', className)}>
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Files</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">No files found in this deployment</p>
        </div>
      </div>
    );
  }

  // No search results
  if (searchQuery && displayTree.length === 0) {
    return (
      <div className={cn('flex flex-col h-full bg-background border-r', className)}>
        <div className="border-b">
          <div className="px-4 h-11 flex items-center justify-between shrink-0">
            <h2 className="text-lg font-semibold">Files</h2>
          </div>
          <div className="px-4 pb-4">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search files... (Press / to focus)"
                value={searchQuery}
                onChange={(e) => dispatch(setFileBrowserSearchQuery(e.target.value))}
                className="pl-8 pr-8"
              />
              {searchQuery && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <Search className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">No files match "{searchQuery}"</p>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className={cn('flex flex-col h-full bg-background border-r', className)}>
      {/* Header with search */}
      <div className="border-b">
        {/* Title bar - fixed height to match content area header */}
        <div className="px-2 h-11 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1 flex-1 min-w-0">
            {onCollapse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCollapse}
                className="h-7 w-7 p-0 shrink-0"
                title="Collapse file tree"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            )}
            <h2 className="text-lg font-semibold truncate">Files</h2>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 ml-2">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        {/* Search input */}
        <div className="px-4 pb-4">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search files... (Press / to focus)"
              value={searchQuery}
              onChange={(e) => dispatch(setFileBrowserSearchQuery(e.target.value))}
              className="pl-8 pr-8"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="p-2" role="tree" aria-label="File tree">
          {displayTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              level={0}
              isActive={currentFilePath === node.path}
              expandedPaths={expandedPaths}
              onSelect={handleFileSelect}
              onToggleExpand={handleToggleExpand}
              currentFilePath={currentFilePath}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
