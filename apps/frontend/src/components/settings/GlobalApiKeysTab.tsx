import { useState } from 'react';
import {
  useListApiKeysQuery,
  useCreateApiKeyMutation,
  useDeleteApiKeyMutation,
  type CreateApiKeyResponse,
} from '@/services/apiKeysApi';
import { useGetSessionQuery } from '@/services/authApi';
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
import { AlertCircle, Key, Trash2, Copy, CheckCircle, Globe } from 'lucide-react';
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

export function GlobalApiKeysTab() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [newKeyResponse, setNewKeyResponse] = useState<CreateApiKeyResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Form state
  const [keyName, setKeyName] = useState('');

  // Get current user to check if admin
  const { data: sessionData } = useGetSessionQuery();
  const isAdmin = sessionData?.user?.role === 'admin';

  // Fetch all API keys for the current user
  const { data: allKeys, isLoading, error } = useListApiKeysQuery();

  // Mutations
  const [createApiKey, { isLoading: isCreating }] = useCreateApiKeyMutation();
  const [deleteApiKey, { isLoading: isDeleting }] = useDeleteApiKeyMutation();

  const handleCreateGlobalKey = async () => {
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
        isGlobal: true,
      }).unwrap();

      setNewKeyResponse(response);
      setKeyName('');

      toast({
        title: 'Global API Key created',
        description: 'Your new global API key has been created. Make sure to copy it now!',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to create global API key',
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

  // Format scope display
  const formatScope = (key: NonNullable<typeof allKeys>[0]) => {
    if (key.isGlobal) {
      return (
        <Badge variant="default" className="flex items-center gap-1 w-fit">
          <Globe className="h-3 w-3" />
          Global
        </Badge>
      );
    }
    if (key.project) {
      return (
        <Badge variant="secondary">
          {key.project.owner}/{key.project.name}
        </Badge>
      );
    }
    return <Badge variant="outline">Unknown</Badge>;
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
              View all your API keys. Global keys can access any project you have permissions on.
            </CardDescription>
          </div>
          {isAdmin && (
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Globe className="h-4 w-4 mr-2" />
                  Create Global API Key
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {newKeyResponse ? 'Global API Key Created' : 'Create Global API Key'}
                  </DialogTitle>
                  <DialogDescription>
                    {newKeyResponse
                      ? "Copy your API key now. You won't be able to see it again!"
                      : 'Create a global API key that can access all projects you have permissions on'}
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
                    <div className="space-y-2">
                      <Label>Scope</Label>
                      <div>
                        <Badge variant="default" className="flex items-center gap-1 w-fit">
                          <Globe className="h-3 w-3" />
                          Global
                        </Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Key Name</Label>
                      <Input
                        id="name"
                        placeholder="e.g., CI/CD Pipeline, Cross-project Deploy"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                      />
                    </div>
                    <Alert>
                      <Globe className="h-4 w-4" />
                      <AlertDescription>
                        This key will have access to all projects you have permissions on. Use with
                        caution.
                      </AlertDescription>
                    </Alert>
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
                      <Button onClick={handleCreateGlobalKey} disabled={isCreating}>
                        {isCreating ? 'Creating...' : 'Create Global Key'}
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!allKeys || allKeys.length === 0 ? (
          <div className="text-center py-12">
            <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No API keys yet</h3>
            <p className="text-muted-foreground mb-4">
              {isAdmin
                ? 'Create a global API key for cross-project access, or create project-specific keys in project settings.'
                : 'Create project-specific API keys in project settings.'}
            </p>
            {isAdmin && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Globe className="h-4 w-4 mr-2" />
                Create Global API Key
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>{formatScope(key)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
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
                            Are you sure you want to delete the API key "{key.name}"?{' '}
                            {key.isGlobal && (
                              <span className="font-semibold">
                                This is a global key that may be used across multiple projects.
                              </span>
                            )}{' '}
                            This action cannot be undone and any services using this key will stop
                            working.
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
