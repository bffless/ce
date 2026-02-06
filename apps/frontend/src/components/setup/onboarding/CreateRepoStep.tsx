import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useCreateProjectMutation } from '@/services/projectsApi';
import { setCreatedProject } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface CreateRepoStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export function CreateRepoStep({ onNext, onSkip }: CreateRepoStepProps) {
  const dispatch = useDispatch();
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
      const result = await createProject({ owner: owner.trim(), name: name.trim() }).unwrap();
      dispatch(setCreatedProject(result.id));
      onNext();
    } catch (err: unknown) {
      const error = err as { data?: { message?: string } };
      setError(error.data?.message || 'Failed to create repository');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Create a repository to store your deployments. This typically matches your
        GitHub repository structure.
      </p>

      {error && (
        <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">{error}</div>
      )}

      <div>
        <Label htmlFor="owner">Owner</Label>
        <Input
          id="owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="your-org"
          required
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">GitHub organization or username</p>
      </div>

      <div>
        <Label htmlFor="name">Repository Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-app"
          required
          className="mt-1"
        />
      </div>

      <div className="flex justify-between pt-4">
        <Button type="button" variant="ghost" onClick={onSkip}>
          Skip for now
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
  );
}
