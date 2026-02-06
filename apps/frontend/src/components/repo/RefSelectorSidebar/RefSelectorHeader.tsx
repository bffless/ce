import { useRef, useEffect, useCallback, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X, PanelRightClose } from 'lucide-react';

interface RefSelectorHeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

export function RefSelectorHeader({
  searchQuery,
  onSearchChange,
  onClose,
  searchInputRef: externalRef,
}: RefSelectorHeaderProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const searchInputRef = externalRef ?? internalRef;

  // Focus search on mount
  useEffect(() => {
    // Small delay to ensure sidebar animation completes
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [searchInputRef]);

  // Handle clear search
  const handleClearSearch = useCallback(() => {
    onSearchChange('');
    searchInputRef.current?.focus();
  }, [onSearchChange, searchInputRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Clear search on Escape (if search is focused)
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (searchQuery) {
          handleClearSearch();
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, handleClearSearch, onClose, searchInputRef]);

  return (
    <div className="border-b">
      {/* Title bar */}
      <div className="px-2 h-11 flex items-center justify-between shrink-0">
        <h2 className="text-lg font-semibold" id="ref-selector-title">References</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0 shrink-0"
          title="Close references panel"
          aria-label="Close references panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Search input */}
      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            type="search"
            placeholder="Search refs..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 pr-8"
            data-ref-selector-search
            aria-label="Search references"
            autoComplete="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
