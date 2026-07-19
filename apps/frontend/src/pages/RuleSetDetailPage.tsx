import { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Plus, ArrowLeft, Pencil } from 'lucide-react';
import {
  useGetRuleSetQuery,
  useUpdateProxyRuleMutation,
  useDeleteProxyRuleMutation,
  type UpdateProxyRuleDto,
} from '@/services/proxyRulesApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { RulesList } from '@/components/proxy-rules/RulesList';
import { EditRuleSetDialog } from '@/components/proxy-rules/EditRuleSetDialog';
import { RevisionHistoryPanel } from '@/components/proxy-rules/RevisionHistoryPanel';
import {
  ManagedFromGitBadge,
  MANAGED_FROM_GIT_WARNING,
} from '@/components/proxy-rules/ManagedFromGitBadge';
import { routes } from '@/utils/routes';

/**
 * RuleSetDetailPage - Shows rules within a rule set.
 * Rendered inside RepositoryLayout via Outlet.
 * Route: /repo/:owner/:repo/proxy-rules/:ruleSetId
 */
export function RuleSetDetailPage() {
  const { owner, repo, ruleSetId } = useParams<{
    owner: string;
    repo: string;
    ruleSetId: string;
  }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);

  // Fetch the rule set with its rules
  const { data: ruleSet, isLoading, error } = useGetRuleSetQuery(ruleSetId!, {
    skip: !ruleSetId,
  });

  // Mutations
  const [updateRule] = useUpdateProxyRuleMutation();
  const [deleteRule] = useDeleteProxyRuleMutation();

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // One-time (per page visit) warning when mutating a git-managed set
  // (decision 2: warn, never block, never clear `source`). The set edit
  // dialog carries its own inline alert, so it's excluded here.
  const managedEditWarnedRef = useRef(false);
  const warnIfManaged = () => {
    if (!ruleSet?.source || managedEditWarnedRef.current) return;
    managedEditWarnedRef.current = true;
    toast({
      title: 'Managed from git',
      description: MANAGED_FROM_GIT_WARNING,
    });
  };

  const handleUpdateRule = async (id: string, updates: UpdateProxyRuleDto) => {
    warnIfManaged();
    try {
      await updateRule({ id, updates }).unwrap();
      toast({
        title: 'Rule updated',
        description: 'Proxy rule has been updated.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to update proxy rule';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleDeleteRule = async (id: string) => {
    warnIfManaged();
    try {
      await deleteRule(id).unwrap();
      toast({
        title: 'Rule deleted',
        description: 'Proxy rule has been deleted.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete proxy rule';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleRuleClick = (rule: { id: string }) => {
    navigate(routes.editRule(owner!, repo!, ruleSetId!, rule.id));
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error || !ruleSet) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load rule set</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate(routes.proxyRules(owner!, repo!))}
          >
            Back to Rule Sets
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(routes.proxyRules(owner!, repo!))}
          className="gap-1 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={routes.proxyRules(owner!, repo!)}>Proxy Rules</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{ruleSet.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Rule Set Content */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{ruleSet.name}</CardTitle>
              {ruleSet.environment && (
                <Badge variant="outline">{ruleSet.environment}</Badge>
              )}
              <ManagedFromGitBadge source={ruleSet.source} />
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setEditDialogOpen(true)}
                  title="Edit rule set"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <CardDescription className="mt-1">
              {ruleSet.description || 'Configure proxy rules for this rule set. Rules are evaluated in order.'}
            </CardDescription>
          </div>
          {canEdit && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                warnIfManaged();
                navigate(routes.newRule(owner!, repo!, ruleSetId!));
              }}
            >
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <RulesList
            rules={ruleSet.rules || []}
            isLoading={false}
            onRuleClick={handleRuleClick}
            onUpdateRule={handleUpdateRule}
            onDeleteRule={handleDeleteRule}
            onViewLogs={(rule) =>
              navigate(`/repo/${owner}/${repo}/proxy-rules/${ruleSetId}/${rule.id}/logs`)
            }
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      {/* Revision History */}
      <Card>
        <CardContent className="p-4">
          <RevisionHistoryPanel ruleSetId={ruleSetId!} canEdit={canEdit} />
        </CardContent>
      </Card>

      {/* Edit Rule Set Dialog */}
      <EditRuleSetDialog
        ruleSet={ruleSet}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />
    </div>
  );
}
