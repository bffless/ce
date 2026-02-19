import { useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/store/hooks';
import { setCurrentRepo } from '@/store/slices/repoSlice';
import { useGetRepositoryStatsQuery } from '@/services/repoApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, RefreshCw, Settings } from 'lucide-react';
import { DeploymentsList } from '@/components/repo/DeploymentsList';
import { RepositoryStatsHeader } from '@/components/repo/RepositoryStatsHeader';
import { AliasesTab } from '@/components/repo/AliasesTab';
import { BranchesTab } from '@/components/repo/BranchesTab';
import { ProxyRuleSetsTab } from '@/components/proxy-rules';

type TabValue = 'deployments' | 'branches' | 'aliases' | 'proxy-rules';

/**
 * RepositoryOverviewPage - Main page showing deployments, stats, and aliases
 * Route: /repo/:owner/:repo
 */
export function RepositoryOverviewPage() {
  const { owner, repo } = useParams<{
    owner: string;
    repo: string;
  }>();

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  // Get tab from query params, default to 'deployments'
  const tabParam = searchParams.get('tab');
  const currentTab: TabValue =
    tabParam === 'branches' || tabParam === 'aliases' || tabParam === 'proxy-rules'
      ? tabParam
      : 'deployments';

  // Handler for tab changes
  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    // Update URL with new tab
    navigate(`/repo/${owner}/${repo}?tab=${newTab}`, { replace: true });
  };

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
    {
      owner: owner!,
      repo: repo!,
    },
    {
      skip: !owner || !repo,
    },
  );

  // Loading state
  if (isLoadingStats) {
    return (
      <div className="bg-background">
        <div className="p-8 space-y-6">
          {/* Stats skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
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
      {/* Main content */}
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
              onClick={() => navigate(`/repo/${owner}/${repo}/settings`)}
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

        {/* Tabs for Deployments, Branches, Aliases, Proxy Rules */}
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList>
            <TabsTrigger value="deployments">Deployments</TabsTrigger>
            <TabsTrigger value="branches">Branches</TabsTrigger>
            <TabsTrigger value="aliases">Aliases</TabsTrigger>
            <TabsTrigger value="proxy-rules">Proxy Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="deployments" className="mt-6">
            <DeploymentsList owner={owner!} repo={repo!} />
          </TabsContent>

          <TabsContent value="branches" className="mt-6">
            <BranchesTab owner={owner!} repo={repo!} />
          </TabsContent>

          <TabsContent value="aliases" className="mt-6">
            <AliasesTab owner={owner!} repo={repo!} />
          </TabsContent>

          <TabsContent value="proxy-rules" className="mt-6">
            <ProxyRuleSetsTab owner={owner!} repo={repo!} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
