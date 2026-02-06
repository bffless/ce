import { useMemo, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setRefSearchQuery,
  setRefSelectorOpen,
  setActiveTab,
  type RefSelectorTab,
} from '@/store/slices/refSelectorSlice';
import { useGetRepositoryRefsQuery } from '@/services/repoApi';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RefSelectorHeader } from './RefSelectorHeader';
import { RefSelectorTabs } from './RefSelectorTabs';
import { AliasesTab } from './AliasesTab';
import { BranchesTab } from './BranchesTab';
import { CommitsTab } from './CommitsTab';

export interface RefSelectorSidebarProps {
  owner: string;
  repo: string;
  currentRef: string;
  currentFilePath?: string;
  className?: string;
  /** Whether to auto-close on selection (useful for mobile) */
  autoCloseOnSelect?: boolean;
}

export function RefSelectorSidebar({
  owner,
  repo,
  currentRef,
  currentFilePath,
  className,
  autoCloseOnSelect = false,
}: RefSelectorSidebarProps) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchQuery = useAppSelector((state) => state.refSelector.searchQuery);
  const activeTab = useAppSelector((state) => state.refSelector.activeTab);

  // Focus search input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Fetch repository refs
  const { data: refsData, isLoading, error } = useGetRepositoryRefsQuery({
    owner,
    repo,
  });

  // Filter refs based on search query
  const filteredRefs = useMemo(() => {
    if (!refsData) return null;
    if (!searchQuery.trim()) return refsData;

    const query = searchQuery.toLowerCase();
    return {
      aliases: refsData.aliases.filter((a) =>
        a.name.toLowerCase().includes(query) ||
        a.commitSha.toLowerCase().includes(query)
      ),
      branches: refsData.branches.filter((b) =>
        b.name.toLowerCase().includes(query) ||
        b.latestCommit.toLowerCase().includes(query)
      ),
      recentCommits: refsData.recentCommits.filter((c) =>
        c.sha.toLowerCase().includes(query) ||
        c.shortSha.toLowerCase().includes(query) ||
        c.branch.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
      ),
    };
  }, [refsData, searchQuery]);

  // Handle ref selection
  const handleSelectRef = (refValue: string) => {
    if (currentFilePath) {
      navigate(`/repo/${owner}/${repo}/${refValue}/${currentFilePath}`);
    } else {
      navigate(`/repo/${owner}/${repo}/${refValue}`);
    }

    if (autoCloseOnSelect) {
      dispatch(setRefSelectorOpen(false));
    }
  };

  // Handlers
  const handleClose = useCallback(() => dispatch(setRefSelectorOpen(false)), [dispatch]);
  const handleSearchChange = useCallback((value: string) => dispatch(setRefSearchQuery(value)), [dispatch]);
  const handleTabChange = useCallback((tab: RefSelectorTab) => dispatch(setActiveTab(tab)), [dispatch]);

  // Loading state
  if (isLoading) {
    return (
      <div
        ref={sidebarRef}
        role="dialog"
        aria-modal="true"
        aria-label="Reference selector"
        className={cn('flex flex-col h-full bg-background border-l', className)}
      >
        <RefSelectorHeader
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onClose={handleClose}
          searchInputRef={searchInputRef}
        />
        <div className="flex-1 p-4 space-y-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        ref={sidebarRef}
        role="dialog"
        aria-modal="true"
        aria-label="Reference selector"
        className={cn('flex flex-col h-full bg-background border-l', className)}
      >
        <RefSelectorHeader
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onClose={handleClose}
          searchInputRef={searchInputRef}
        />
        <div className="flex-1 p-4" role="alert">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to load references</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Counts for badges
  const aliasCount = filteredRefs?.aliases.length ?? 0;
  const branchCount = filteredRefs?.branches.length ?? 0;
  const commitCount = filteredRefs?.recentCommits.length ?? 0;

  return (
    <div
      ref={sidebarRef}
      role="dialog"
      aria-modal="true"
      aria-label="Reference selector"
      className={cn('flex flex-col h-full bg-background border-l', className)}
    >
      <RefSelectorHeader
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onClose={handleClose}
        searchInputRef={searchInputRef}
      />

      <RefSelectorTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        aliasCount={aliasCount}
        branchCount={branchCount}
        commitCount={commitCount}
        aliasesContent={
          <AliasesTab
            aliases={filteredRefs?.aliases ?? []}
            currentRef={currentRef}
            searchQuery={searchQuery}
            onSelect={handleSelectRef}
          />
        }
        branchesContent={
          <BranchesTab
            branches={filteredRefs?.branches ?? []}
            currentRef={currentRef}
            searchQuery={searchQuery}
            onSelect={handleSelectRef}
          />
        }
        commitsContent={
          <CommitsTab
            owner={owner}
            repo={repo}
            currentRef={currentRef}
            searchQuery={searchQuery}
            onSelect={handleSelectRef}
          />
        }
      />
    </div>
  );
}
