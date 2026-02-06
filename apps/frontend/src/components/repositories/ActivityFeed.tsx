import { useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { useGetRepositoryFeedQuery } from '@/services/repositoriesApi';
import { useGetSessionQuery } from '@/services/authApi';
import { RepositoryCard } from './RepositoryCard';
import { Pagination } from './Pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, FolderOpen, RefreshCw, Plus } from 'lucide-react';
import { CreateRepositoryDialog } from './CreateRepositoryDialog';

export function ActivityFeed() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { currentPage, sortBy, sortOrder, feedSearch } = useAppSelector(
    (state) => state.repositoryList
  );

  const { data: sessionData } = useGetSessionQuery();
  const canCreateRepo = sessionData?.user?.role !== 'member';

  const { data, isLoading, error, refetch } = useGetRepositoryFeedQuery({
    page: currentPage,
    limit: 20,
    search: feedSearch || undefined,
    sortBy,
    order: sortOrder,
  });

  if (isLoading) {
    return <FeedSkeleton />;
  }

  if (error) {
    return <FeedError error={error} onRetry={refetch} />;
  }

  if (!data || data.repositories.length === 0) {
    return (
      <>
        {canCreateRepo && (
          <CreateRepositoryDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
        )}
        <EmptyFeed
          search={feedSearch}
          onCreateClick={canCreateRepo ? () => setCreateDialogOpen(true) : undefined}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h2 className="text-2xl font-bold">
          {feedSearch ? 'Search Results' : 'Recently Updated'}
        </h2>
        <p className="text-muted-foreground" aria-live="polite">
          {data.total} {data.total === 1 ? 'repository' : 'repositories'}
        </p>
      </div>

      {/* Repository cards */}
      <div className="space-y-4" role="feed" aria-busy={isLoading} aria-label="Repository feed">
        {data.repositories.map((repo) => (
          <RepositoryCard key={repo.id} repository={repo} />
        ))}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={Math.ceil(data.total / 20)}
        total={data.total}
      />
    </div>
  );
}

// Loading skeleton
function FeedSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-6 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Error state
function FeedError({ error, onRetry }: { error: any; onRetry: () => void }) {
  // Handle different error types
  if ('status' in error) {
    if (error.status === 403) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You don't have permission to view repositories.
          </AlertDescription>
        </Alert>
      );
    }

    if (error.status === 500) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Server Error</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>Something went wrong on our end. Please try again or contact support.</p>
            <Button onClick={onRetry} variant="outline" size="sm" className="mt-2">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
  }

  // Generic network error
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Connection Error</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>Unable to load repositories. Please check your connection and try again.</p>
        <Button onClick={onRetry} variant="outline" size="sm" className="mt-2">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// Empty state
function EmptyFeed({
  search,
  onCreateClick,
}: {
  search: string;
  onCreateClick?: () => void;
}) {
  if (search) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No repositories found</h3>
        <p className="text-muted-foreground">
          No repositories match your search for "{search}"
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">No repositories yet</h3>
      <p className="text-muted-foreground mb-4">
        {onCreateClick
          ? "You don't have access to any repositories. Create one to get started!"
          : "You don't have access to any repositories."}
      </p>
      {onCreateClick && (
        <Button onClick={onCreateClick}>
          <Plus className="h-4 w-4 mr-2" />
          Create Repository
        </Button>
      )}
    </div>
  );
}
