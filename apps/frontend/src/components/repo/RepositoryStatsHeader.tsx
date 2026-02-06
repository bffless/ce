import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, HardDrive, GitBranch, Tag } from 'lucide-react';

interface RepositoryStats {
  repository: string;
  totalDeployments: number;
  totalStorageBytes: number;
  totalStorageMB: number;
  lastDeployedAt: string | null;
  branchCount: number;
  aliasCount: number;
  isPublic: boolean;
}

interface RepositoryStatsHeaderProps {
  stats: RepositoryStats;
}

/**
 * Format storage size in human-readable format (MB/GB)
 */
const formatStorageSize = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

/**
 * Format date as relative time (e.g., "2 hours ago")
 */
const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'Never';
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

/**
 * RepositoryStatsHeader - Displays repository statistics in card format
 * Shows: Total Deployments, Storage Used, Branches, and Aliases
 */
export function RepositoryStatsHeader({ stats }: RepositoryStatsHeaderProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Deployments Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Package className="h-4 w-4" />
            Deployments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalDeployments}</div>
        </CardContent>
      </Card>

      {/* Storage Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Storage Used
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatStorageSize(stats.totalStorageBytes)}
          </div>
        </CardContent>
      </Card>

      {/* Branches Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Branches
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.branchCount}</div>
        </CardContent>
      </Card>

      {/* Aliases Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Aliases
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.aliasCount}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Last: {formatDate(stats.lastDeployedAt)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
