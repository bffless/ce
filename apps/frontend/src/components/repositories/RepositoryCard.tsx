import { Link } from 'react-router-dom';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Clock } from 'lucide-react';
import { FeedRepository } from '@/services/repositoriesApi';
import { formatRelativeTime } from '@/lib/utils';
import { PermissionBadge, PermissionLevel } from './PermissionBadge';
import { VisibilityBadge } from './VisibilityBadge';
import { StorageIndicator } from './StorageIndicator';
import { ActivityBadge } from './ActivityBadge';
import { TooltipProvider } from '@/components/ui/tooltip';

interface RepositoryCardProps {
  repository: FeedRepository;
}

export function RepositoryCard({ repository }: RepositoryCardProps) {
  // Map permission type and role to PermissionLevel
  const getPermissionLevel = (): PermissionLevel | null => {
    if (repository.permissionType === 'owner') return 'owner';
    if (repository.permissionType === 'public') return null; // No permission badge for public repos

    // For direct and group permissions, map role to permission level
    const role = repository.role?.toLowerCase();
    if (role === 'admin') return 'admin';
    if (role === 'contributor') return 'contributor';
    if (role === 'viewer') return 'viewer';

    // Default to viewer if role is not recognized
    return 'viewer';
  };

  const permissionLevel = getPermissionLevel();

  return (
    <TooltipProvider>
      <Card
        className="hover:shadow-md transition-shadow"
        role="article"
        aria-label={`Repository: ${repository.owner}/${repository.name}`}
      >
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Link
                to={`/repo/${repository.owner}/${repository.name}`}
                className="text-lg font-semibold hover:underline block"
                aria-label={`View repository ${repository.owner}/${repository.name}`}
              >
                {repository.owner}/{repository.name}
              </Link>
              {repository.displayName && (
                <p className="text-sm text-muted-foreground mt-1">{repository.displayName}</p>
              )}
            </div>

            {/* Badges - separate row on mobile, same row on desktop */}
            <div className="flex gap-2 flex-wrap sm:flex-shrink-0">
              {/* Permission badge - only show if not public */}
              {permissionLevel && (
                <PermissionBadge level={permissionLevel} size="md" />
              )}
              {/* Visibility badge */}
              <VisibilityBadge isPublic={repository.isPublic} size="md" />
              {/* Activity badge */}
              <ActivityBadge lastDeployedAt={repository.stats.lastDeployedAt} />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {repository.description && (
            <p className="text-sm text-muted-foreground mb-4">{repository.description}</p>
          )}

          {/* Stats */}
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Package className="h-4 w-4" aria-hidden="true" />
              <span>
                {repository.stats.deploymentCount}{' '}
                {repository.stats.deploymentCount === 1 ? 'deployment' : 'deployments'}
              </span>
            </div>

            {/* Enhanced storage indicator with color coding */}
            <StorageIndicator storageBytes={repository.stats.storageBytes} />

            {repository.stats.lastDeployedAt && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-4 w-4" aria-hidden="true" />
                <span>Updated {formatRelativeTime(repository.stats.lastDeployedAt)}</span>
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <Button asChild variant="outline">
            <Link to={`/repo/${repository.owner}/${repository.name}`}>View Repository</Link>
          </Button>
        </CardFooter>
      </Card>
    </TooltipProvider>
  );
}
