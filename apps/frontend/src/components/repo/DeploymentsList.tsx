import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setSelectedBranch,
  setCurrentPage,
  setSortBy,
  setSortOrder,
  setSearchQuery,
} from '@/store/slices/repoOverviewSlice';
import { useGetDeploymentsQuery, useGetRepositoryRefsQuery } from '@/services/repoApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Package,
  Copy,
  Check,
  Search,
  X,
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';

interface DeploymentsListProps {
  owner: string;
  repo: string;
}

/**
 * DeploymentsList - Displays repository deployments with filtering, sorting, and pagination
 * Used in RepositoryOverviewPage on the Deployments tab
 */
export function DeploymentsList({ owner, repo }: DeploymentsListProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { selectedBranch, currentPage, sortBy, sortOrder, searchQuery } = useAppSelector(
    (state) => state.repoOverview,
  );
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  // Fetch deployments
  const {
    data: deploymentsData,
    isLoading: isLoadingDeployments,
    error: deploymentsError,
  } = useGetDeploymentsQuery({
    owner,
    repo,
    page: currentPage,
    limit: 20,
    branch: selectedBranch || undefined,
    sortBy,
    order: sortOrder,
  });

  // Fetch refs for branch filter
  const { data: refsData } = useGetRepositoryRefsQuery({ owner, repo });

  // Format storage size
  const formatStorageSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  // Format date with relative time
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // Handle branch filter change
  const handleBranchChange = (value: string) => {
    dispatch(setSelectedBranch(value === 'all' ? null : value));
  };

  // Handle sort change
  const handleSortChange = (value: string) => {
    dispatch(setSortBy(value as 'date' | 'branch'));
  };

  // Handle sort order toggle
  const handleSortOrderToggle = () => {
    dispatch(setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'));
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    dispatch(setCurrentPage(newPage));
  };

  // Handle copy commit SHA
  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  // Handle search query change
  const handleSearchChange = (value: string) => {
    dispatch(setSearchQuery(value));
  };

  // Clear search
  const handleClearSearch = () => {
    dispatch(setSearchQuery(''));
  };

  // Client-side filter deployments by search query
  const filteredDeployments = useMemo(() => {
    if (!deploymentsData?.deployments) return [];
    if (!searchQuery.trim()) return deploymentsData.deployments;

    const query = searchQuery.toLowerCase();
    return deploymentsData.deployments.filter((deployment) => {
      return (
        deployment.commitSha.toLowerCase().includes(query) ||
        deployment.shortSha.toLowerCase().includes(query) ||
        (deployment.description && deployment.description.toLowerCase().includes(query))
      );
    });
  }, [deploymentsData?.deployments, searchQuery]);

  // Loading state
  if (isLoadingDeployments) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Filter bar skeleton */}
            <div className="flex gap-3">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-24" />
            </div>
            {/* List skeleton */}
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (deploymentsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load deployments</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!deploymentsData || deploymentsData.deployments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium">No deployments found</p>
          {selectedBranch && (
            <p className="text-sm text-muted-foreground mt-2">
              Try selecting a different branch or clear the filter
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(deploymentsData.total / deploymentsData.limit);

  // Empty search results
  const hasNoSearchResults = searchQuery.trim() && filteredDeployments.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deployments</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filter and Sort Controls */}
        <div className="flex flex-wrap gap-3 mb-6" role="search" aria-label="Deployment filters">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="text"
              placeholder="Search by SHA or description..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 pr-8"
              aria-label="Search deployments by commit SHA or description"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-2"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* Branch Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Select value={selectedBranch || 'all'} onValueChange={handleBranchChange}>
              <SelectTrigger className="w-48" aria-label="Filter by branch">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {refsData?.branches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sort By */}
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-32" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">By Date</SelectItem>
              <SelectItem value="branch">By Branch</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort Order Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSortOrderToggle}
            className="gap-2"
            aria-label={`Sort order: ${sortBy === 'branch'
              ? sortOrder === 'asc'
                ? 'Ascending'
                : 'Descending'
              : sortOrder === 'desc'
                ? 'Newest First'
                : 'Oldest First'}`}
          >
            <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
            {sortBy === 'branch'
              ? sortOrder === 'asc'
                ? 'Ascending'
                : 'Descending'
              : sortOrder === 'desc'
                ? 'Newest First'
                : 'Oldest First'}
          </Button>
        </div>

        {/* Empty Search Results */}
        {hasNoSearchResults ? (
          <div className="p-8 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground font-medium">No deployments match your search</p>
            <p className="text-sm text-muted-foreground mt-2">
              Try a different search term or clear the search
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={handleClearSearch}>
              Clear Search
            </Button>
          </div>
        ) : (
          <>
            {/* Deployments Table */}
            <div className="space-y-2" role="table" aria-label="Deployments list">
              {/* Table Header - Desktop only */}
              <div className="hidden md:grid md:grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b" role="row">
                <div className="col-span-2" role="columnheader">Commit</div>
                <div className="col-span-2" role="columnheader">Branch</div>
                <div className="col-span-3" role="columnheader">Description</div>
                <div className="col-span-2" role="columnheader">Deployed</div>
                <div className="col-span-2" role="columnheader">Files / Size</div>
                <div className="col-span-1" role="columnheader">Actions</div>
              </div>

              {/* Deployment Rows */}
              {filteredDeployments.map((deployment) => (
            <div
              key={deployment.id}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
              role="row"
            >
              {/* Commit SHA */}
              <div className="md:col-span-2 flex items-center gap-1" role="cell">
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {deployment.shortSha}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title={copiedSha === deployment.commitSha ? 'Copied!' : 'Copy full SHA'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopySha(deployment.commitSha);
                  }}
                  aria-label={copiedSha === deployment.commitSha ? 'Copied commit SHA' : `Copy commit SHA ${deployment.shortSha}`}
                >
                  {copiedSha === deployment.commitSha ? (
                    <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                </Button>
              </div>

              {/* Branch */}
              <div className="md:col-span-2 flex items-center" role="cell">
                <span className="text-sm font-medium">{deployment.branch}</span>
              </div>

              {/* Description */}
              <div className="md:col-span-3 flex items-center" role="cell">
                <span
                  className="text-sm text-muted-foreground truncate"
                  title={deployment.description || 'No description'}
                >
                  {deployment.description || 'No description'}
                </span>
              </div>

              {/* Deployed Date */}
              <div className="md:col-span-2 flex items-center" role="cell">
                <span className="text-sm text-muted-foreground">
                  {formatDate(deployment.deployedAt)}
                </span>
              </div>

              {/* Files / Size */}
              <div className="md:col-span-2 flex items-center gap-2" role="cell">
                <span className="text-sm text-muted-foreground">{deployment.fileCount} files</span>
                <span className="text-sm text-muted-foreground" aria-hidden="true">•</span>
                <span className="text-sm text-muted-foreground">
                  {formatStorageSize(deployment.totalSize)}
                </span>
              </div>

              {/* Actions */}
              <div className="md:col-span-1 flex items-center justify-end md:justify-start" role="cell">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(`/repo/${owner}/${repo}/${deployment.commitSha}`)
                  }
                  aria-label={`View deployment ${deployment.shortSha}`}
                >
                  View
                </Button>
              </div>
            </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
          <nav className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4" aria-label="Pagination">
            {/* Page Info */}
            <div className="text-sm text-muted-foreground" aria-live="polite" aria-atomic="true">
              Page {currentPage} of {totalPages} • {deploymentsData.total} total deployments
            </div>

            {/* Pagination Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                aria-label="Go to first page"
              >
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Go to previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="text-sm px-2" aria-current="page">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="Go to next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage === totalPages}
                aria-label="Go to last page"
              >
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </nav>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
