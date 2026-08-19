import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useGenerateStateSchemaMutation } from '@/services/pipelineSchemasApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';

export type StateScope = 'global' | 'user';

interface GenerateStateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

/**
 * Modal for generating a state schema with pipelines for the @bffless/use-bff-state hook.
 * Creates a schema with key/value/user_id/guest_id/version fields and GET/POST pipelines.
 */
export function GenerateStateModal({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: GenerateStateModalProps) {
  const { toast } = useToast();
  const [schemaName, setSchemaName] = useState('');
  const [scope, setScope] = useState<StateScope>('user');
  const [ruleSetId, setRuleSetId] = useState<string>('');

  const [generateStateSchema, { isLoading }] = useGenerateStateSchemaMutation();
  const { data: ruleSetsData } = useGetProjectRuleSetsQuery(projectId, {
    skip: !open,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!schemaName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a schema name',
        variant: 'destructive',
      });
      return;
    }

    // Validate schema name format (lowercase, underscores, numbers)
    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(schemaName)) {
      toast({
        title: 'Invalid Schema Name',
        description:
          'Schema name must start with a letter and contain only lowercase letters, numbers, and underscores',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await generateStateSchema({
        projectId,
        name: schemaName,
        scope,
        ...(ruleSetId && ruleSetId !== 'new' ? { ruleSetId } : {}),
      }).unwrap();

      toast({
        title: 'State Schema Generated',
        description: `Created schema "${result.schema.name}" with ${result.pipelines.length} pipeline(s)`,
      });

      onOpenChange(false);
      setSchemaName('');
      setScope('user');
      setRuleSetId('');
      onSuccess?.();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to generate state schema';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setSchemaName('');
      setScope('user');
      setRuleSetId('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate State Schema</DialogTitle>
          <DialogDescription>
            Create a schema and pipelines for use with{' '}
            <a
              href="https://github.com/bffless/use-bff-state"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:no-underline"
            >
              @bffless/use-bff-state
            </a>{' '}
            React hook. This will generate GET and POST endpoints for persistent state management.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="schema-name">Schema Name</Label>
              <Input
                id="schema-name"
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value.toLowerCase())}
                placeholder="e.g., user_state, cart_state, feature_flags"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Use lowercase letters, numbers, and underscores. This will be the table name.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Scope</Label>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as StateScope)}
                disabled={isLoading}
              >
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="user" id="scope-user" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="scope-user" className="font-medium cursor-pointer">
                      User-scoped
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      State is isolated per user/guest. Uses auth user ID or guest ID cookie. Best
                      for: carts, preferences, session data.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="global" id="scope-global" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="scope-global" className="font-medium cursor-pointer">
                      Global
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      State is shared across all users. Lookup by key only. Best for: feature flags,
                      site settings, public data.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-set">Proxy Rule Set</Label>
              <Select value={ruleSetId} onValueChange={setRuleSetId} disabled={isLoading}>
                <SelectTrigger id="rule-set">
                  <SelectValue placeholder="Create new rule set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new rule set</SelectItem>
                  {ruleSetsData?.ruleSets?.map((ruleSet) => (
                    <SelectItem key={ruleSet.id} value={ruleSet.id}>
                      {ruleSet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Add GET/POST pipelines to an existing rule set or create a new one.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
