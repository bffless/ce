import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ArrowLeft } from 'lucide-react';
import {
  useGetProxyRuleQuery,
  useGetRuleSetQuery,
  useCreateRuleInSetMutation,
  useUpdateProxyRuleMutation,
  type CreateProxyRuleDto,
} from '@/services/proxyRulesApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { ExpandedProxyRuleForm } from '@/components/proxy-rules/ExpandedProxyRuleForm';
import { routes } from '@/utils/routes';

/**
 * RuleEditorPage - Full page for creating or editing a proxy rule.
 * Rendered inside RepositoryLayout via Outlet.
 * Routes:
 *   - /repo/:owner/:repo/proxy-rules/:ruleSetId/new (create)
 *   - /repo/:owner/:repo/proxy-rules/:ruleSetId/:ruleId (edit)
 */
export function RuleEditorPage() {
  const { owner, repo, ruleSetId, ruleId } = useParams<{
    owner: string;
    repo: string;
    ruleSetId: string;
    ruleId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);

  // Determine mode: create or edit
  const isCreateMode = location.pathname.endsWith('/new');
  const isEditMode = !isCreateMode && !!ruleId;

  // Fetch rule set to get the name for breadcrumb
  const { data: ruleSet, isLoading: isLoadingRuleSet } = useGetRuleSetQuery(ruleSetId!, {
    skip: !ruleSetId,
  });

  // Fetch rule data for edit mode
  const {
    data: rule,
    isLoading: isLoadingRule,
    error: ruleError,
  } = useGetProxyRuleQuery(ruleId!, {
    skip: !isEditMode || !ruleId,
  });

  // Mutations
  const [createRule, { isLoading: isCreating }] = useCreateRuleInSetMutation();
  const [updateRule, { isLoading: isUpdating }] = useUpdateProxyRuleMutation();

  const handleSubmit = async (data: CreateProxyRuleDto) => {
    try {
      if (isCreateMode) {
        await createRule({ ruleSetId: ruleSetId!, rule: data }).unwrap();
        toast({
          title: 'Rule created',
          description: `Proxy rule for "${data.pathPattern}" has been created.`,
        });
      } else if (isEditMode && ruleId) {
        await updateRule({ id: ruleId, updates: data }).unwrap();
        toast({
          title: 'Rule updated',
          description: 'Proxy rule has been updated.',
        });
      }
      // Navigate back to rule set detail page
      navigate(routes.ruleSet(owner!, repo!, ruleSetId!));
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        `Failed to ${isCreateMode ? 'create' : 'update'} proxy rule`;
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleCancel = () => {
    navigate(routes.ruleSet(owner!, repo!, ruleSetId!));
  };

  // Check permissions
  if (!canEdit) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">You do not have permission to edit proxy rules.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate(routes.ruleSet(owner!, repo!, ruleSetId!))}
          >
            Back to Rule Set
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  const isLoading = isLoadingRuleSet || (isEditMode && isLoadingRule);
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-8 w-32" />
        <div className="space-y-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // Error state for edit mode
  if (isEditMode && (ruleError || !rule)) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load rule</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate(routes.ruleSet(owner!, repo!, ruleSetId!))}
          >
            Back to Rule Set
          </Button>
        </CardContent>
      </Card>
    );
  }

  const pageTitle = isCreateMode ? 'New Rule' : 'Edit Rule';

  return (
    <div className="space-y-4">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(routes.ruleSet(owner!, repo!, ruleSetId!))}
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
              <BreadcrumbLink asChild>
                <Link to={routes.ruleSet(owner!, repo!, ruleSetId!)}>{ruleSet?.name || 'Rule Set'}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Page Title */}
      <h2 className="text-xl font-semibold">{pageTitle}</h2>

      {/* Form */}
      <ExpandedProxyRuleForm
        initialData={isEditMode ? rule : undefined}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        isSubmitting={isCreating || isUpdating}
        projectId={ruleSet?.projectId}
      />
    </div>
  );
}
