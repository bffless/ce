import { CSSProperties, memo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { GitBranch, Tag, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GraphNode } from './GraphNode';
import { getBranchColor } from './branchColors';
import type { CommitNode } from './types';

export const ROW_HEIGHT = 52;

interface CommitGraphRowProps {
  style: CSSProperties;
  commit: CommitNode;
  isSelected: boolean;
  onSelect: (sha: string) => void;
  aliasName?: string;
}

export const CommitGraphRow = memo(function CommitGraphRow({
  style,
  commit,
  isSelected,
  onSelect,
  aliasName,
}: CommitGraphRowProps) {
  const branchColor = getBranchColor(commit.branch);

  return (
    <button
      type="button"
      id={`commit-${commit.sha}`}
      style={style}
      className={cn(
        'flex items-center gap-3 cursor-pointer transition-colors group w-full text-left px-3',
        'focus:bg-accent focus:outline-none',
        isSelected ? 'bg-accent' : 'hover:bg-accent/50'
      )}
      onClick={() => onSelect(commit.sha)}
      role="option"
      aria-selected={isSelected}
      aria-label={`Commit ${commit.shortSha} on ${commit.branch}: ${commit.description || 'No message'}${aliasName ? `, alias: ${aliasName}` : ''}`}
    >
      {/* Colored circle */}
      <div className="shrink-0 w-6 flex justify-center" aria-hidden="true">
        <GraphNode color={branchColor} isSelected={isSelected} />
      </div>

      {/* SHA */}
      <code className="shrink-0 font-mono text-sm font-semibold w-14">
        {commit.shortSha}
      </code>

      {/* Branch badge */}
      <div
        className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
        style={{ backgroundColor: `${branchColor}20`, color: branchColor }}
      >
        <GitBranch className="h-3 w-3" />
        <span className="truncate max-w-[60px]">{commit.branch}</span>
      </div>

      {/* Alias badge (only if alias points to this commit) */}
      {aliasName && (
        <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary">
          <Tag className="h-3 w-3" />
          <span className="truncate max-w-[60px]">{aliasName}</span>
        </div>
      )}

      {/* Message */}
      <span className="flex-1 text-sm text-muted-foreground truncate">
        {commit.description || 'No message'}
      </span>

      {/* Date */}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(commit.deployedAt), { addSuffix: true })}
      </span>

      {/* Selected indicator */}
      {isSelected && <Check className="shrink-0 h-4 w-4 text-primary" aria-hidden="true" />}
    </button>
  );
});
