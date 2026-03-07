import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAppDispatch } from '@/store/hooks';
import { setCurrentRepo } from '@/store/slices/repoSlice';
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
import { Plus } from 'lucide-react';
import {
  useGetRuleSetQuery,
  useUpdateProxyRuleMutation,
  useDeleteProxyRuleMutation,
  type UpdateProxyRuleDto,
} from '@/services/proxyRulesApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { RulesList } from '@/components/proxy-rules/RulesList';
import { routes } from '@/utils/routes';

/**
 * RuleSetDetailPage - Full page showing rules within a rule set.
 * Route: /repo/:owner/:repo/tab/proxy-rules/:ruleSetId
 */
export function RuleSetDetailPage() {
  const { owner, repo, ruleSetId } = useParams<{
    owner: string;
    repo: string;
    ruleSetId: string;
  }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);

  // Update Redux store when URL params change
  useEffect(() => {
    if (owner && repo) {
      dispatch(setCurrentRepo({ owner, repo }));
    }
  }, [owner, repo, dispatch]);

  // Fetch the rule set with its rules
  const { data: ruleSet, isLoading, error } = useGetRuleSetQuery(ruleSetId!, {
    skip: !ruleSetId,
  });

  // Mutations
  const [updateRule] = useUpdateProxyRuleMutation();
  const [deleteRule] = useDeleteProxyRuleMutation();

  const handleUpdateRule = async (id: string, updates: UpdateProxyRuleDto) => {
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
      <div className="bg-background">
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          <Skeleton className="h-6 w-96 mb-6" />
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
      </div>
    );
  }

  // Error state
  if (error || !ruleSet) {
    return (
      <div className="bg-background">
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          <BreadcrumbNav owner={owner!} repo={repo!} ruleSetName="Error" />
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
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        {/* Breadcrumb Navigation */}
        <BreadcrumbNav owner={owner!} repo={repo!} ruleSetName={ruleSet.name} />

        {/* Rule Set Header */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>{ruleSet.name}</CardTitle>
                {ruleSet.environment && (
                  <Badge variant="outline">{ruleSet.environment}</Badge>
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
                onClick={() => navigate(routes.newRule(owner!, repo!, ruleSetId!))}
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
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BreadcrumbNav({
  owner,
  repo,
  ruleSetName,
}: {
  owner: string;
  repo: string;
  ruleSetName: string;
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
          <BreadcrumbPage>{ruleSetName}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
