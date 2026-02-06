import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useUpdateAliasMutation,
  useGetDeploymentsQuery,
  useGetAliasVisibilityQuery,
  useUpdateAliasVisibilityMutation,
  type UnauthorizedBehavior,
  type RequiredRole,
} from '@/services/repoApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Globe, Lock, ArrowDown, Shield } from 'lucide-react';

interface UpdateAliasDialogProps {
  owner: string;
  repo: string;
  projectId?: string;
  aliasName: string;
  currentCommitSha: string;
  currentBranch: string;
  currentProxyRuleSetId?: string | null;
  currentIsPublic?: boolean | null;
  currentUnauthorizedBehavior?: UnauthorizedBehavior | null;
  currentRequiredRole?: RequiredRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * UpdateAliasDialog - Modal for updating an existing alias to point to a different commit
 * Used in AliasesTab component
 */
export function UpdateAliasDialog({
  owner,
  repo,
  projectId,
  aliasName,
  currentCommitSha,
  currentBranch,
  currentProxyRuleSetId,
  currentIsPublic,
  currentUnauthorizedBehavior,
  currentRequiredRole,
  open,
  onOpenChange,
}: UpdateAliasDialogProps) {
  const [selectedCommitSha, setSelectedCommitSha] = useState(currentCommitSha);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null | undefined>(
    currentProxyRuleSetId
  );
  // Visibility and access control state ('inherit' means null)
  const [visibility, setVisibility] = useState<'inherit' | 'public' | 'private'>('inherit');
  const [unauthorizedBehavior, setUnauthorizedBehavior] = useState<'inherit' | UnauthorizedBehavior>('inherit');
  const [requiredRole, setRequiredRole] = useState<'inherit' | RequiredRole>('inherit');

  const { toast } = useToast();
  const [updateAlias, { isLoading }] = useUpdateAliasMutation();
  const [updateVisibility, { isLoading: isUpdatingVisibility }] = useUpdateAliasVisibilityMutation();

  // Fetch visibility info
  const { data: visibilityInfo } = useGetAliasVisibilityQuery(
    { projectId: projectId || '', aliasName },
    { skip: !projectId || !open }
  );

  // Fetch deployments for commit selection
  const { data: deploymentsData } = useGetDeploymentsQuery(
    {
      owner,
      repo,
      page: 1,
      limit: 100, // Get more to ensure we have good coverage
    },
    {
      skip: !open, // Only fetch when dialog is open
    }
  );

  // Fetch rule sets for proxy rules selection
  const { data: ruleSetsData } = useGetProjectRuleSetsQuery(projectId || '', {
    skip: !open || !projectId,
  });

  // Deduplicate commits - keep only unique commit SHAs
  const uniqueDeployments = deploymentsData?.deployments.reduce((acc, deployment) => {
    if (!acc.find(d => d.commitSha === deployment.commitSha)) {
      acc.push(deployment);
    }
    return acc;
  }, [] as typeof deploymentsData.deployments) || [];

  // Reset selected values when dialog opens or current values change
  useEffect(() => {
    if (open) {
      setSelectedCommitSha(currentCommitSha);
      setSelectedRuleSetId(currentProxyRuleSetId);
      // Initialize visibility from current value
      if (currentIsPublic === null || currentIsPublic === undefined) {
        setVisibility('inherit');
      } else if (currentIsPublic === true) {
        setVisibility('public');
      } else {
        setVisibility('private');
      }
      // Initialize access control from current values
      setUnauthorizedBehavior(currentUnauthorizedBehavior ?? 'inherit');
      setRequiredRole(currentRequiredRole ?? 'inherit');
    }
  }, [open, currentCommitSha, currentProxyRuleSetId, currentIsPublic, currentUnauthorizedBehavior, currentRequiredRole]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const commitChanged = selectedCommitSha !== currentCommitSha;
    const ruleSetChanged = selectedRuleSetId !== currentProxyRuleSetId;

    // Check visibility changes
    const getIsPublicValue = (): boolean | null => {
      if (visibility === 'inherit') return null;
      if (visibility === 'public') return true;
      return false;
    };
    const getOriginalIsPublic = (): boolean | null => {
      if (currentIsPublic === null || currentIsPublic === undefined) return null;
      return currentIsPublic;
    };
    const newIsPublic = getIsPublicValue();
    const visibilityChanged = newIsPublic !== getOriginalIsPublic();

    // Check access control changes
    const newUnauthorizedBehavior = unauthorizedBehavior === 'inherit' ? null : unauthorizedBehavior;
    const originalUnauthorizedBehavior = currentUnauthorizedBehavior ?? null;
    const unauthorizedBehaviorChanged = newUnauthorizedBehavior !== originalUnauthorizedBehavior;

    const newRequiredRole = requiredRole === 'inherit' ? null : requiredRole;
    const originalRequiredRole = currentRequiredRole ?? null;
    const requiredRoleChanged = newRequiredRole !== originalRequiredRole;

    // No changes
    if (!commitChanged && !ruleSetChanged && !visibilityChanged && !unauthorizedBehaviorChanged && !requiredRoleChanged) {
      toast({
        title: 'No changes',
        description: 'No changes were made to the alias',
      });
      return;
    }

    try {
      // Update commit/proxy rules if changed
      if (commitChanged || ruleSetChanged) {
        const updateData: { commitSha?: string; proxyRuleSetId?: string | null } = {};
        if (commitChanged && selectedCommitSha) {
          updateData.commitSha = selectedCommitSha;
        }
        if (ruleSetChanged) {
          updateData.proxyRuleSetId = selectedRuleSetId;
        }

        await updateAlias({
          owner,
          repo,
          aliasName,
          data: updateData,
        }).unwrap();
      }

      // Update visibility and access control if changed
      if ((visibilityChanged || unauthorizedBehaviorChanged || requiredRoleChanged) && projectId) {
        await updateVisibility({
          projectId,
          aliasName,
          data: {
            isPublic: visibilityChanged ? newIsPublic : undefined,
            unauthorizedBehavior: unauthorizedBehaviorChanged ? newUnauthorizedBehavior : undefined,
            requiredRole: requiredRoleChanged ? newRequiredRole : undefined,
          },
        }).unwrap();
      }

      // Success!
      toast({
        title: 'Success',
        description: `Alias "${aliasName}" updated successfully`,
      });

      // Close dialog
      onOpenChange(false);
    } catch (error: any) {
      // Handle error
      const errorMessage =
        error?.data?.message || error?.message || 'Failed to update alias';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  // Handle dialog close
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setSelectedCommitSha(currentCommitSha);
      setSelectedRuleSetId(currentProxyRuleSetId);
      // Reset visibility and access control
      if (currentIsPublic === null || currentIsPublic === undefined) {
        setVisibility('inherit');
      } else if (currentIsPublic === true) {
        setVisibility('public');
      } else {
        setVisibility('private');
      }
      setUnauthorizedBehavior(currentUnauthorizedBehavior ?? 'inherit');
      setRequiredRole(currentRequiredRole ?? 'inherit');
    }
    onOpenChange(newOpen);
  };

  const isSubmitting = isLoading || isUpdatingVisibility;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Update Alias</DialogTitle>
            <DialogDescription>
              Update "{aliasName}" to point to a different deployment commit
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Current Commit Info */}
            <div className="grid gap-2">
              <Label>Current Commit</Label>
              <div className="flex items-center gap-2 p-2 rounded bg-muted">
                <code className="text-sm font-mono">{currentCommitSha.substring(0, 7)}</code>
                <span className="text-sm">({currentBranch})</span>
              </div>
            </div>

