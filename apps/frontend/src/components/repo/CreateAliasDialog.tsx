import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateAliasMutation, useGetDeploymentsQuery } from '@/services/repoApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface CreateAliasDialogProps {
  owner: string;
  repo: string;
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * CreateAliasDialog - Modal for creating a new alias
 * Used in AliasesTab component
 */
export function CreateAliasDialog({
  owner,
  repo,
  projectId,
  open,
  onOpenChange,
}: CreateAliasDialogProps) {
  const [aliasName, setAliasName] = useState('');
  const [selectedCommitSha, setSelectedCommitSha] = useState('');
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState('');

  const { toast } = useToast();
  const [createAlias, { isLoading }] = useCreateAliasMutation();

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

  // Validate alias name
  const validateAliasName = (name: string): boolean => {
    if (!name) {
      setNameError('Alias name is required');
      return false;
    }
    // Alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setNameError('Only letters, numbers, hyphens, and underscores allowed');
      return false;
    }
    setNameError('');
    return true;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate inputs
    if (!validateAliasName(aliasName)) {
      return;
    }

    if (!selectedCommitSha) {
      toast({
        title: 'Error',
        description: 'Please select a commit',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createAlias({
        owner,
        repo,
        data: {
          name: aliasName,
          commitSha: selectedCommitSha,
          proxyRuleSetId: selectedRuleSetId,
        },
      }).unwrap();

      // Success!
      toast({
        title: 'Success',
        description: `Alias "${aliasName}" created successfully`,
      });

      // Reset form and close dialog
      setAliasName('');
      setSelectedCommitSha('');
      setSelectedRuleSetId(undefined);
      setNameError('');
      onOpenChange(false);
    } catch (error: any) {
      // Handle error
      const errorMessage =
        error?.data?.message || error?.message || 'Failed to create alias';
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
      setAliasName('');
      setSelectedCommitSha('');
      setSelectedRuleSetId(undefined);
      setNameError('');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Alias</DialogTitle>
            <DialogDescription>
              Create a friendly name for a specific deployment commit
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Alias Name Input */}
            <div className="grid gap-2">
              <Label htmlFor="alias-name">Alias Name</Label>
              <Input
                id="alias-name"
                placeholder="e.g., production, staging, latest"
                value={aliasName}
                onChange={(e) => {
                  setAliasName(e.target.value);
                  if (nameError) {
                    validateAliasName(e.target.value);
                  }
                }}
                onBlur={() => validateAliasName(aliasName)}
                className={nameError ? 'border-destructive' : ''}
              />
              {nameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Only letters, numbers, hyphens, and underscores
              </p>
            </div>

            {/* Commit Selection */}
            <div className="grid gap-2">
              <Label htmlFor="commit-select">Points To</Label>
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
                <Label htmlFor="ruleset-select">Proxy Rule Set (Optional)</Label>
                <Select
                  value={selectedRuleSetId || 'none'}
                  onValueChange={(value) => setSelectedRuleSetId(value === 'none' ? undefined : value)}
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
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Alias
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
