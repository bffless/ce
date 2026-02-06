import { useState } from 'react';
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
import { useCreateRuleSetMutation } from '@/services/proxyRulesApi';
import { useToast } from '@/hooks/use-toast';

interface CreateRuleSetDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRuleSetDialog({ projectId, open, onOpenChange }: CreateRuleSetDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [createRuleSet, { isLoading }] = useCreateRuleSetMutation();

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
      await createRuleSet({
        projectId,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          environment: environment.trim() || undefined,
        },
      }).unwrap();

      toast({
        title: 'Rule set created',
        description: `Rule set "${name}" has been created.`,
      });

      // Reset form and close
      setName('');
      setDescription('');
      setEnvironment('');
      setErrors({});
      onOpenChange(false);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to create rule set';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setName('');
      setDescription('');
      setEnvironment('');
      setErrors({});
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Rule Set</DialogTitle>
          <DialogDescription>
            Create a new proxy rule set that can be assigned to aliases.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
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
            <Label htmlFor="environment">Environment (optional)</Label>
            <Input
              id="environment"
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
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Proxy rules for API backend..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Rule Set'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
