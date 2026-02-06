import { useMemo } from 'react';
import { GitCommit } from 'lucide-react';
import { CommitGraph } from './CommitGraph';
import { useInfiniteCommits } from './useInfiniteCommits';
import { Skeleton } from '@/components/ui/skeleton';

interface CommitsTabProps {
  owner: string;
  repo: string;
  currentRef: string;
  searchQuery: string;
  onSelect: (sha: string) => void;
}

export function CommitsTab({
  owner,
  repo,
  currentRef,
  searchQuery,
  onSelect,
}: CommitsTabProps) {
  const {
    commits,
    aliases,
    isLoading,
    isLoadingMore,
    hasMore,
    total,
    loadMore,
    error,
  } = useInfiniteCommits({ owner, repo });

  // Filter commits locally based on search query
  const filteredCommits = useMemo(() => {
    if (!searchQuery.trim()) return commits;
    const query = searchQuery.toLowerCase();
    return commits.filter(
      (c) =>
        c.sha.toLowerCase().includes(query) ||
        c.shortSha.toLowerCase().includes(query) ||
        c.branch.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
    );
  }, [commits, searchQuery]);

  // Loading state (initial load)
  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <GitCommit className="h-12 w-12 text-destructive mb-4" />
        <h3 className="font-medium mb-1">Failed to Load</h3>
        <p className="text-sm text-muted-foreground">
          Could not load commit history.
        </p>
      </div>
    );
  }

  // Empty state
  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <GitCommit className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium mb-1">No Commits</h3>
        <p className="text-sm text-muted-foreground">
          No deployments have been made yet.
        </p>
      </div>
    );
  }

  // Search result empty state
  if (filteredCommits.length === 0 && searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <GitCommit className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium mb-1">No Results</h3>
        <p className="text-sm text-muted-foreground">
          No commits match "{searchQuery}"
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with total count */}
      <div className="px-3 py-2 text-xs text-muted-foreground border-b shrink-0">
        {searchQuery
          ? `${filteredCommits.length} results`
          : `Showing ${commits.length} of ${total} commits`}
      </div>

      {/* Graph with infinite scroll */}
      <div className="flex-1 min-h-0">
        <CommitGraph
          commits={filteredCommits}
          currentRef={currentRef}
          onSelect={onSelect}
          aliases={aliases}
          hasMore={hasMore && !searchQuery}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
        />
      </div>

      {/* End of data message */}
      {!hasMore && commits.length > 0 && !searchQuery && (
        <div className="px-3 py-2 text-xs text-center text-muted-foreground border-t shrink-0">
          All {total} commits loaded
        </div>
      )}
    </div>
  );
}
