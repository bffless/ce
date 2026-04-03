import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Save, Layers, ChevronDown, X } from 'lucide-react';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { useUpdateProjectMutation, type Project } from '@/services/projectsApi';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';

interface ProjectProxyRulesTabProps {
  project: Project;
}

/**
 * ProjectProxyRulesTab - Allows selecting default proxy rule sets for the project
 * Proxy rules are now managed via rule sets in the repository "Proxy Rules" tab
 */
export function ProjectProxyRulesTab({ project }: ProjectProxyRulesTabProps) {
  const { toast } = useToast();

  // Initialize from defaultProxyRuleSetIds (join table), fallback to legacy singular
  const initialIds = project.defaultProxyRuleSetIds?.length
    ? project.defaultProxyRuleSetIds
    : project.defaultProxyRuleSetId ? [project.defaultProxyRuleSetId] : [];

  const [selectedRuleSetIds, setSelectedRuleSetIds] = useState<string[]>(initialIds);

  // Sync state when project changes
  useEffect(() => {
    const ids = project.defaultProxyRuleSetIds?.length
      ? project.defaultProxyRuleSetIds
      : project.defaultProxyRuleSetId ? [project.defaultProxyRuleSetId] : [];
    setSelectedRuleSetIds(ids);
  }, [project.defaultProxyRuleSetIds, project.defaultProxyRuleSetId]);

  // Fetch rule sets for this project
  const {
    data: ruleSetsData,
    isLoading: isLoadingRuleSets,
    error: ruleSetsError,
  } = useGetProjectRuleSetsQuery(project.id);

  // Update project mutation
  const [updateProject, { isLoading: isUpdating }] = useUpdateProjectMutation();

  // Create a map of rule set ID to rule set
  const ruleSetMap = new Map(
    ruleSetsData?.ruleSets.map((rs) => [rs.id, rs]) || []
  );

  const currentIds = project.defaultProxyRuleSetIds?.length
    ? project.defaultProxyRuleSetIds
    : project.defaultProxyRuleSetId ? [project.defaultProxyRuleSetId] : [];

  const hasChanges =
    selectedRuleSetIds.length !== currentIds.length ||
    selectedRuleSetIds.some((id, i) => id !== currentIds[i]);

  const toggleRuleSet = (id: string) => {
    setSelectedRuleSetIds((prev) =>
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id]
    );
  };

  const removeRuleSet = (id: string) => {
    setSelectedRuleSetIds((prev) => prev.filter((rid) => rid !== id));
  };

  const handleSave = async () => {
    try {
      await updateProject({
        id: project.id,
        updates: {
          defaultProxyRuleSetIds: selectedRuleSetIds,
        },
      }).unwrap();

      toast({
        title: 'Default rule sets updated',
        description: selectedRuleSetIds.length > 0
          ? `${selectedRuleSetIds.length} default proxy rule set${selectedRuleSetIds.length !== 1 ? 's' : ''} configured.`
          : 'Default proxy rule sets have been cleared.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to update default rule sets';
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
          <CardTitle>Default Proxy Rule Sets</CardTitle>
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
          <CardTitle>Default Proxy Rule Sets</CardTitle>
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
        <CardTitle>Default Proxy Rule Sets</CardTitle>
        <CardDescription>
          Select default proxy rule sets for this project. These will be used for all deployments
          unless an alias specifies its own rule sets.
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
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-between w-full">
                    <span className="text-sm truncate">
                      {selectedRuleSetIds.length === 0
                        ? 'None (no default proxy rules)'
                        : `${selectedRuleSetIds.length} rule set${selectedRuleSetIds.length !== 1 ? 's' : ''} selected`}
                    </span>
                    <ChevronDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                  {ruleSets.map((ruleSet) => (
                    <label
                      key={ruleSet.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedRuleSetIds.includes(ruleSet.id)}
                        onCheckedChange={() => toggleRuleSet(ruleSet.id)}
                      />
                      <span className="text-sm">{ruleSet.name}</span>
                      {ruleSet.environment && (
                        <Badge variant="outline" className="text-xs">
                          {ruleSet.environment}
                        </Badge>
                      )}
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
              {/* Show selected rule sets as ordered removable badges */}
              {selectedRuleSetIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedRuleSetIds.map((id, index) => {
                    const rs = ruleSetMap.get(id);
                    return (
                      <Badge key={id} variant="secondary" className="gap-1 pr-1">
                        <span className="text-xs text-muted-foreground mr-0.5">{index + 1}.</span>
                        {rs?.name ?? id.substring(0, 8)}
                        <button
                          type="button"
                          className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                          onClick={() => removeRuleSet(id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                The selected rule sets will be applied to all SHA deployments and any aliases that
                don't have their own rule sets specified. Rules merge in order — first set has highest priority.
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
