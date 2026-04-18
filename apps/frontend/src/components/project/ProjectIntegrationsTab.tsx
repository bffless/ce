import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetProjectIntegrationsQuery,
  useDeleteIntegrationMutation,
} from '@/services/integrationsApi';
import { useToast } from '@/hooks/use-toast';
import { StripeIntegrationDialog } from './StripeIntegrationDialog';
import { GitHubIntegrationDialog } from './GitHubIntegrationDialog';
import { Settings, Trash2, CreditCard, Github } from 'lucide-react';

interface Project {
  id: string;
  owner: string;
  name: string;
}

interface ProjectIntegrationsTabProps {
  project: Project;
}

const INTEGRATION_META: Record<
  string,
  { name: string; description: string; icon: typeof CreditCard }
> = {
  stripe: {
    name: 'Stripe',
    description: 'Accept payments via Stripe Checkout. Create checkout sessions from pipeline steps and handle webhooks.',
    icon: CreditCard,
  },
  github: {
    name: 'GitHub',
    description: 'Create repositories from templates and interact with the GitHub API from pipeline steps.',
    icon: Github,
  },
};

export function ProjectIntegrationsTab({ project }: ProjectIntegrationsTabProps) {
  const { toast } = useToast();
  const [configDialogId, setConfigDialogId] = useState<string | null>(null);

  const { data: integrations, isLoading } = useGetProjectIntegrationsQuery(project.id);
  const [deleteIntegration] = useDeleteIntegrationMutation();

  const handleDelete = async (integrationId: string) => {
    try {
      await deleteIntegration({
        projectId: project.id,
        integrationId,
      }).unwrap();

      toast({
        title: 'Integration removed',
        description: `${INTEGRATION_META[integrationId]?.name || integrationId} has been removed`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to remove integration',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  const configIntegration = integrations?.find((i) => i.id === configDialogId);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Connect third-party services to use in your pipelines
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {integrations?.map((integration) => {
            const meta = INTEGRATION_META[integration.id] || {
              name: integration.id,
              description: '',
              icon: Settings,
            };
            const Icon = meta.icon;

            return (
              <div
                key={integration.id}
                className="border rounded-lg p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{meta.name}</h4>
                        {integration.enabled && (
                          <Badge
                            variant={
                              integration.activeEnvironment === 'production'
                                ? 'default'
                                : 'secondary'
                            }
                          >
                            {integration.activeEnvironment}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {meta.description}
                      </p>
                      {integration.enabled && (
                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                          {integration.hasSandboxConfig && <span>Sandbox configured</span>}
                          {integration.hasSandboxConfig && integration.hasProductionConfig && (
                            <span>&middot;</span>
                          )}
                          {integration.hasProductionConfig && <span>Production configured</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfigDialogId(integration.id)}
                    >
                      <Settings className="h-4 w-4 mr-1" />
                      {integration.enabled ? 'Configure' : 'Set Up'}
                    </Button>
                    {integration.enabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(integration.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {(!integrations || integrations.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No integrations available
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stripe Dialog */}
      {configDialogId === 'stripe' && configIntegration && (
        <StripeIntegrationDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setConfigDialogId(null);
          }}
          projectId={project.id}
          integration={configIntegration}
        />
      )}

      {/* GitHub Dialog */}
      {configDialogId === 'github' && configIntegration && (
        <GitHubIntegrationDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setConfigDialogId(null);
          }}
          projectId={project.id}
          integration={configIntegration}
        />
      )}
    </>
  );
}
