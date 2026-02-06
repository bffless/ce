import { useCallback, useRef, useMemo } from 'react';
import { FixedSizeList as List, ListChildComponentProps, ListOnScrollProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { CommitGraphRow, ROW_HEIGHT } from './CommitGraphRow';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommitNode } from './types';
import type { AliasRef } from '@/services/repoApi';

interface CommitGraphProps {
  commits: CommitNode[];
  currentRef: string;
  onSelect: (sha: string) => void;
  aliases?: AliasRef[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

interface ItemData {
  commits: CommitNode[];
  currentRef: string;
  onSelect: (sha: string) => void;
  aliasMap: Map<string, string>;
}

const LOAD_MORE_THRESHOLD = ROW_HEIGHT * 5;

export function CommitGraph({
  commits,
  currentRef,
  onSelect,
  aliases = [],
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: CommitGraphProps) {
  const listRef = useRef<List>(null);

  const itemCount = commits.length + (isLoadingMore ? 1 : 0);

  // Create a map from commit SHA to alias name (excluding auto-preview aliases)
  const aliasMap = useMemo(() => {
    const map = new Map<string, string>();
    aliases
      .filter((alias) => !alias.isAutoPreview)
      .forEach((alias) => {
        map.set(alias.commitSha, alias.name);
      });
    return map;
  }, [aliases]);

  const itemData: ItemData = {
    commits,
    currentRef,
    onSelect,
    aliasMap,
  };

  const handleScroll = useCallback(
    ({ scrollOffset, scrollDirection }: ListOnScrollProps) => {
      if (!hasMore || isLoadingMore || !onLoadMore) return;
      if (scrollDirection !== 'forward') return;

      const listElement = listRef.current;
      if (!listElement) return;

      const outerElement = (listElement as unknown as { _outerRef: HTMLElement })._outerRef;
      const listHeight = outerElement?.clientHeight ?? 0;
      const totalHeight = commits.length * ROW_HEIGHT;
      const scrollBottom = scrollOffset + listHeight;
      const distanceFromEnd = totalHeight - scrollBottom;

      if (distanceFromEnd < LOAD_MORE_THRESHOLD) {
        onLoadMore();
      }
    },
    [hasMore, isLoadingMore, onLoadMore, commits.length]
  );

  const Row = useCallback(
    ({ index, style, data }: ListChildComponentProps<ItemData>) => {
      const { commits, currentRef, onSelect, aliasMap } = data;

      if (index >= commits.length) {
        return (
          <div style={style} className="flex items-center px-3 gap-3">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
          </div>
        );
      }

      const commit = commits[index];
      const aliasName = aliasMap.get(commit.sha);

      return (
        <CommitGraphRow
          key={commit.sha}
          style={style}
          commit={commit}
          isSelected={currentRef === commit.sha}
          onSelect={onSelect}
          aliasName={aliasName}
        />
      );
    },
    []
  );

  if (commits.length === 0) {
    return null;
  }

  const selectedCommitSha = commits.find((c) => c.sha === currentRef)?.sha;

  return (
    <div
      className="h-full"
      role="listbox"
      aria-label="Commit history"
      aria-activedescendant={selectedCommitSha ? `commit-${selectedCommitSha}` : undefined}
    >
      <AutoSizer>
        {({ height, width }) => (
          <List
            ref={listRef}
            height={height}
            width={width}
            itemCount={itemCount}
            itemSize={ROW_HEIGHT}
            itemData={itemData}
            overscanCount={5}
            onScroll={handleScroll}
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  );
}
