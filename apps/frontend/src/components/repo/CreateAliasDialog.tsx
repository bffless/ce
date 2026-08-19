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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useCreateAliasMutation, useGetDeploymentsQuery } from '@/services/repoApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ChevronDown, X } from 'lucide-react';

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
  const [selectedRuleSetIds, setSelectedRuleSetIds] = useState<string[]>([]);
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
    },
  );

  // Fetch rule sets for proxy rules selection
  const { data: ruleSetsData } = useGetProjectRuleSetsQuery(projectId || '', {
    skip: !open || !projectId,
  });

  // Deduplicate commits - keep only unique commit SHAs
  const uniqueDeployments =
    deploymentsData?.deployments.reduce(
      (acc, deployment) => {
        if (!acc.find((d) => d.commitSha === deployment.commitSha)) {
          acc.push(deployment);
        }
        return acc;
      },
      [] as typeof deploymentsData.deployments,
    ) || [];

  // Create a map of rule set ID to rule set for display
  const ruleSetNameMap = new Map(ruleSetsData?.ruleSets.map((rs) => [rs.id, rs]) || []);

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

  // Toggle a rule set in the selection
  const toggleRuleSet = (id: string) => {
    setSelectedRuleSetIds((prev) =>
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id],
    );
  };

  // Remove a rule set from the selection
  const removeRuleSet = (id: string) => {
    setSelectedRuleSetIds((prev) => prev.filter((rid) => rid !== id));
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
          proxyRuleSetIds: selectedRuleSetIds.length > 0 ? selectedRuleSetIds : undefined,
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
      setSelectedRuleSetIds([]);
      setNameError('');
      onOpenChange(false);
    } catch (error: any) {
      // Handle error
      const errorMessage = error?.data?.message || error?.message || 'Failed to create alias';
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
      setSelectedRuleSetIds([]);
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
              {nameError && <p className="text-sm text-destructive">{nameError}</p>}
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

            {/* Proxy Rule Sets Selection (Multi-select) */}
            {ruleSetsData && ruleSetsData.ruleSets.length > 0 && (
              <div className="grid gap-2">
                <Label>Proxy Rule Sets (Optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-between w-full">
                      <span className="text-sm truncate">
                        {selectedRuleSetIds.length === 0
                          ? 'None (use project default)'
                          : `${selectedRuleSetIds.length} rule set${selectedRuleSetIds.length !== 1 ? 's' : ''} selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-2"
                    align="start"
                  >
                    {ruleSetsData.ruleSets.map((ruleSet) => (
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
                          <span className="text-xs text-muted-foreground">
                            ({ruleSet.environment})
                          </span>
                        )}
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
                {/* Show selected rule sets as ordered removable badges */}
                {selectedRuleSetIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedRuleSetIds.map((id, index) => {
                      const rs = ruleSetNameMap.get(id);
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
