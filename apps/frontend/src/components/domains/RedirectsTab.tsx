import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus, ArrowRight, Loader2 } from 'lucide-react';
import {
  useGetPathRedirectsQuery,
  useCreatePathRedirectMutation,
  useDeletePathRedirectMutation,
  useUpdatePathRedirectMutation,
} from '@/services/domainsApi';
import { useToast } from '@/hooks/use-toast';

interface RedirectsTabProps {
  domainId: string;
  targetDomain: string;
}

export function RedirectsTab({ domainId, targetDomain }: RedirectsTabProps) {
  const { toast } = useToast();
  const [newSourcePath, setNewSourcePath] = useState('');
  const [newTargetPath, setNewTargetPath] = useState('');
  const [newRedirectType, setNewRedirectType] = useState<'301' | '302'>('301');

  const { data: pathRedirects = [], isLoading } = useGetPathRedirectsQuery(domainId);
  const [createPathRedirect, { isLoading: isCreating }] = useCreatePathRedirectMutation();
  const [deletePathRedirect] = useDeletePathRedirectMutation();
  const [updatePathRedirect] = useUpdatePathRedirectMutation();

  const handleCreate = async () => {
    if (!newSourcePath.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a source path',
        variant: 'destructive',
      });
      return;
    }

    if (!newTargetPath.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a target path',
        variant: 'destructive',
      });
      return;
    }

    // Ensure paths start with /
    const sourcePath = newSourcePath.startsWith('/') ? newSourcePath : `/${newSourcePath}`;
    const targetPath = newTargetPath.startsWith('/') ? newTargetPath : `/${newTargetPath}`;

    try {
      await createPathRedirect({
        domainId,
        body: {
          sourcePath: sourcePath.trim(),
          targetPath: targetPath.trim(),
          redirectType: newRedirectType,
        },
      }).unwrap();
      setNewSourcePath('');
      setNewTargetPath('');
      toast({
        title: 'Redirect created',
        description: `${sourcePath} will now redirect to ${targetPath}`,
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to create redirect';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (pathRedirectId: string, sourcePath: string) => {
    if (!confirm(`Are you sure you want to delete the redirect from ${sourcePath}?`)) {
      return;
    }

    try {
      await deletePathRedirect({ pathRedirectId, domainId }).unwrap();
      toast({
        title: 'Redirect deleted',
        description: `Removed redirect from ${sourcePath}`,
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to delete redirect';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (pathRedirectId: string, currentActive: boolean) => {
    try {
      await updatePathRedirect({
        pathRedirectId,
        domainId,
        body: { isActive: !currentActive },
      }).unwrap();
      toast({
        title: currentActive ? 'Redirect disabled' : 'Redirect enabled',
        description: currentActive
          ? 'The redirect has been disabled'
          : 'The redirect is now active',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to update redirect';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-2">Path Redirects</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Configure path-level redirects for{' '}
          <strong className="font-mono text-xs">{targetDomain}</strong>.
          Visitors to the source path will be redirected to the target path.
        </p>
      </div>

      {/* Existing Path Redirects */}
      <div className="space-y-2">
        {pathRedirects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-md bg-muted/30">
            No path redirects configured. Add a redirect below.
          </p>
        ) : (
          pathRedirects.map((redirect) => (
            <div
              key={redirect.id}
              className="flex items-start justify-between p-3 border rounded-md gap-2"
            >
              <div className="flex-1 min-w-0 overflow-hidden">
                {/* Show source path → target path */}
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-sm truncate" title={redirect.sourcePath}>
                    {redirect.sourcePath}
                  </span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <span className="font-mono text-sm truncate" title={redirect.targetPath}>
                    {redirect.targetPath}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-muted rounded flex-shrink-0">
                    {redirect.redirectType}
                  </span>
                </div>
                {/* Status indicator */}
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-xs ${redirect.isActive ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {redirect.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch
                  checked={redirect.isActive}
                  onCheckedChange={() =>
                    handleToggleActive(redirect.id, redirect.isActive)
                  }
                  aria-label={redirect.isActive ? 'Disable redirect' : 'Enable redirect'}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleDelete(redirect.id, redirect.sourcePath)}
                  aria-label="Delete redirect"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add New Path Redirect */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-medium mb-3">Add Path Redirect</h4>
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <Input
                placeholder="/old-page"
                value={newSourcePath}
                onChange={(e) => setNewSourcePath(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">Source path</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1">
              <Input
                placeholder="/new-page"
                value={newTargetPath}
                onChange={(e) => setNewTargetPath(e.target.value)}
                className="font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">Target path</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Select
              value={newRedirectType}
              onValueChange={(v) => setNewRedirectType(v as '301' | '302')}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="301">301</SelectItem>
                <SelectItem value="302">302</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleCreate} disabled={isCreating} className="flex-1">
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Redirect
                </>
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          <strong>301</strong> = Permanent redirect (recommended for SEO),{' '}
          <strong>302</strong> = Temporary redirect.
          Use <code className="bg-muted px-1 rounded">*</code> for wildcards (e.g., <code className="bg-muted px-1 rounded">/old-blog/*</code>).
        </p>
      </div>
    </div>
  );
}
