import { useState, useMemo, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track pending blur to allow clicking dropdown items
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Don't show suggestions if no alias selected or no directories
  const showSuggestions = Boolean(alias) && directories.length > 0;
  const shouldShowDropdown = open && showSuggestions && filteredDirectories.length > 0;

  // Cancel any pending blur timeout
  const cancelBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    // Open dropdown when typing if there are suggestions
    if (showSuggestions) {
      setOpen(true);
    }
  };

  // Handle directory selection
  const handleSelect = (dir: string) => {
    cancelBlurTimeout();
    onChange(dir);
    setOpen(false);
    // Return focus to input after selection
    inputRef.current?.focus();
  };

  // Handle focus - open dropdown if there are suggestions
  const handleFocus = () => {
    cancelBlurTimeout();
    if (showSuggestions && filteredDirectories.length > 0) {
      setOpen(true);
    }
  };

  // Handle blur - close dropdown with delay to allow clicking items
  const handleBlur = (e: React.FocusEvent) => {
    // Check if focus is moving to something within our container
    const relatedTarget = e.relatedTarget as Node | null;
    if (containerRef.current?.contains(relatedTarget)) {
      // Focus is staying within our component, don't close
      return;
    }
    // Delay closing to allow click events on dropdown items to fire
    blurTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  // Handle keydown for escape and arrow navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    }
  };

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {isLoading && alias && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {shouldShowDropdown && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
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
                      onMouseDown={(e) => {
                        // Prevent blur from firing before click
                        e.preventDefault();
                      }}
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
        </div>
      )}
    </div>
  );
}