            {/* New Commit Selection */}
            <div className="grid gap-2">
              <Label htmlFor="commit-select">New Commit</Label>
              <Select value={selectedCommitSha} onValueChange={setSelectedCommitSha}>
                <SelectTrigger id="commit-select">
                  <SelectValue placeholder="Select a commit" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueDeployments.map((deployment) => (
                    <SelectItem key={deployment.commitSha} value={deployment.commitSha}>
                      <div className="flex items-center gap-2">
                        <code className="text-xs">{deployment.shortSha}</code>
                        <span className="text-xs">({deployment.branch})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select which deployment this alias should point to
              </p>
            </div>

            {/* Proxy Rule Set Selection */}
            {ruleSetsData && ruleSetsData.ruleSets.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="ruleset-select">Proxy Rule Set</Label>
                <Select
                  value={selectedRuleSetId || 'none'}
                  onValueChange={(value) => setSelectedRuleSetId(value === 'none' ? null : value)}
                >
                  <SelectTrigger id="ruleset-select">
                    <SelectValue placeholder="Select a rule set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">None (use project default)</span>
                    </SelectItem>
                    {ruleSetsData.ruleSets.map((ruleSet) => (
                      <SelectItem key={ruleSet.id} value={ruleSet.id}>
                        {ruleSet.name}
                        {ruleSet.environment && (
                          <span className="text-muted-foreground ml-2">({ruleSet.environment})</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Apply proxy rules to forward requests to external backends
                </p>
              </div>
            )}

            {/* Visibility Selection */}
            <div className="grid gap-2">
              <Label htmlFor="visibility-select">Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as 'inherit' | 'public' | 'private')}>
                <SelectTrigger id="visibility-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    <div className="flex items-center gap-2">
                      <ArrowDown className="h-3 w-3" />
                      <span>Inherit from project</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="public">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3 w-3" />
                      <span>Public</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="private">
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3" />
                      <span>Private</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {visibilityInfo && visibility === 'inherit' && (
                <p className="text-xs text-muted-foreground">
                  Currently inherits "{visibilityInfo.effectiveVisibility}" from project
                </p>
              )}
            </div>

            {/* Access Control Overrides - Only show when private */}
            {visibility === 'private' && (
              <div className="space-y-4 p-3 rounded-md bg-muted/50 border">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4" />
                  Access Control Overrides
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="unauthorized-behavior">Unauthorized Behavior</Label>
                  <Select
                    value={unauthorizedBehavior}
                    onValueChange={(v) => setUnauthorizedBehavior(v as 'inherit' | UnauthorizedBehavior)}
                  >
                    <SelectTrigger id="unauthorized-behavior">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        <div className="flex items-center gap-2">
                          <ArrowDown className="h-3 w-3" />
                          <span>Inherit from project</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="not_found">Show 404 (Not Found)</SelectItem>
                      <SelectItem value="redirect_login">Redirect to Login</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {unauthorizedBehavior === 'inherit' && visibilityInfo?.effectiveUnauthorizedBehavior
                      ? `Inherits "${visibilityInfo.effectiveUnauthorizedBehavior}" from project`
                      : 'How to handle unauthenticated users'}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="required-role">Required Role</Label>
                  <Select
                    value={requiredRole}
                    onValueChange={(v) => setRequiredRole(v as 'inherit' | RequiredRole)}
                  >
                    <SelectTrigger id="required-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        <div className="flex items-center gap-2">
                          <ArrowDown className="h-3 w-3" />
                          <span>Inherit from project</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="authenticated">Any authenticated user</SelectItem>
                      <SelectItem value="viewer">Viewer or higher</SelectItem>
                      <SelectItem value="contributor">Contributor or higher</SelectItem>
                      <SelectItem value="admin">Admin or higher</SelectItem>
                      <SelectItem value="owner">Owner only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {requiredRole === 'inherit' && visibilityInfo?.effectiveRequiredRole
                      ? `Inherits "${visibilityInfo.effectiveRequiredRole}" from project`
                      : 'Minimum role required for access'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Alias
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
