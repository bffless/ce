import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateProjectMutation } from '@/services/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

interface CreateRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRepositoryDialog({ open, onOpenChange }: CreateRepositoryDialogProps) {
  const navigate = useNavigate();
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const [createProject, { isLoading }] = useCreateProjectMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!owner.trim() || !name.trim()) {
      setError('Owner and name are required');
      return;
    }

    try {
      await createProject({ owner: owner.trim(), name: name.trim() }).unwrap();
      // Reset form and close dialog
      setOwner('');
      setName('');
      onOpenChange(false);
      // Navigate to the new repository
      navigate(`/repo/${owner.trim()}/${name.trim()}`);
    } catch (err: unknown) {
      const error = err as { data?: { message?: string } };
      setError(error.data?.message || 'Failed to create repository');
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Reset form when closing
      setOwner('');
      setName('');
      setError('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Repository</DialogTitle>
          <DialogDescription>
            Create a repository to store your deployments. This typically matches your
            GitHub repository structure.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">{error}</div>
          )}

          <div>
            <Label htmlFor="create-owner">Owner</Label>
            <Input
              id="create-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="your-org"
              required
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">GitHub organization or username</p>
          </div>

          <div>
            <Label htmlFor="create-name">Repository Name</Label>
            <Input
              id="create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              required
              className="mt-1"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Repository'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
