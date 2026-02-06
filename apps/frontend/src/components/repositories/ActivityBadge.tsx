import { differenceInDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/lib/utils';

interface ActivityBadgeProps {
  lastDeployedAt: string | null;
  showTooltip?: boolean;
  className?: string;
}

/**
 * Activity badge showing deployment recency
 * - Active (green): Deployed within last 7 days
 * - Inactive (gray): Deployed more than 7 days ago
 */
export function ActivityBadge({
  lastDeployedAt,
  showTooltip = true,
  className,
}: ActivityBadgeProps) {
  if (!lastDeployedAt) {
    return null;
  }

  const daysSinceDeployment = differenceInDays(
    new Date(),
    new Date(lastDeployedAt)
  );
  const isActive = daysSinceDeployment < 7;

  const badgeContent = (
    <Badge
      variant={isActive ? 'default' : 'secondary'}
      className={className}
    >
      <span className={isActive ? 'text-green-500' : 'text-gray-500'}>
        {isActive ? '●' : '○'}
      </span>
      <span className="ml-1">{isActive ? 'Active' : 'Inactive'}</span>
    </Badge>
  );

  if (!showTooltip) {
    return badgeContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          {badgeContent}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1">
          <p className="font-semibold">
            {isActive ? 'Recently active' : 'Not recently active'}
          </p>
          <p className="text-xs text-muted-foreground">
            Last deployed {formatRelativeTime(lastDeployedAt)}
          </p>
          <p className="text-xs text-muted-foreground">
            {daysSinceDeployment === 0
              ? 'Today'
              : `${daysSinceDeployment} ${daysSinceDeployment === 1 ? 'day' : 'days'} ago`}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
