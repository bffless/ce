import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Layers, MoreHorizontal, Trash2 } from 'lucide-react';
import { useGetProjectRuleSetsQuery, useDeleteRuleSetMutation } from '@/services/proxyRulesApi';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { CreateRuleSetDialog } from '@/components/proxy-rules/CreateRuleSetDialog';
import { RuleSetCard } from '@/components/proxy-rules/RuleSetCard';
import { routes } from '@/utils/routes';

/**
 * ProxyRuleSetsPage - Content for the Proxy Rules tab showing all rule sets.
 * Rendered inside RepositoryLayout via Outlet.
 * Route: /repo/:owner/:repo/proxy-rules
 */
export function ProxyRuleSetsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deletingRuleSet, setDeletingRuleSet] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Fetch project to get projectId
  const { data: project, isLoading: isLoadingProject } = useGetProjectQuery(
    { owner: owner!, name: repo! },
    { skip: !owner || !repo },
  );

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
  const ruleSets = ruleSetsData?.ruleSets || [];

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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Proxy Rule Sets</CardTitle>
            <CardDescription>Manage reusable proxy rule configurations</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" className="gap-2" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Rule Set
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {ruleSets.length === 0 ? (
            <div className="p-8 text-center">
              <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium">No proxy rule sets found</p>
              <p className="text-sm text-muted-foreground mt-2">
                {canEdit
                  ? 'Create a rule set to define proxy rules that can be assigned to aliases'
                  : 'No proxy rule sets have been created for this repository yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {ruleSets.map((ruleSet) => (
                <div key={ruleSet.id} className="relative">
                  <RuleSetCard
                    id={ruleSet.id}
                    name={ruleSet.name}
                    description={ruleSet.description}
                    environment={ruleSet.environment}
                    isDefault={project?.defaultProxyRuleSetId === ruleSet.id}
                    href={routes.ruleSet(owner!, repo!, ruleSet.id)}
                  />
                  {canEdit && (
                    <div className="absolute right-12 top-1/2 -translate-y-1/2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingRuleSet({ id: ruleSet.id, name: ruleSet.name });
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      {canEdit && (
        <CreateRuleSetDialog
          projectId={project?.id || ''}
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {canEdit && (
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
      )}
    </>
  );
}
