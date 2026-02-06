import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Save, Layers } from 'lucide-react';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { useUpdateProjectMutation, type Project } from '@/services/projectsApi';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';

interface ProjectProxyRulesTabProps {
  project: Project;
}

/**
 * ProjectProxyRulesTab - Allows selecting a default proxy rule set for the project
 * Proxy rules are now managed via rule sets in the repository "Proxy Rules" tab
 */
export function ProjectProxyRulesTab({ project }: ProjectProxyRulesTabProps) {
  const { toast } = useToast();
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null>(
    project.defaultProxyRuleSetId,
  );

  // Sync state when project changes
  useEffect(() => {
    setSelectedRuleSetId(project.defaultProxyRuleSetId);
  }, [project.defaultProxyRuleSetId]);

  // Fetch rule sets for this project
  const {
    data: ruleSetsData,
    isLoading: isLoadingRuleSets,
    error: ruleSetsError,
  } = useGetProjectRuleSetsQuery(project.id);

  // Update project mutation
  const [updateProject, { isLoading: isUpdating }] = useUpdateProjectMutation();

  const hasChanges = selectedRuleSetId !== project.defaultProxyRuleSetId;

  const handleSave = async () => {
    try {
      await updateProject({
        id: project.id,
        updates: {
          defaultProxyRuleSetId: selectedRuleSetId,
        },
      }).unwrap();

      toast({
        title: 'Default rule set updated',
        description: selectedRuleSetId
          ? 'The default proxy rule set has been updated.'
          : 'Default proxy rule set has been cleared.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to update default rule set';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  // Loading state
  if (isLoadingRuleSets) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Default Proxy Rule Set</CardTitle>
          <CardDescription>Loading proxy rule sets...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (ruleSetsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Default Proxy Rule Set</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load proxy rule sets.{' '}
              {(ruleSetsError as { data?: { message?: string } })?.data?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const ruleSets = ruleSetsData?.ruleSets || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default Proxy Rule Set</CardTitle>
        <CardDescription>
          Select a default proxy rule set for this project. This will be used for all deployments
          unless an alias specifies a different rule set.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ruleSets.length === 0 ? (
          <div className="text-center py-6">
            <Layers className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground font-medium">No proxy rule sets available</p>
            <p className="text-sm text-muted-foreground mt-2">
              Create a rule set in the repository's "Proxy Rules" tab first.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Select
                value={selectedRuleSetId || 'none'}
                onValueChange={(value) => setSelectedRuleSetId(value === 'none' ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a rule set..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">None (no proxy rules)</span>
                  </SelectItem>
                  {ruleSets.map((ruleSet) => (
                    <SelectItem key={ruleSet.id} value={ruleSet.id}>
                      <div className="flex items-center gap-2">
                        <span>{ruleSet.name}</span>
                        {ruleSet.environment && (
                          <Badge variant="outline" className="text-xs">
                            {ruleSet.environment}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The selected rule set will be applied to all SHA deployments and any aliases that
                don't have their own rule set specified.
              </p>
            </div>

            {hasChanges && (
              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={isUpdating}>
                  <Save className="h-4 w-4 mr-2" />
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
