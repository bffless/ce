import { useEffect, useRef, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFeedSearch } from '@/store/slices/repositoryListSlice';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export function GlobalSearchBar() {
  const dispatch = useAppDispatch();
  const feedSearch = useAppSelector((state) => state.repositoryList.feedSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  // Local state for immediate UI update
  const [localSearch, setLocalSearch] = useState(feedSearch);

  // Debounced value for API call
  const debouncedSearch = useDebouncedValue(localSearch, 300);

  // Update Redux when debounced value changes
  useEffect(() => {
    dispatch(setFeedSearch(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  // Sync local state with Redux state when it changes externally
  useEffect(() => {
    setLocalSearch(feedSearch);
  }, [feedSearch]);

  // Keyboard shortcut: '/' to focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        // Don't trigger if already focused on an input
        if (document.activeElement?.tagName === 'INPUT') {
          return;
        }
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClear = () => {
    setLocalSearch('');
    dispatch(setFeedSearch(''));
    inputRef.current?.focus();
  };

  // Handle Escape key to clear search
  useEffect(() => {
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && localSearch && document.activeElement === inputRef.current) {
        handleClear();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [localSearch]);

  return (
    <div className="relative max-w-xl" role="search">
      <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={inputRef}
        type="search"
        placeholder="Search all repositories... (press / to focus)"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        className="pl-10 pr-10"
        aria-label="Search repositories by name, owner, or description"
        role="searchbox"
      />
      {localSearch && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-2.5 hover:opacity-70 transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center -m-2"
          aria-label="Clear search"
          type="button"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
