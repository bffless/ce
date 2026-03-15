import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateRuleSetMutation, type ProxyRuleSet } from '@/services/proxyRulesApi';
import { useToast } from '@/hooks/use-toast';

interface EditRuleSetDialogProps {
  ruleSet: ProxyRuleSet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRuleSetDialog({ ruleSet, open, onOpenChange }: EditRuleSetDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(ruleSet.name);
  const [description, setDescription] = useState(ruleSet.description || '');
  const [environment, setEnvironment] = useState(ruleSet.environment || '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [updateRuleSet, { isLoading }] = useUpdateRuleSetMutation();

  // Reset form when ruleSet changes or dialog opens
  useEffect(() => {
    if (open) {
      setName(ruleSet.name);
      setDescription(ruleSet.description || '');
      setEnvironment(ruleSet.environment || '');
      setErrors({});
    }
  }, [open, ruleSet]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    } else if (name.length > 255) {
      newErrors.name = 'Name must be 255 characters or less';
    }

    if (environment && environment.length > 50) {
      newErrors.environment = 'Environment must be 50 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    try {
      await updateRuleSet({
        id: ruleSet.id,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          environment: environment.trim() || undefined,
        },
      }).unwrap();

      toast({
        title: 'Rule set updated',
        description: `Rule set "${name}" has been updated.`,
      });

      onOpenChange(false);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to update rule set';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Rule Set</DialogTitle>
          <DialogDescription>
            Update the name, environment, or description for this rule set.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name *</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api-backend"
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name}</p>
            ) : (
              <p className="text-xs text-muted-foreground">A unique name for this rule set</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-environment">Environment (optional)</Label>
            <Input
              id="edit-environment"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              placeholder="production, staging, dev"
              className={errors.environment ? 'border-destructive' : ''}
            />
            {errors.environment ? (
              <p className="text-xs text-destructive">{errors.environment}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Tag for the environment this rule set is intended for
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description (optional)</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Proxy rules for API backend..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
