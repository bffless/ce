import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useListAliasesQuery,
  useGetAliasVisibilityQuery,
  useUpdateAliasVisibilityMutation,
  type AliasDetail,
} from '@/services/repoApi';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tag, Pencil, Trash2, Plus, Eye, Globe, Lock, ArrowDown, ChevronDown } from 'lucide-react';
import { CreateAliasDialog } from './CreateAliasDialog';
import { UpdateAliasDialog } from './UpdateAliasDialog';
import { DeleteAliasDialog } from './DeleteAliasDialog';
import { useToast } from '@/hooks/use-toast';

interface AliasesTabProps {
  owner: string;
  repo: string;
}

// Separate component for alias row with visibility controls
interface AliasRowProps {
  alias: AliasDetail;
  projectId: string;
  proxyRuleSetName?: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  formatDate: (dateString: string) => string;
}

function AliasRow({
  alias,
  projectId,
  proxyRuleSetName,
  onView,
  onEdit,
  onDelete,
  formatDate,
}: AliasRowProps) {
  const { toast } = useToast();

  // Fetch visibility info for this alias
  const { data: visibilityInfo } = useGetAliasVisibilityQuery(
    { projectId, aliasName: alias.name },
    { skip: !projectId }
  );

  const [updateVisibility, { isLoading: isUpdatingVisibility }] =
    useUpdateAliasVisibilityMutation();

  const handleVisibilityChange = async (newValue: boolean | null) => {
    try {
      await updateVisibility({
        projectId,
        aliasName: alias.name,
        data: { isPublic: newValue },
      }).unwrap();

      const visibilityLabel =
        newValue === null ? 'Inherit' : newValue ? 'Public' : 'Private';
      toast({
        title: 'Visibility updated',
        description: `Alias "${alias.name}" is now set to ${visibilityLabel}`,
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to update visibility';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  // Determine current visibility state for UI
  const getCurrentVisibilityIcon = () => {
    if (!visibilityInfo) return null;
    if (visibilityInfo.effectiveVisibility === 'public') {
      return <Globe className="h-3 w-3" />;
    }
    return <Lock className="h-3 w-3" />;
  };

  const getCurrentVisibilityLabel = () => {
    if (!visibilityInfo) return 'Loading...';
    const isInherited = visibilityInfo.source === 'project';
    const label = visibilityInfo.effectiveVisibility === 'public' ? 'Public' : 'Private';
    return isInherited ? `${label} (inherited)` : label;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(120px,2fr)_minmax(100px,1.5fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(100px,1.5fr)_minmax(80px,1fr)_minmax(150px,2fr)] gap-2 md:gap-4 p-4 rounded-lg border hover:bg-accent transition-colors items-center">
      {/* Alias Name */}
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-semibold truncate">{alias.name}</span>
      </div>

      {/* Visibility */}
      <div className="flex items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              disabled={isUpdatingVisibility || !visibilityInfo}
            >
              {getCurrentVisibilityIcon()}
              <span className="text-xs">{getCurrentVisibilityLabel()}</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => handleVisibilityChange(null)}>
              <ArrowDown className="h-3 w-3 mr-2" />
              Inherit from project
              {visibilityInfo?.source === 'project' && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Current
                </Badge>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleVisibilityChange(true)}>
              <Globe className="h-3 w-3 mr-2" />
              Public
              {visibilityInfo?.aliasOverride === true && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Current
                </Badge>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleVisibilityChange(false)}>
              <Lock className="h-3 w-3 mr-2" />
              Private
              {visibilityInfo?.aliasOverride === false && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Current
                </Badge>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Points To (commit SHA) */}
      <div className="flex items-center">
        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
          {alias.shortSha}
        </code>
      </div>

      {/* Branch */}
      <div className="flex items-center">
        <span className="text-sm truncate">{alias.branch}</span>
      </div>

      {/* Last Updated */}
      <div className="flex items-center">
        <span className="text-xs text-muted-foreground">
          {formatDate(alias.updatedAt)}
        </span>
      </div>

      {/* Proxy Rules */}
      <div className="flex items-center">
        {proxyRuleSetName ? (
          <Badge variant="outline" className="text-xs truncate">
            {proxyRuleSetName}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end md:justify-start">
        <Button variant="ghost" size="sm" className="h-8 px-2" title="View alias" onClick={onView}>
          <Eye className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2" title="Edit alias" onClick={onEdit}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-destructive hover:text-destructive"
          title="Delete alias"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * AliasesTab - Displays repository aliases with create, update, and delete actions
 * Used in RepositoryOverviewPage on the Aliases tab
 */
export function AliasesTab({ owner, repo }: AliasesTabProps) {
  const navigate = useNavigate();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [updateDialogState, setUpdateDialogState] = useState<{
    open: boolean;
    aliasName: string;
    commitSha: string;
    branch: string;
    proxyRuleSetId: string | null | undefined;
  }>({
    open: false,
    aliasName: '',
    commitSha: '',
    branch: '',
    proxyRuleSetId: undefined,
  });
  const [deleteDialogState, setDeleteDialogState] = useState<{
    open: boolean;
    aliasName: string;
  }>({
    open: false,
    aliasName: '',
  });

  // Fetch project to get projectId for visibility API
  const { data: project } = useGetProjectQuery({ owner, name: repo });

  // Fetch aliases
  const {
    data: aliasesData,
    isLoading: isLoadingAliases,
    error: aliasesError,
  } = useListAliasesQuery({ owner, repo });

  // Fetch rule sets to display names
  const { data: ruleSetsData } = useGetProjectRuleSetsQuery(project?.id || '', {
    skip: !project?.id,
  });

  // Create a map of rule set ID to name for quick lookup
  const ruleSetNameMap = new Map(
    ruleSetsData?.ruleSets.map((rs) => [rs.id, rs.name]) || []
  );

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

  // Loading state
  if (isLoadingAliases) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Aliases</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Create button skeleton */}
            <div className="flex justify-end">
              <Skeleton className="h-10 w-32" />
            </div>
            {/* List skeleton */}
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (aliasesError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Aliases</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load aliases</p>
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
  if (!aliasesData || aliasesData.aliases.length === 0) {
    return (
      <>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Aliases</CardTitle>
            <Button size="sm" className="gap-2" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Alias
            </Button>
          </CardHeader>
          <CardContent className="p-8 text-center">
            <Tag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground font-medium">No aliases found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Create an alias to give a friendly name to a specific deployment
            </p>
          </CardContent>
        </Card>

        <CreateAliasDialog
          owner={owner}
          repo={repo}
          projectId={project?.id}
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Aliases</CardTitle>
          <Button size="sm" className="gap-2" onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Alias
          </Button>
        </CardHeader>
      <CardContent>
        {/* Aliases Table */}
        <div className="space-y-2">
          {/* Table Header - Desktop only */}
          <div className="hidden md:grid md:grid-cols-[minmax(120px,2fr)_minmax(100px,1.5fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(100px,1.5fr)_minmax(80px,1fr)_minmax(150px,2fr)] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
            <div>Alias Name</div>
            <div>Visibility</div>
            <div>Points To</div>
            <div>Branch</div>
            <div>Last Updated</div>
            <div>Proxy Rules</div>
            <div>Actions</div>
          </div>

          {/* Alias Rows */}
          {aliasesData.aliases.map((alias) => (
            <AliasRow
              key={alias.id}
              alias={alias}
              projectId={project?.id || ''}
              proxyRuleSetName={alias.proxyRuleSetId ? ruleSetNameMap.get(alias.proxyRuleSetId) : undefined}
              formatDate={formatDate}
              onView={() => navigate(`/repo/${owner}/${repo}/${alias.commitSha}`)}
              onEdit={() =>
                setUpdateDialogState({
                  open: true,
                  aliasName: alias.name,
                  commitSha: alias.commitSha,
                  branch: alias.branch,
                  proxyRuleSetId: alias.proxyRuleSetId,
                })
              }
              onDelete={() =>
                setDeleteDialogState({
                  open: true,
                  aliasName: alias.name,
                })
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>

    <CreateAliasDialog
      owner={owner}
      repo={repo}
      projectId={project?.id}
      open={isCreateDialogOpen}
      onOpenChange={setIsCreateDialogOpen}
    />

    <UpdateAliasDialog
      owner={owner}
      repo={repo}
      projectId={project?.id}
      aliasName={updateDialogState.aliasName}
      currentCommitSha={updateDialogState.commitSha}
      currentBranch={updateDialogState.branch}
      currentProxyRuleSetId={updateDialogState.proxyRuleSetId}
      open={updateDialogState.open}
      onOpenChange={(open) =>
        setUpdateDialogState({
          ...updateDialogState,
          open,
        })
      }
    />

    <DeleteAliasDialog
      owner={owner}
      repo={repo}
      aliasName={deleteDialogState.aliasName}
      open={deleteDialogState.open}
      onOpenChange={(open) =>
        setDeleteDialogState({
          ...deleteDialogState,
          open,
        })
      }
    />
  </>
  );
}
