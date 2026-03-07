import { useEffect } from 'react';
import { useParams, useNavigate, Link, Outlet, useLocation } from 'react-router-dom';
import { useAppDispatch } from '@/store/hooks';
import { setCurrentRepo } from '@/store/slices/repoSlice';
import { useGetRepositoryStatsQuery } from '@/services/repoApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, RefreshCw, Settings } from 'lucide-react';
import { RepositoryStatsHeader } from '@/components/repo/RepositoryStatsHeader';
import { routes } from '@/utils/routes';

/**
 * RepositoryLayout - Shared layout for repository pages with nested routes.
 * Displays the header, stats, and tabs. Child routes render via <Outlet />.
 * Route: /repo/:owner/:repo/*
 */
export function RepositoryLayout() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  // Determine current tab from pathname
  const pathAfterRepo = location.pathname.replace(`/repo/${owner}/${repo}`, '');
  const currentTab = pathAfterRepo.startsWith('/proxy-rules')
    ? 'proxy-rules'
    : pathAfterRepo.startsWith('/aliases')
      ? 'aliases'
      : pathAfterRepo.startsWith('/branches')
        ? 'branches'
        : 'deployments';

  // Update Redux store when URL params change
  useEffect(() => {
    if (owner && repo) {
      dispatch(setCurrentRepo({ owner, repo }));
    }
  }, [owner, repo, dispatch]);

  // Check user's role for this project
  const { canAdmin } = useProjectRole(owner!, repo!);

  // Fetch repository stats
  const {
    data: statsData,
    isLoading: isLoadingStats,
    error: statsError,
  } = useGetRepositoryStatsQuery(
    { owner: owner!, repo: repo! },
    { skip: !owner || !repo },
  );

  // Loading state
  if (isLoadingStats) {
    return (
      <div className="bg-background">
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
          {/* Title skeleton */}
          <Skeleton className="h-8 w-48" />
          {/* Stats skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          {/* Tabs skeleton */}
          <Skeleton className="h-10 w-96" />
          {/* Content skeleton */}
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // Error state
  if (statsError) {
    return (
      <div className="bg-background">
        <div className="p-8">
          <Alert variant="destructive" className="max-w-2xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-3">
                <div>
                  <p className="font-medium">Error Loading Repository</p>
                  <p className="text-sm mt-1">Failed to load repository statistics</p>
                  <p className="text-sm mt-2">
                    Repository: {owner}/{repo}
                  </p>
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

  return (
    <div className="bg-background">
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        {/* Repository Title with Settings */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">
            {owner}/{repo}
          </h1>
          {canAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(routes.repositorySettings(owner!, repo!))}
              className="flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          )}
        </div>

        {/* Stats Header */}
        {statsData && (
          <div className="mb-6">
            <RepositoryStatsHeader stats={statsData} />
          </div>
        )}

        {/* Tabs Navigation */}
        <Tabs value={currentTab} className="w-full">
          <TabsList>
            <TabsTrigger value="deployments" asChild>
              <Link to={routes.deployments(owner!, repo!)}>Deployments</Link>
            </TabsTrigger>
            <TabsTrigger value="branches" asChild>
              <Link to={routes.branches(owner!, repo!)}>Branches</Link>
            </TabsTrigger>
            <TabsTrigger value="aliases" asChild>
              <Link to={routes.aliases(owner!, repo!)}>Aliases</Link>
            </TabsTrigger>
            <TabsTrigger value="proxy-rules" asChild>
              <Link to={routes.proxyRules(owner!, repo!)}>Proxy Rules</Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tab Content - rendered via Outlet */}
        <div className="mt-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
