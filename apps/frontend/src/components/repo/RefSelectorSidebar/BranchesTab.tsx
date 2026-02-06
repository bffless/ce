import { GitBranch, Check, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BranchRef } from '@/services/repoApi';

interface BranchesTabProps {
  branches: BranchRef[];
  currentRef: string;
  searchQuery: string;
  onSelect: (sha: string) => void;
}

export function BranchesTab({
  branches,
  currentRef,
  searchQuery,
  onSelect,
}: BranchesTabProps) {

  // Empty state
  if (branches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium mb-1">No Branches</h3>
        <p className="text-sm text-muted-foreground">
          {searchQuery
            ? `No branches match "${searchQuery}"`
            : 'No branch deployments found.'}
        </p>
      </div>
    );
  }

  // Sort: main/master first, then alphabetically
  const sortedBranches = [...branches].sort((a, b) => {
    if (a.name === 'main' || a.name === 'master') return -1;
    if (b.name === 'main' || b.name === 'master') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div
      role="listbox"
      aria-label="Git branches"
      className="p-2 space-y-1"
    >
      {sortedBranches.map((branch) => {
        const isSelected = currentRef === branch.latestCommit || currentRef === branch.name;
        const isMainBranch = branch.name === 'main' || branch.name === 'master';

        return (
          <button
            key={branch.name}
            id={`branch-${branch.name}`}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(branch.latestCommit)}
            className={cn(
              'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors',
              'hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-primary group',
              isSelected && 'bg-accent ring-1 ring-primary'
            )}
            aria-label={`Branch ${branch.name}, ${branch.fileCount} files${isSelected ? ', currently selected' : ''}`}
          >
            {/* Icon */}
            <div className={cn(
              'mt-0.5 p-1.5 rounded-md',
              isSelected ? 'bg-primary text-primary-foreground' :
              isMainBranch ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
              'bg-muted'
            )} aria-hidden="true">
              <GitBranch className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'font-semibold truncate',
                  isMainBranch && 'text-green-600 dark:text-green-400'
                )}>
                  {branch.name}
                </span>
                {isSelected && (
                  <Check className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                )}
              </div>

              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs text-muted-foreground font-mono">
                  {branch.latestCommit.substring(0, 7)}
                </code>
                <span className="text-xs text-muted-foreground" aria-hidden="true">•</span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  {branch.fileCount} files
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
