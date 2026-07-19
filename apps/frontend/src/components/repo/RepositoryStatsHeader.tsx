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
 * RepositoryStatsHeader - Displays repository statistics
 * Shows: Total Deployments, Storage Used, Branches, and Aliases
 *
 * Below `md` the four cards collapse into one compact 2x2 strip so the tab
 * content (the reason the user navigated here) stays above the fold on phones.
 */
export function RepositoryStatsHeader({ stats }: RepositoryStatsHeaderProps) {
  const items = [
    { label: 'Deployments', icon: Package, value: String(stats.totalDeployments) },
    { label: 'Storage Used', icon: HardDrive, value: formatStorageSize(stats.totalStorageBytes) },
    { label: 'Branches', icon: GitBranch, value: String(stats.branchCount) },
    {
      label: 'Aliases',
      icon: Tag,
      value: String(stats.aliasCount),
      detail: `Last: ${formatDate(stats.lastDeployedAt)}`,
    },
  ];

  return (
    <>
      {/* Mobile: compact 2x2 strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:hidden">
        {items.map(({ label, icon: Icon, value }) => (
          <div key={label} className="flex items-center gap-2.5 bg-card px-3 py-2.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-xs text-muted-foreground">{label}</div>
              <div className="text-sm font-semibold">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: card per stat */}
      <div className="hidden gap-4 md:grid md:grid-cols-4">
        {items.map(({ label, icon: Icon, value, detail }) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
              {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
