import { AlertCircle, AlertTriangle, HardDrive, Info, TrendingUp } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetStorageUsageQuery,
  useGetUsageByProjectQuery,
  formatBytes,
  formatCurrency,
  calculateOverageCost,
} from '@/services/storageUsageApi';

/**
 * StorageUsageCard
 *
 * Displays workspace storage usage with quota information.
 * Shows alerts for near-quota and over-quota conditions.
 */
export function StorageUsageCard() {
  const { data: usage, isLoading, error } = useGetStorageUsageQuery();
  const { data: projectUsage } = useGetUsageByProjectQuery();

  if (isLoading) {
    return <StorageUsageCardSkeleton />;
  }

  if (error || !usage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Storage Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Failed to load storage usage information.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const isUnlimited = usage.overageBehavior === 'unlimited';
  const progressValue = usage.usagePercent ?? 0;
  const overageCost = calculateOverageCost(usage.overageBytes, usage.overagePricePerGb);

  // Determine progress bar color based on usage
  const getProgressColor = () => {
    if (usage.isOverQuota) return 'bg-destructive';
    if (usage.isNearQuota) return 'bg-yellow-500';
    return 'bg-primary';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Storage Usage
        </CardTitle>
        <CardDescription>
          {isUnlimited
            ? 'No storage quota configured'
            : `${formatBytes(usage.totalBytes)} of ${formatBytes(usage.quotaBytes!)} used`}
          {usage.planName && (
            <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {usage.planName}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Bar */}
        {!isUnlimited && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {usage.usagePercent?.toFixed(1)}% used
              </span>
              <span className="text-muted-foreground">
                {formatBytes(usage.quotaBytes! - usage.totalBytes)} remaining
              </span>
            </div>
            <Progress
              value={Math.min(progressValue, 100)}
              className={`h-3 [&>[role=progressbar]]:${getProgressColor()}`}
            />
          </div>
        )}

        {/* Unlimited Storage Info */}
        {isUnlimited && (
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Unlimited Storage</p>
              <p className="text-sm text-muted-foreground">
                {usage.assetCount.toLocaleString()} assets using{' '}
                {formatBytes(usage.totalBytes)}
              </p>
            </div>
          </div>
        )}

        {/* Near Quota Warning */}
        {usage.isNearQuota && !usage.isOverQuota && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Approaching Storage Limit</AlertTitle>
            <AlertDescription>
              You&apos;ve used {usage.usagePercent?.toFixed(1)}% of your storage quota.
              {usage.overageBehavior === 'block' && (
                <span>
                  {' '}
                  Uploads will be blocked when you reach 100%.
                </span>
              )}
              {usage.overageBehavior === 'charge' && usage.overagePricePerGb && (
                <span>
                  {' '}
                  Overage will be billed at{' '}
                  {formatCurrency(usage.overagePricePerGb)}/GB.
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Over Quota Alert */}
        {usage.isOverQuota && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {usage.overageBehavior === 'block'
                ? 'Storage Quota Exceeded'
                : 'Storage Overage'}
            </AlertTitle>
            <AlertDescription>
              {usage.overageBehavior === 'block' ? (
                <span>
                  You&apos;ve exceeded your storage quota by{' '}
                  {formatBytes(usage.overageBytes)}. New uploads are blocked
                  until you free up space.
                </span>
              ) : (
                <span>
                  You&apos;re {formatBytes(usage.overageBytes)} over your quota.
                  {overageCost !== null && (
                    <span className="font-medium">
                      {' '}
                      Estimated overage charge: {formatCurrency(overageCost)}
                    </span>
                  )}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Usage Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Size</p>
            <p className="text-2xl font-semibold">{formatBytes(usage.totalBytes)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Assets</p>
            <p className="text-2xl font-semibold">
              {usage.assetCount.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Project Breakdown */}
        {projectUsage && projectUsage.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              By Project
            </h4>
            <div className="space-y-2">
              {projectUsage.slice(0, 5).map((project) => (
                <div
                  key={project.projectId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate max-w-[200px]">
                    {project.owner}/{project.projectName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {formatBytes(project.totalBytes)}
                    </span>
                    <span className="text-xs text-muted-foreground w-12 text-right">
                      {project.percentOfTotal.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
              {projectUsage.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  +{projectUsage.length - 5} more projects
                </p>
              )}
            </div>
          </div>
        )}

        {/* Plan Info */}
        {!isUnlimited && usage.overagePricePerGb && (
          <div className="text-sm text-muted-foreground border-t pt-4">
            {usage.overageBehavior === 'charge' ? (
              <span>
                Overage billed at {formatCurrency(usage.overagePricePerGb)}/GB
              </span>
            ) : (
              <span>Uploads will be blocked when quota is exceeded</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Loading skeleton for StorageUsageCard
 */
function StorageUsageCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-3 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StorageUsageCard;
