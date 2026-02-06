import { ReactNode, useCallback } from 'react';
import { useGetCommitDetailsQuery, useGetRepositoryRefsQuery } from '../../services/repoApi';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Package, HardDrive, GitBranch, Tag, Copy, FileText, GitCommit } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ViewHeader } from './ViewHeader';
import { DeleteCommitButton } from './DeleteCommitButton';
import { AliasesSection } from './AliasesSection';

interface CommitOverviewProps {
  owner: string;
  repo: string;
  commitSha: string;
  /** Optional left-side actions to render before the title (e.g., hamburger menu) */
  leftActions?: ReactNode;
}

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateString: string): string {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch {
    return dateString;
  }
}

export function CommitOverview({ owner, repo, commitSha, leftActions }: CommitOverviewProps) {
  const { data, isLoading, error, refetch } = useGetCommitDetailsQuery({
    owner,
    repo,
    commitSha,
  });

  // Fetch refs to get list of commits for smart navigation after deletion
  const { data: refsData } = useGetRepositoryRefsQuery({ owner, repo });

  // Callback to find next/previous commit for navigation after deletion
  const getNextTarget = useCallback(() => {
    if (!refsData?.recentCommits) return undefined;

    const commits = refsData.recentCommits;
    const currentIndex = commits.findIndex((c) => c.sha === commitSha);

    if (currentIndex === -1) return undefined;

    // If there are more commits, navigate to next one (below in list)
    // If this is the last commit, navigate to previous one (above in list)
    // If this is the only commit, return undefined (go to repo overview)
    if (commits.length <= 1) return undefined;

    if (currentIndex < commits.length - 1) {
      // Navigate to next commit (below)
      return commits[currentIndex + 1].sha;
    } else {
      // Navigate to previous commit (above)
      return commits[currentIndex - 1].sha;
    }
  }, [refsData?.recentCommits, commitSha]);

  const handleCopySha = () => {
    if (data?.commit.sha) {
      navigator.clipboard.writeText(data.commit.sha);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl">
        <div className="space-y-4">
          <div className="h-32 bg-muted rounded-lg animate-pulse" />
          <div className="h-24 bg-muted rounded-lg animate-pulse" />
          <div className="h-16 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-4xl">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">Failed to load commit details</p>
              <Button onClick={() => refetch()} variant="outline">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { commit, deployments, aliases, readmePath } = data;

  // Calculate aggregate stats from all deployments
  const totalSize = deployments.reduce((sum, d) => sum + d.totalSize, 0);
  const totalFiles = deployments.reduce((sum, d) => sum + d.fileCount, 0);
  const latestDeployment = deployments[0];

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Commit Overview"
        icon={<Package className="h-4 w-4" />}
        leftActions={leftActions}
      />
      <div className="flex-1 overflow-auto px-6 py-6 max-w-4xl space-y-4">
      {/* Commit Information */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <GitCommit className="h-5 w-5" />
              Commit Information
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
              {aliases.filter((a) => !a.isAutoPreview).length > 0 && (
                <>
                  {aliases
                    .filter((a) => !a.isAutoPreview)
                    .map((alias) => (
                      <div
                        key={alias.name}
                        className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded text-sm"
                      >
                        <Tag className="h-3 w-3" />
                        {alias.name}
                      </div>
                    ))}
                </>
              )}
              <DeleteCommitButton
                owner={owner}
                repo={repo}
                commitSha={commit.sha}
                aliases={aliases.filter((a) => !a.isAutoPreview).map((a) => a.name)}
                deploymentCount={deployments.length}
                totalSize={totalSize}
                totalFiles={totalFiles}
                onGetNextTarget={getNextTarget}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">SHA:</span>
              <code className="text-sm bg-muted px-2 py-1 rounded break-all">{commit.shortSha}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopySha}
                className="h-6 w-6 p-0"
                title="Copy full SHA"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                Branch: {commit.branch}
              </span>
            </div>

            {/* Aggregate deployment stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Total Deployments</div>
                <div className="text-lg font-semibold">{deployments.length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Total Size</div>
                <div className="text-lg font-semibold">{formatStorageSize(totalSize)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Total Files</div>
                <div className="text-lg font-semibold">{totalFiles.toLocaleString()}</div>
              </div>
            </div>

            {latestDeployment && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Latest deployment: {formatDate(latestDeployment.deployedAt)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Deployments List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Deployments ({deployments.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deployments.map((deployment, index) => (
            <div
              key={deployment.id}
              className={`p-4 rounded-lg border ${index === 0 ? 'bg-accent/50' : 'bg-muted/50'}`}
            >
              <div className="space-y-2">
                {/* Deployment header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    {deployment.description && (
                      <p className="font-medium break-words">{deployment.description}</p>
                    )}
                    {deployment.workflowName && (
                      <p className="text-sm text-muted-foreground break-words">{deployment.workflowName}</p>
                    )}
                  </div>
                  {index === 0 && (
                    <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded whitespace-nowrap flex-shrink-0">
                      Latest
                    </span>
                  )}
                </div>

                {/* Deployment stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Files:</span>
                    <span className="ml-2 font-medium">{deployment.fileCount}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <span className="ml-2 font-medium">
                      {formatStorageSize(deployment.totalSize)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Deployed:</span>
                    <span className="ml-2 font-medium">{formatDate(deployment.deployedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Aliases Section */}
      <AliasesSection aliases={aliases} />

      {/* README Preview Card */}
      {readmePath && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              README Available
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              This deployment includes a README file: <code className="text-xs">{readmePath}</code>
            </p>
            <p className="text-sm text-muted-foreground">
              Select the README file from the sidebar to view its contents.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Help Card */}
      <Card className="border-muted">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center">
            Tip: Select a file from the sidebar to view its content.
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
