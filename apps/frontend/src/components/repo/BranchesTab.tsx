import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGetRepositoryRefsQuery, useGetDeploymentsQuery } from '@/services/repoApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GitBranch, Eye } from 'lucide-react';

interface BranchesTabProps {
  owner: string;
  repo: string;
}

/**
 * BranchesTab - Displays repository branches with deployment info
 * Used in RepositoryOverviewPage on the Branches tab
 */
export function BranchesTab({ owner, repo }: BranchesTabProps) {
  const navigate = useNavigate();

  // Fetch branches from refs API
  const {
    data: refsData,
    isLoading: isLoadingRefs,
    error: refsError,
  } = useGetRepositoryRefsQuery({ owner, repo });

  // Fetch all deployments to calculate deployment counts per branch
  const { data: deploymentsData, isLoading: isLoadingDeployments } = useGetDeploymentsQuery({
    owner,
    repo,
    limit: 100, // Get more deployments to calculate accurate counts
  });

  // Calculate deployment counts per branch
  const branchDeploymentCounts = useMemo(() => {
    if (!deploymentsData?.deployments) return {};

    const counts: Record<string, number> = {};
    deploymentsData.deployments.forEach((deployment) => {
      counts[deployment.branch] = (counts[deployment.branch] || 0) + 1;
    });

    return counts;
  }, [deploymentsData]);

  // Enrich branches with deployment counts
  const enrichedBranches = useMemo(() => {
    if (!refsData?.branches) return [];

    return refsData.branches.map((branch) => ({
      ...branch,
      deploymentCount: branchDeploymentCounts[branch.name] || 0,
    }));
  }, [refsData?.branches, branchDeploymentCounts]);

  // Format date with relative time
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // Format commit SHA (short version)
  const formatCommitSha = (sha: string): string => {
    return sha.substring(0, 7);
  };

  // Handle view branch click - navigate to latest commit on that branch
  const handleViewBranch = (latestCommit: string) => {
    navigate(`/repo/${owner}/${repo}/${latestCommit}`);
  };

  // Loading state
  if (isLoadingRefs || isLoadingDeployments) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* List skeleton */}
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (refsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load branches</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!refsData || enrichedBranches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium">No branches found</p>
          <p className="text-sm text-muted-foreground mt-2">
            Branches will appear here after deployments are created
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Branches Table */}
        <div className="space-y-2">
          {/* Table Header - Desktop only */}
          <div className="hidden md:grid md:grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
            <div className="col-span-3">Branch Name</div>
            <div className="col-span-2">Latest Commit</div>
            <div className="col-span-3">Last Deployed</div>
            <div className="col-span-2">Deployments</div>
            <div className="col-span-2">Actions</div>
          </div>

          {/* Branch Rows */}
          {enrichedBranches.map((branch) => (
            <div
              key={branch.name}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
            >
              {/* Branch Name */}
              <div className="md:col-span-3 flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{branch.name}</span>
              </div>

              {/* Latest Commit (short SHA) */}
              <div className="md:col-span-2 flex items-center">
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {formatCommitSha(branch.latestCommit)}
                </code>
              </div>

              {/* Last Deployed */}
              <div className="md:col-span-3 flex items-center">
                <span className="text-sm text-muted-foreground">
                  {formatDate(branch.latestDeployedAt)}
                </span>
              </div>

              {/* Deployment Count */}
              <div className="md:col-span-2 flex items-center">
                <span className="text-sm font-medium">{branch.deploymentCount}</span>
              </div>

              {/* Actions */}
              <div className="md:col-span-2 flex items-center gap-2 justify-end md:justify-start">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  title="View latest deployment"
                  onClick={() => handleViewBranch(branch.latestCommit)}
                >
                  <Eye className="h-3 w-3" />
                  View
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
