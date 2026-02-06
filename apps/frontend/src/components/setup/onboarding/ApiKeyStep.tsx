import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useCreateApiKeyMutation } from '@/services/apiKeysApi';
import { useListUserProjectsQuery } from '@/services/projectsApi';
import { setCreatedApiKey } from '@/store/slices/setupSlice';
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
import { Copy, AlertTriangle, Loader2 } from 'lucide-react';

interface ApiKeyStepProps {
  projectId: string | null;
  onNext: () => void;
  onSkip: () => void;
}

export function ApiKeyStep({ projectId, onNext, onSkip }: ApiKeyStepProps) {
  const dispatch = useDispatch();
  const [keyName, setKeyName] = useState('github-actions');
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const { data: projects } = useListUserProjectsQuery();
  const [createApiKey, { isLoading }] = useCreateApiKeyMutation();

  // Pre-select the created project if available
  const defaultRepo = projectId && projects?.find(p => p.id === projectId)
    ? `${projects.find(p => p.id === projectId)?.owner}/${projects.find(p => p.id === projectId)?.name}`
    : '';

  const handleGenerate = async () => {
    setError('');

    const repoToUse = selectedRepo || defaultRepo;
    if (!repoToUse) {
      setError('Please select a repository');
      return;
    }

    try {
      const result = await createApiKey({ name: keyName, repository: repoToUse }).unwrap();
      setGeneratedKey(result.key);
      dispatch(setCreatedApiKey(result.key));
    } catch (err: unknown) {
      const error = err as { data?: { message?: string } };
      setError(error.data?.message || 'Failed to generate API key');
    }
  };

  const handleCopy = async () => {
    if (generatedKey) {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (generatedKey) {
    return (
      <div className="space-y-4">
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-yellow-800 dark:text-yellow-400">Save this API key now!</h4>
              <p className="text-sm text-yellow-700 dark:text-yellow-500 mt-1">
                This key will only be shown once. Store it securely - you won't be able
                to see it again.
              </p>
            </div>
          </div>
        </div>

        <div>
          <Label>Your API Key</Label>
          <div className="flex mt-1 gap-2">
            <Input value={generatedKey} readOnly className="font-mono text-sm" />
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
            >
              <Copy className="w-4 h-4 mr-2" />
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={onNext}>Continue to GitHub Actions</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Generate an API key to authenticate deployments from your CI/CD pipeline.
      </p>

      {error && (
        <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">{error}</div>
      )}

      <div>
        <Label htmlFor="keyName">Key Name</Label>
        <Input
          id="keyName"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="github-actions"
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          A descriptive name to identify this key
        </p>
      </div>

      <div>
        <Label htmlFor="repository">Repository</Label>
        <Select
          value={selectedRepo || defaultRepo}
          onValueChange={setSelectedRepo}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select a repository" />
          </SelectTrigger>
          <SelectContent>
            {projects?.map((project) => (
              <SelectItem key={project.id} value={`${project.owner}/${project.name}`}>
                {project.owner}/{project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          The repository this key will have access to
        </p>
      </div>

      <div className="flex justify-between pt-4">
        <Button type="button" variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
        <Button onClick={handleGenerate} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            'Generate API Key'
          )}
        </Button>
      </div>
    </div>
  );
}
