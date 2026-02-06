import { Globe, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface VisibilityBadgeProps {
  isPublic: boolean;
  size?: 'sm' | 'md';
  showTooltip?: boolean;
  className?: string;
}

/**
 * Visibility badge component showing public/private status
 * Used in repository cards to indicate access level
 */
export function VisibilityBadge({
  isPublic,
  size = 'md',
  showTooltip = true,
  className,
}: VisibilityBadgeProps) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const badgeSize = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2.5 py-0.5';

  const Icon = isPublic ? Globe : Lock;
  const label = isPublic ? 'Public' : 'Private';
  const description = isPublic
    ? 'This repository is publicly accessible to everyone'
    : 'This repository is private and requires permission to access';

  const badgeContent = (
    <Badge
      variant={isPublic ? 'outline' : 'secondary'}
      className={cn('inline-flex items-center gap-1', badgeSize, className)}
    >
      <Icon className={iconSize} />
      <span>{label}</span>
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
        <p className="max-w-xs">{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
