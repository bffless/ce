import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useGetRepositoryRefsQuery } from '@/services/repoApi';
import type { CommitRef, AliasRef, BranchRef } from '@/services/repoApi';

interface UseInfiniteCommitsOptions {
  owner: string;
  repo: string;
  limit?: number;
}

interface UseInfiniteCommitsResult {
  commits: CommitRef[];
  aliases: AliasRef[];
  branches: BranchRef[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  total: number;
  loadMore: () => void;
  error: unknown;
}

export function useInfiniteCommits({
  owner,
  repo,
  limit = 50,
}: UseInfiniteCommitsOptions): UseInfiniteCommitsResult {
  // Track additional pages loaded beyond the first
  const [additionalCommits, setAdditionalCommits] = useState<CommitRef[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Track previous owner/repo to detect changes
  const prevOwnerRepoRef = useRef<string>(`${owner}/${repo}`);

  // Track if this is the first page load
  const isFirstPage = currentCursor === undefined;

  // Fetch current page
  const { data, isLoading, isFetching, error } = useGetRepositoryRefsQuery(
    { owner, repo, cursor: currentCursor, limit },
    { skip: false }
  );

  // Reset state when owner/repo changes
  useEffect(() => {
    const currentKey = `${owner}/${repo}`;
    if (prevOwnerRepoRef.current !== currentKey) {
      prevOwnerRepoRef.current = currentKey;
      setAdditionalCommits([]);
      setCurrentCursor(undefined);
      setIsLoadingMore(false);
    }
  }, [owner, repo]);

  // Process additional pages when cursor changes and data arrives
  useEffect(() => {
    // Only process if we're loading additional pages (not the first page)
    if (!currentCursor || !data?.recentCommits) return;

    // Append new commits (avoid duplicates)
    setAdditionalCommits((prev) => {
      const existingShas = new Set(prev.map((c) => c.sha));
      const newCommits = data.recentCommits.filter(
        (c) => !existingShas.has(c.sha)
      );
      if (newCommits.length === 0) return prev;
      return [...prev, ...newCommits];
    });

    setIsLoadingMore(false);
  }, [currentCursor, data?.recentCommits]);

  // Combine first page (from RTK Query cache) with additional loaded pages
  const allCommits = useMemo(() => {
    const firstPageCommits = data?.recentCommits ?? [];
    if (additionalCommits.length === 0) {
      return firstPageCommits;
    }
    // Merge first page with additional commits, avoiding duplicates
    const firstPageShas = new Set(firstPageCommits.map((c) => c.sha));
    const uniqueAdditional = additionalCommits.filter(
      (c) => !firstPageShas.has(c.sha)
    );
    return [...firstPageCommits, ...uniqueAdditional];
  }, [data?.recentCommits, additionalCommits]);

  // Load more handler
  const loadMore = useCallback(() => {
    if (!data?.pagination.hasMore || !data?.pagination.nextCursor || isLoadingMore || isFetching) {
      return;
    }
    setIsLoadingMore(true);
    setCurrentCursor(data.pagination.nextCursor);
  }, [data?.pagination, isLoadingMore, isFetching]);

  return {
    commits: allCommits,
    aliases: data?.aliases ?? [],
    branches: data?.branches ?? [],
    isLoading: isLoading && isFirstPage,
    isLoadingMore: isLoadingMore || (isFetching && !isFirstPage),
    hasMore: data?.pagination.hasMore ?? false,
    total: data?.pagination.total ?? 0,
    loadMore,
    error,
  };
}
