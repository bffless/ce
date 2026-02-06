import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, GitBranch, GitCommit, Tag } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useGetRepositoryRefsQuery } from '@/services/repoApi';

interface RefSelectorProps {
  owner: string;
  repo: string;
  currentRef?: string;
  currentFilePath?: string;
  onRefChange?: (newRef: string) => void;
}

export function RefSelector({
  owner,
  repo,
  currentRef,
  currentFilePath,
  onRefChange,
}: RefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  // Fetch repository refs
  const { data: refsData, isLoading } = useGetRepositoryRefsQuery({
    owner,
    repo,
  });

  // Determine the display label for the current ref
  const currentRefLabel = useMemo(() => {
    if (!currentRef || !refsData) return 'Select ref...';

    // Check if it's an alias
    const alias = refsData.aliases.find((a) => a.commitSha === currentRef || a.name === currentRef);
    if (alias) return alias.name;

    // Check if it's a branch
    const branch = refsData.branches.find(
      (b) => b.latestCommit === currentRef || b.name === currentRef,
    );
    if (branch) return branch.name;

    // Check if it's a commit
    const commit = refsData.recentCommits.find((c) => c.sha === currentRef);
    if (commit) return commit.shortSha;

    // Fallback: show shortened SHA
    return currentRef.substring(0, 7);
  }, [currentRef, refsData]);

  // Determine ref type for icon
  const currentRefType = useMemo(() => {
    if (!currentRef || !refsData) return 'unknown';

    const alias = refsData.aliases.find((a) => a.commitSha === currentRef || a.name === currentRef);
    if (alias) return 'alias';

    const branch = refsData.branches.find(
      (b) => b.latestCommit === currentRef || b.name === currentRef,
    );
    if (branch) return 'branch';

    return 'commit';
  }, [currentRef, refsData]);

  // Handle ref selection
  const handleSelectRef = (refValue: string) => {
    setOpen(false);

    // Call optional callback
    if (onRefChange) {
      onRefChange(refValue);
      return;
    }

    // Default behavior: navigate to new ref, preserving file path if possible
    if (currentFilePath) {
      navigate(`/repo/${owner}/${repo}/${refValue}/${currentFilePath}`);
    } else {
      navigate(`/repo/${owner}/${repo}/${refValue}`);
    }
  };

  // Filter refs based on search query
  const filteredAliases = useMemo(() => {
    if (!refsData?.aliases) return [];
    if (!searchQuery) return refsData.aliases;
    const query = searchQuery.toLowerCase();
    return refsData.aliases.filter((alias) => alias.name.toLowerCase().includes(query));
  }, [refsData?.aliases, searchQuery]);

  const filteredBranches = useMemo(() => {
    if (!refsData?.branches) return [];
    if (!searchQuery) return refsData.branches;
    const query = searchQuery.toLowerCase();
    return refsData.branches.filter((branch) => branch.name.toLowerCase().includes(query));
  }, [refsData?.branches, searchQuery]);

  const filteredCommits = useMemo(() => {
    if (!refsData?.recentCommits) return [];
    if (!searchQuery) return refsData.recentCommits;
    const query = searchQuery.toLowerCase();
    return refsData.recentCommits.filter(
      (commit) =>
        commit.shortSha.toLowerCase().includes(query) ||
        commit.sha.toLowerCase().includes(query) ||
        commit.branch.toLowerCase().includes(query),
    );
  }, [refsData?.recentCommits, searchQuery]);

  // Get icon for current ref type
  const getCurrentRefIcon = () => {
    if (currentRefType === 'alias') return <Tag className="h-3.5 w-3.5 mr-1.5" />;
    if (currentRefType === 'branch') return <GitBranch className="h-3.5 w-3.5 mr-1.5" />;
    return <GitCommit className="h-3.5 w-3.5 mr-1.5" />;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select repository reference"
          className="justify-between min-w-[180px] h-8 text-xs font-mono"
          disabled={isLoading}
        >
          <div className="flex items-center truncate">
            {getCurrentRefIcon()}
            <span className="truncate">{isLoading ? 'Loading...' : currentRefLabel}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search refs..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No references found.</CommandEmpty>

            {/* Aliases */}
            {filteredAliases.length > 0 && (
              <CommandGroup heading="Aliases">
                {filteredAliases.map((alias) => (
                  <CommandItem
                    key={`alias-${alias.name}`}
                    value={alias.commitSha}
                    onSelect={() => handleSelectRef(alias.commitSha)}
                  >
                    <Tag className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{alias.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatDistanceToNow(new Date(alias.updatedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        {alias.commitSha.substring(0, 7)}
                      </span>
                    </div>
                    <Check
                      className={cn(
                        'ml-2 h-4 w-4',
                        currentRef === alias.commitSha || currentRef === alias.name
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Branches */}
            {filteredBranches.length > 0 && (
              <CommandGroup heading="Branches">
                {filteredBranches.map((branch) => (
                  <CommandItem
                    key={`branch-${branch.name}`}
                    value={branch.latestCommit}
                    onSelect={() => handleSelectRef(branch.latestCommit)}
                  >
                    <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{branch.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {branch.fileCount} files
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        {branch.latestCommit.substring(0, 7)}
                      </span>
                    </div>
                    <Check
                      className={cn(
                        'ml-2 h-4 w-4',
                        currentRef === branch.latestCommit || currentRef === branch.name
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Recent Commits */}
            {filteredCommits.length > 0 && (
              <CommandGroup heading="Recent Commits">
                {filteredCommits.map((commit) => (
                  <CommandItem
                    key={`commit-${commit.sha}`}
                    value={commit.sha}
                    onSelect={() => handleSelectRef(commit.sha)}
                  >
                    <GitCommit className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-medium">{commit.shortSha}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatDistanceToNow(new Date(commit.deployedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{commit.branch}</div>
                      {commit.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {commit.description.length > 25
                            ? commit.description.substring(0, 25) + '...'
                            : commit.description}
                        </div>
                      )}
                    </div>
                    <Check
                      className={cn(
                        'ml-2 h-4 w-4',
                        currentRef === commit.sha ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
