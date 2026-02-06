import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSidebarSearch } from '@/store/slices/repositoryListSlice';
import { useGetMyRepositoriesQuery, SidebarRepository } from '@/services/repositoriesApi';
import { useGetSessionQuery } from '@/services/authApi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, AlertCircle, Plus } from 'lucide-react';
import { PermissionBadge, PermissionLevel } from './PermissionBadge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CreateRepositoryDialog } from './CreateRepositoryDialog';

export function RepositorySidebar() {
  const dispatch = useAppDispatch();
  const sidebarSearch = useAppSelector((state) => state.repositoryList.sidebarSearch);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: sessionData } = useGetSessionQuery();
  const canCreateRepo = sessionData?.user?.role !== 'member';

  const { data, isLoading, error } = useGetMyRepositoriesQuery();

  // Client-side filter based on sidebar search
  const filteredRepos = useMemo(() => {
    if (!data?.repositories) return [];
    if (!sidebarSearch) return data.repositories;

    const query = sidebarSearch.toLowerCase();
    return data.repositories.filter(
      (repo) => repo.name.toLowerCase().includes(query) || repo.owner.toLowerCase().includes(query),
    );
  }, [data, sidebarSearch]);

  if (isLoading) {
    return <SidebarSkeleton />;
  }

  if (error) {
    return <SidebarError />;
  }

  return (
    <>
      {canCreateRepo && (
        <CreateRepositoryDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      )}
      <aside className="w-full md:w-[300px] h-screen md:sticky md:top-0 border-r bg-background p-4 overflow-y-auto">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Your Repositories</h2>
            {canCreateRepo && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateDialogOpen(true)}
                className="h-7 px-2"
              >
                <Plus className="h-4 w-4 mr-1" />
                New
              </Button>
            )}
          </div>

          {/* Sidebar search */}
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Find a repository..."
              value={sidebarSearch}
              onChange={(e) => dispatch(setSidebarSearch(e.target.value))}
              className="pl-8"
            />
          </div>
        </div>

        {/* Repository list */}
        <div className="space-y-1">
          {filteredRepos.length === 0 ? (
            <EmptyState
              search={sidebarSearch}
              onCreateClick={canCreateRepo ? () => setCreateDialogOpen(true) : undefined}
            />
          ) : (
            filteredRepos.map((repo) => <SidebarRepoItem key={repo.id} repo={repo} />)
          )}
        </div>

        {/* Show total count */}
        {data && (
          <div className="mt-4 text-sm text-muted-foreground">
            {filteredRepos.length} of {data.total}{' '}
            {data.total === 1 ? 'repository' : 'repositories'}
          </div>
        )}
      </aside>
    </>
  );
}

// Sidebar repository item
function SidebarRepoItem({ repo }: { repo: SidebarRepository }) {
  // Map permission type and role to PermissionLevel
  const getPermissionLevel = (): PermissionLevel | null => {
    if (repo.permissionType === 'owner') return null; // Don't show badge for owned repos in sidebar

    // For direct and group permissions, map role to permission level
    const role = repo.role?.toLowerCase();
    if (role === 'admin') return 'admin';
    if (role === 'contributor') return 'contributor';
    if (role === 'viewer') return 'viewer';

    // Default to viewer if role is not recognized
    return 'viewer';
  };

  const permissionLevel = getPermissionLevel();

  return (
    <TooltipProvider>
      <Link
        to={`/repo/${repo.owner}/${repo.name}`}
        className="block px-2 py-1.5 rounded hover:bg-accent text-sm transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">
            {repo.owner}/{repo.name}
          </span>
          {/* Small permission icon - only show for non-owned repos */}
          {permissionLevel && <PermissionBadge level={permissionLevel} size="sm" iconOnly />}
        </div>
      </Link>
    </TooltipProvider>
  );
}

// Loading skeleton
function SidebarSkeleton() {
  return (
    <aside className="w-full md:w-[300px] h-screen md:sticky md:top-0 border-r bg-background p-4 overflow-y-auto">
      <div className="mb-4">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </aside>
  );
}

// Error state
function SidebarError() {
  return (
    <aside className="w-full md:w-[300px] h-screen md:sticky md:top-0 border-r bg-background p-4">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load repositories. Please try again later.</AlertDescription>
      </Alert>
    </aside>
  );
}

// Empty state
function EmptyState({
  search,
  onCreateClick,
}: {
  search: string;
  onCreateClick?: () => void;
}) {
  if (search) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No repositories match "{search}"
      </div>
    );
  }

  return (
    <div className="text-sm text-muted-foreground text-center py-4 space-y-2">
      <p>You don't have any repositories yet.</p>
      {onCreateClick && (
        <Button variant="outline" size="sm" onClick={onCreateClick}>
          <Plus className="h-4 w-4 mr-1" />
          Create one
        </Button>
      )}
    </div>
  );
}
