import { formatDistanceToNow } from 'date-fns';
import { Tag, GitBranch, GitCommit, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RefListItemProps {
  type: 'alias' | 'branch' | 'commit';
  name: string;
  sha: string;
  description?: string | null;
  branch?: string;
  date?: string;
  fileCount?: number;
  isSelected: boolean;
  onClick: () => void;
}

export function RefListItem({
  type,
  name,
  sha,
  description,
  branch,
  date,
  fileCount,
  isSelected,
  onClick,
}: RefListItemProps) {
  const Icon = type === 'alias' ? Tag : type === 'branch' ? GitBranch : GitCommit;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 p-2 rounded-md text-left transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent'
      )}
    >
      {/* Icon */}
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name row */}
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            'font-medium truncate',
            type === 'commit' && 'font-mono text-sm'
          )}>
            {name}
          </span>

          {/* Right side info */}
          <div className="flex items-center gap-2 shrink-0">
            {fileCount !== undefined && (
              <span className="text-xs text-muted-foreground">
                {fileCount} files
              </span>
            )}
            {date && (
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(date), { addSuffix: true })}
              </span>
            )}
            {isSelected && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </div>
        </div>

        {/* Secondary info */}
        {type !== 'commit' && (
          <span className="text-xs text-muted-foreground font-mono">
            {sha.substring(0, 7)}
          </span>
        )}

        {/* Commit-specific info */}
        {type === 'commit' && (
          <>
            {branch && (
              <div className="text-xs text-muted-foreground truncate">
                {branch}
              </div>
            )}
            {description && (
              <div className="text-xs text-muted-foreground truncate">
                {description.length > 50
                  ? description.substring(0, 50) + '...'
                  : description}
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}
