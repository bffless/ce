import { useState } from 'react';
import {
  useGetProjectSecretsQuery,
  useSetProjectSecretMutation,
  useDeleteProjectSecretMutation,
  Project,
} from '@/services/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KeyRound, Plus, Trash2, Loader2, XCircle, AlertTriangle, Info } from 'lucide-react';

// Mirrors the backend SECRET_NAME_PATTERN (project-secrets.service.ts)
const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Project secrets management. Values are write-only — once saved they can never
 * be read back, only overwritten (rotated) or deleted. Pipelines reference them
 * as `secrets.<NAME>`.
 */
export function ProjectSecretsSection({ project }: { project: Project }) {
  const { data, isLoading } = useGetProjectSecretsQuery(project.id);
  const [setSecret, { isLoading: isSaving }] = useSetProjectSecretMutation();
  const [deleteSecret] = useDeleteProjectSecretMutation();

  const [showDialog, setShowDialog] = useState(false);
  // When set, the dialog rotates an existing secret (name locked).
  const [rotateName, setRotateName] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const secrets = data?.secrets || [];

  const openAdd = () => {
    setRotateName(null);
    setName('');
    setValue('');
    setError(null);
    setShowDialog(true);
  };

  const openRotate = (secretName: string) => {
    setRotateName(secretName);
    setName(secretName);
    setValue('');
    setError(null);
    setShowDialog(true);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Secret name is required');
      return;
    }
    if (!SECRET_NAME_PATTERN.test(trimmedName)) {
      setError(
        'Name must be uppercase letters, digits and underscores, and may not start with a digit (e.g. HF_TOKEN)',
      );
      return;
    }
    if (!value) {
      setError('Secret value is required');
      return;
    }
    try {
      setError(null);
      await setSecret({ projectId: project.id, name: trimmedName, value }).unwrap();
      setShowDialog(false);
      setName('');
      setValue('');
    } catch (err: unknown) {
      const e = err as { data?: { message?: string } };
      setError(e.data?.message || 'Failed to save secret');
    }
  };

  const handleDelete = async (secretName: string) => {
    try {
      setDeletingName(secretName);
      await deleteSecret({ projectId: project.id, name: secretName }).unwrap();
    } catch (err) {
      console.error('Failed to delete secret:', err);
    } finally {
      setDeletingName(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Secrets
            </CardTitle>
            <CardDescription>
              Encrypted values (API tokens, keys) that pipelines can use as{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">secrets.NAME</code>. Values
              can&apos;t be viewed after saving — only rotated or deleted.
            </CardDescription>
          </div>
          {secrets.length > 0 && (
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Secret
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading secrets...
          </div>
        ) : secrets.length > 0 ? (
          <div className="space-y-2">
            {secrets.map((secret) => (
              <div
                key={secret.name}
                className="border rounded-md p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-md bg-muted">
                    <KeyRound className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <code className="text-sm font-mono">{secret.name}</code>
                    <p className="text-xs text-muted-foreground">
                      Updated {new Date(secret.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => openRotate(secret.name)}>
                    Update value
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(secret.name)}
                    disabled={deletingName === secret.name}
                    className="text-destructive hover:text-destructive"
                    title="Delete secret"
                  >
                    {deletingName === secret.name ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />
              <span className="text-muted-foreground">No secrets configured</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Add a secret to use third-party tokens (e.g. a Hugging Face token) in pipeline steps
              without storing them in plain text.
            </p>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Secret
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) {
            setName('');
            setValue('');
            setError(null);
            setRotateName(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>{rotateName ? `Update ${rotateName}` : 'Add Secret'}</DialogTitle>
            <DialogDescription>
              {rotateName
                ? 'Enter a new value. The previous value is overwritten and cannot be recovered.'
                : 'Secrets are encrypted at rest and used by pipelines as secrets.NAME.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                placeholder="HF_TOKEN"
                className="mt-1 font-mono"
                disabled={!!rotateName}
                autoComplete="off"
              />
              {!rotateName && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Uppercase letters, digits and underscores. Reference as{' '}
                  <code className="bg-muted px-1 rounded">secrets.{name || 'NAME'}</code>
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste secret value"
                className="mt-1 font-mono"
                autoComplete="off"
              />
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                For security, this value can&apos;t be viewed again after saving.
              </AlertDescription>
            </Alert>

            {error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || !value || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : rotateName ? (
                'Update Secret'
              ) : (
                'Add Secret'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
