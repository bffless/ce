import { useState } from 'react';
import {
  useListApiKeysQuery,
  useCreateApiKeyMutation,
  useDeleteApiKeyMutation,
  type CreateApiKeyResponse,
} from '@/services/apiKeysApi';
import type { Project } from '@/services/projectsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Key, Trash2, Copy, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ProjectApiKeysTabProps {
  project: Project;
}

export function ProjectApiKeysTab({ project }: ProjectApiKeysTabProps) {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [newKeyResponse, setNewKeyResponse] = useState<CreateApiKeyResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Form state
  const [keyName, setKeyName] = useState('');

  // Fetch API keys
  const { data: allKeys, isLoading, error } = useListApiKeysQuery();

  // Filter keys for this project
  const projectKeys = allKeys?.filter((key) => key.projectId === project.id) || [];

  // Mutations
  const [createApiKey, { isLoading: isCreating }] = useCreateApiKeyMutation();
  const [deleteApiKey, { isLoading: isDeleting }] = useDeleteApiKeyMutation();

  const handleCreateKey = async () => {
    if (!keyName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a name for the API key',
        variant: 'destructive',
      });
      return;
    }

    try {
      const response = await createApiKey({
        name: keyName,
        repository: `${project.owner}/${project.name}`,
      }).unwrap();

      setNewKeyResponse(response);
      setKeyName('');

      toast({
        title: 'API Key created',
        description: 'Your new API key has been created. Make sure to copy it now!',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to create API key',
        variant: 'destructive',
      });
    }
  };

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(true);
      toast({
        title: 'Copied!',
        description: 'API key copied to clipboard',
      });
      setTimeout(() => setCopiedKey(false), 2000);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      await deleteApiKey(keyId).unwrap();

      toast({
        title: 'API Key deleted',
        description: 'The API key has been deleted successfully',
      });

      setDeletingKey(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to delete API key',
        variant: 'destructive',
      });
    }
  };

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    setNewKeyResponse(null);
    setKeyName('');
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load API keys. {(error as any)?.data?.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>
              Manage API keys for deploying to this project from CI/CD pipelines
            </CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Key className="h-4 w-4 mr-2" />
                Create API Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {newKeyResponse ? 'API Key Created' : 'Create API Key'}
                </DialogTitle>
                <DialogDescription>
                  {newKeyResponse
                    ? 'Copy your API key now. You won\'t be able to see it again!'
                    : `Create a new API key for ${project.owner}/${project.name}`}
                </DialogDescription>
              </DialogHeader>

              {newKeyResponse ? (
                <div className="space-y-4 py-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Make sure to copy your API key now. You won't be able to see it again!
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={newKeyResponse.key}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyKey(newKeyResponse.key)}
                      >
                        {copiedKey ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={newKeyResponse.data.name} readOnly />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Key Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., GitHub Actions, CI/CD Pipeline"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    This key will only have access to deploy to{' '}
                    <span className="font-semibold">
                      {project.owner}/{project.name}
                    </span>
                  </div>
                </div>
              )}

              <DialogFooter>
                {newKeyResponse ? (
                  <Button onClick={closeCreateDialog}>Done</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateKey} disabled={isCreating}>
                      {isCreating ? 'Creating...' : 'Create Key'}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {projectKeys.length === 0 ? (
          <div className="text-center py-12">
            <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No API keys yet</h3>
            <p className="text-muted-foreground mb-4">
              Create an API key to deploy to this project from CI/CD pipelines
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Key className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {project.owner}/{project.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleDateString()
                      : 'Never'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog
                      open={deletingKey === key.id}
                      onOpenChange={(open) => setDeletingKey(open ? key.id : null)}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingKey(key.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete the API key "{key.name}"? This
                            action cannot be undone and any services using this key will
                            stop working.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setDeletingKey(null)}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteKey(key.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isDeleting}
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
