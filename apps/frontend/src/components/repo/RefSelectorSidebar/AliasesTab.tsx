import { formatDistanceToNow } from 'date-fns';
import { Tag, Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AliasRef } from '@/services/repoApi';

interface AliasesTabProps {
  aliases: AliasRef[];
  currentRef: string;
  searchQuery: string;
  onSelect: (sha: string) => void;
}

export function AliasesTab({
  aliases,
  currentRef,
  searchQuery,
  onSelect,
}: AliasesTabProps) {

  // Empty state
  if (aliases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <Tag className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium mb-1">No Aliases</h3>
        <p className="text-sm text-muted-foreground">
          {searchQuery
            ? `No aliases match "${searchQuery}"`
            : 'No deployment aliases have been created yet.'}
        </p>
        {!searchQuery && (
          <p className="text-xs text-muted-foreground mt-2">
            Create aliases like "production" or "staging" to pin specific versions.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Deployment aliases"
      className="p-2 space-y-1"
    >
      {aliases.map((alias) => {
        const isSelected = currentRef === alias.commitSha || currentRef === alias.name;

        return (
          <button
            key={alias.name}
            id={`alias-${alias.name}`}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(alias.commitSha)}
            className={cn(
              'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors',
              'hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-primary group',
              isSelected && 'bg-accent ring-1 ring-primary'
            )}
            aria-label={`Alias ${alias.name}, commit ${alias.commitSha.substring(0, 7)}${isSelected ? ', currently selected' : ''}`}
          >
            {/* Icon */}
            <div className={cn(
              'mt-0.5 p-1.5 rounded-md',
              isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'
            )} aria-hidden="true">
              <Tag className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">{alias.name}</span>
                {isSelected && (
                  <Check className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                )}
              </div>

              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs text-muted-foreground font-mono">
                  {alias.commitSha.substring(0, 7)}
                </code>
                <span className="text-xs text-muted-foreground" aria-hidden="true">•</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(alias.updatedAt), { addSuffix: true })}
                </span>
              </div>
            </div>

            {/* Link icon on hover */}
            <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
