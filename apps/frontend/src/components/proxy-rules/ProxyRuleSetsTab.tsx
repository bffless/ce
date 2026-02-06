import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, MoreHorizontal, Edit2, Trash2, Settings, Layers } from 'lucide-react';
import { useGetProjectRuleSetsQuery, useDeleteRuleSetMutation } from '@/services/proxyRulesApi';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useToast } from '@/hooks/use-toast';
import { CreateRuleSetDialog } from './CreateRuleSetDialog';
import { RuleSetEditorDialog } from './RuleSetEditorDialog';

interface ProxyRuleSetsTabProps {
  owner: string;
  repo: string;
}

/**
 * ProxyRuleSetsTab - Displays and manages proxy rule sets for a repository
 * Used in RepositoryOverviewPage on the Proxy Rules tab
 */
export function ProxyRuleSetsTab({ owner, repo }: ProxyRuleSetsTabProps) {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRuleSet, setEditingRuleSet] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletingRuleSet, setDeletingRuleSet] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Fetch project to get projectId
  const { data: project, isLoading: isLoadingProject } = useGetProjectQuery({ owner, name: repo });

  // Fetch rule sets for this project
  const {
    data: ruleSetsData,
    isLoading: isLoadingRuleSets,
    error: ruleSetsError,
  } = useGetProjectRuleSetsQuery(project?.id || '', {
    skip: !project?.id,
  });

  // Delete mutation
  const [deleteRuleSet, { isLoading: isDeleting }] = useDeleteRuleSetMutation();

  const handleDelete = async () => {
    if (!deletingRuleSet) return;
    try {
      await deleteRuleSet(deletingRuleSet.id).unwrap();
      toast({
        title: 'Rule set deleted',
        description: `Rule set "${deletingRuleSet.name}" has been deleted.`,
      });
      setDeletingRuleSet(null);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete rule set';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const isLoading = isLoadingProject || isLoadingRuleSets;

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Proxy Rule Sets</CardTitle>
          <CardDescription>Manage reusable proxy rule configurations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-end">
              <Skeleton className="h-10 w-40" />
            </div>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (ruleSetsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Proxy Rule Sets</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load proxy rule sets</p>
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

  const ruleSets = ruleSetsData?.ruleSets || [];

  // Empty state
  if (ruleSets.length === 0) {
    return (
      <>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Proxy Rule Sets</CardTitle>
              <CardDescription>Manage reusable proxy rule configurations</CardDescription>
            </div>
            <Button size="sm" className="gap-2" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Rule Set
            </Button>
          </CardHeader>
          <CardContent className="p-8 text-center">
            <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground font-medium">No proxy rule sets found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Create a rule set to define proxy rules that can be assigned to aliases
            </p>
          </CardContent>
        </Card>

        <CreateRuleSetDialog
          projectId={project?.id || ''}
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
          <div>
            <CardTitle>Proxy Rule Sets</CardTitle>
            <CardDescription>Manage reusable proxy rule configurations</CardDescription>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Rule Set
          </Button>
        </CardHeader>
        <CardContent>
          {/* Rule Sets List */}
          <div className="space-y-3">
            {ruleSets.map((ruleSet) => (
              <div
                key={ruleSet.id}
                className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Settings className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ruleSet.name}</span>
                      {ruleSet.environment && (
                        <Badge variant="outline" className="text-xs">
                          {ruleSet.environment}
                        </Badge>
                      )}
                      {project?.defaultProxyRuleSetId === ruleSet.id && (
                        <Badge variant="secondary" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </div>
                    {ruleSet.description && (
                      <p className="text-sm text-muted-foreground mt-1">{ruleSet.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => setEditingRuleSet({ id: ruleSet.id, name: ruleSet.name })}
                  >
                    <Edit2 className="h-3 w-3" />
                    Edit Rules
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setDeletingRuleSet({ id: ruleSet.id, name: ruleSet.name })}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreateRuleSetDialog
        projectId={project?.id || ''}
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />

      {/* Edit Rules Dialog */}
      {editingRuleSet && (
        <RuleSetEditorDialog
          ruleSetId={editingRuleSet.id}
          ruleSetName={editingRuleSet.name}
          open={!!editingRuleSet}
          onOpenChange={(open) => !open && setEditingRuleSet(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingRuleSet} onOpenChange={(open) => !open && setDeletingRuleSet(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule Set</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the rule set "{deletingRuleSet?.name}"? This will
              remove all rules in this set and unassign it from any aliases using it. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
