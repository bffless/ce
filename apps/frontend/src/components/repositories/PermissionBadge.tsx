import { Crown, Shield, Edit, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Permission level descriptions
const PERMISSION_DESCRIPTIONS = {
  owner: 'You own this repository and have full control',
  admin: 'You can manage settings, permissions, and content',
  contributor: 'You can create and manage deployments',
  viewer: 'You can view deployments and files',
} as const;

// Permission badge configuration
const PERMISSION_CONFIG = {
  owner: {
    icon: Crown,
    color: 'bg-green-500 text-white border-green-600 hover:bg-green-600',
    label: 'Owner',
  },
  admin: {
    icon: Shield,
    color: 'bg-blue-500 text-white border-blue-600 hover:bg-blue-600',
    label: 'Admin',
  },
  contributor: {
    icon: Edit,
    color: 'bg-purple-500 text-white border-purple-600 hover:bg-purple-600',
    label: 'Contributor',
  },
  viewer: {
    icon: Eye,
    color: 'bg-gray-500 text-white border-gray-600 hover:bg-gray-600',
    label: 'Viewer',
  },
} as const;

export type PermissionLevel = keyof typeof PERMISSION_CONFIG;

interface PermissionBadgeProps {
  level: PermissionLevel;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
  showTooltip?: boolean;
  className?: string;
}

/**
 * Permission badge component with icons and tooltips
 * Displays user's permission level for a repository
 */
export function PermissionBadge({
  level,
  size = 'md',
  iconOnly = false,
  showTooltip = true,
  className,
}: PermissionBadgeProps) {
  const config = PERMISSION_CONFIG[level];
  const Icon = config.icon;

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const badgeSize = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2.5 py-0.5';

  const badgeContent = (
    <Badge
      className={cn(
        'inline-flex items-center gap-1 border',
        config.color,
        badgeSize,
        className
      )}
    >
      <Icon className={iconSize} />
      {!iconOnly && <span>{config.label}</span>}
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
        <p className="max-w-xs">{PERMISSION_DESCRIPTIONS[level]}</p>
      </TooltipContent>
    </Tooltip>
  );
}
