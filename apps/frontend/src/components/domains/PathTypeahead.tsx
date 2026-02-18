import { useState, useMemo, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useGetFileTreeQuery } from '@/services/repoApi';
import { Folder, Loader2 } from 'lucide-react';

interface PathTypeaheadProps {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Selected alias or commit SHA */
  alias: string;
  /** Current path value */
  value: string;
  /** Callback when path changes */
  onChange: (path: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Input id for label association */
  id?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
}

/**
 * Extract unique directory paths from a list of file paths.
 * For each file, extracts all parent directories.
 * e.g., /apps/frontend/dist/index.html -> ["/apps", "/apps/frontend", "/apps/frontend/dist"]
 */
function extractDirectories(files: { path: string }[]): string[] {
  const directories = new Set<string>();

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    // Build up directory paths from root
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      // Exclude the last part (filename)
      currentPath += '/' + parts[i];
      directories.add(currentPath);
    }
  }

  // Sort alphabetically
  return Array.from(directories).sort();
}

export function PathTypeahead({
  owner,
  repo,
  alias,
  value,
  onChange,
  placeholder = '/dist or leave empty for root',
  id,
  disabled = false,
}: PathTypeaheadProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch file tree when alias is provided
  const { data: fileTree, isLoading } = useGetFileTreeQuery(
    { owner, repo, commitSha: alias },
    { skip: !owner || !repo || !alias }
  );

  // Extract directories from file tree
  const directories = useMemo(() => {
    if (!fileTree?.files) return [];
    return extractDirectories(fileTree.files);
  }, [fileTree]);

  // Filter directories based on current input
  const filteredDirectories = useMemo(() => {
    if (!value) return directories;
    const lowerValue = value.toLowerCase();
    return directories.filter((dir) => dir.toLowerCase().includes(lowerValue));
  }, [directories, value]);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    // Open popover when typing
    if (newValue && filteredDirectories.length > 0) {
      setOpen(true);
    }
  };

  // Handle directory selection
  const handleSelect = (dir: string) => {
    onChange(dir);
    setOpen(false);
    inputRef.current?.focus();
  };

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Don't show suggestions if no alias selected or no directories
  const showSuggestions = Boolean(alias) && directories.length > 0;

  return (
    <Popover open={open && showSuggestions} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            id={id}
            value={value}
            onChange={handleInputChange}
            onFocus={() => showSuggestions && filteredDirectories.length > 0 && setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
          />
          {isLoading && alias && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandList>
            {filteredDirectories.length === 0 ? (
              <CommandEmpty>No matching directories</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredDirectories.slice(0, 10).map((dir) => (
                  <CommandItem
                    key={dir}
                    value={dir}
                    onSelect={() => handleSelect(dir)}
                  >
                    <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-sm">{dir}</span>
                  </CommandItem>
                ))}
                {filteredDirectories.length > 10 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    +{filteredDirectories.length - 10} more directories
                  </div>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
