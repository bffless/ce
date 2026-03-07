import { useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppDispatch } from '@/store/hooks';
import { setCurrentRepo } from '@/store/slices/repoSlice';
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
 * Routes:
 *   - /repo/:owner/:repo/tab/proxy-rules/:ruleSetId/new (create)
 *   - /repo/:owner/:repo/tab/proxy-rules/:ruleSetId/:ruleId (edit)
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
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);

  // Determine mode: create or edit
  const isCreateMode = location.pathname.endsWith('/new');
  const isEditMode = !isCreateMode && !!ruleId;

  // Update Redux store when URL params change
  useEffect(() => {
    if (owner && repo) {
      dispatch(setCurrentRepo({ owner, repo }));
    }
  }, [owner, repo, dispatch]);

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
      <div className="bg-background">
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
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
        </div>
      </div>
    );
  }

  // Loading state
  const isLoading = isLoadingRuleSet || (isEditMode && isLoadingRule);
  if (isLoading) {
    return (
      <div className="bg-background">
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          <Skeleton className="h-6 w-96 mb-6" />
          <div className="space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // Error state for edit mode
  if (isEditMode && (ruleError || !rule)) {
    return (
      <div className="bg-background">
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          <BreadcrumbNav
            owner={owner!}
            repo={repo!}
            ruleSetId={ruleSetId!}
            ruleSetName={ruleSet?.name || 'Rule Set'}
            pageName="Error"
          />
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
        </div>
      </div>
    );
  }

  const pageTitle = isCreateMode ? 'New Rule' : 'Edit Rule';

  return (
    <div className="bg-background">
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        {/* Breadcrumb Navigation */}
        <BreadcrumbNav
          owner={owner!}
          repo={repo!}
          ruleSetId={ruleSetId!}
          ruleSetName={ruleSet?.name || 'Rule Set'}
          pageName={pageTitle}
        />

        {/* Page Title */}
        <h1 className="text-2xl font-bold mb-6">{pageTitle}</h1>

        {/* Form */}
        <ExpandedProxyRuleForm
          initialData={isEditMode ? rule : undefined}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isCreating || isUpdating}
        />
      </div>
    </div>
  );
}

function BreadcrumbNav({
  owner,
  repo,
  ruleSetId,
  ruleSetName,
  pageName,
}: {
  owner: string;
  repo: string;
  ruleSetId: string;
  ruleSetName: string;
  pageName: string;
}) {
  return (
    <Breadcrumb className="mb-6">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={routes.repository(owner, repo)}>{owner}/{repo}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={routes.proxyRules(owner, repo)}>Proxy Rules</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={routes.ruleSet(owner, repo, ruleSetId)}>{ruleSetName}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{pageName}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
