import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
} from '@/components/ui/dialog';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  Plus,
  Trash2,
  Copy,
  RefreshCw,
  Link,
  Check,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/services/projectsApi';
import { useListDomainsQuery } from '@/services/domainsApi';
import {
  useGetShareLinksByProjectQuery,
  useCreateShareLinkMutation,
  useUpdateShareLinkMutation,
  useDeleteShareLinkMutation,
  useRegenerateShareLinkTokenMutation,
  type ShareLink,
} from '@/services/shareLinksApi';

interface ProjectShareLinksTabProps {
  project: Project;
}

function getStatusBadge(link: ShareLink) {
  if (!link.isActive) {
    return <Badge variant="secondary">Disabled</Badge>;
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return <Badge variant="destructive">Expired</Badge>;
  }
  return <Badge variant="default">Active</Badge>;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
}

export function ProjectShareLinksTab({ project }: ProjectShareLinksTabProps) {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingLink, setDeletingLink] = useState<ShareLink | null>(null);
  const [createdLink, setCreatedLink] = useState<ShareLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState('');
  const [expiration, setExpiration] = useState<string>('never');

  const {
    data: shareLinks,
    isLoading,
    error,
  } = useGetShareLinksByProjectQuery(project.id);

  // Fetch domain mappings to build proper share URLs
  const { data: domains } = useListDomainsQuery({
    projectId: project.id,
    isActive: true,
  });

  // Find the best domain for share URLs: prefer primary, then first non-redirect domain
  const primaryDomain = domains?.find((d) => d.isPrimary && d.domainType !== 'redirect');
  const firstDomain = domains?.find((d) => d.domainType !== 'redirect');
  const shareDomain = primaryDomain || firstDomain;

  const buildShareUrl = (token: string): string => {
    if (shareDomain) {
      let domain = shareDomain.domain;
      // Use the canonical domain based on wwwBehavior
      if (shareDomain.wwwBehavior === 'redirect-to-www' && !domain.startsWith('www.')) {
        domain = `www.${domain}`;
      } else if (shareDomain.wwwBehavior === 'redirect-to-root' && domain.startsWith('www.')) {
        domain = domain.slice(4);
      }
      return `https://${domain}/?token=${token}`;
    }
    // Fallback to path-based URL on current origin
    return `${window.location.origin}/public/${project.owner}/${project.name}/?token=${token}`;
  };

  const [createShareLink, { isLoading: isCreating }] =
    useCreateShareLinkMutation();
  const [updateShareLink] = useUpdateShareLinkMutation();
  const [deleteShareLink, { isLoading: isDeleting }] =
    useDeleteShareLinkMutation();
  const [regenerateToken] = useRegenerateShareLinkTokenMutation();

  const handleCreate = async () => {
    try {
      let expiresAt: string | null = null;
      if (expiration !== 'never') {
        const now = new Date();
        const ms = {
          '1d': 86400000,
          '7d': 604800000,
          '30d': 2592000000,
        }[expiration];
        if (ms) {
          expiresAt = new Date(now.getTime() + ms).toISOString();
        }
      }

      const link = await createShareLink({
        projectId: project.id,
        label: label || undefined,
        expiresAt,
      }).unwrap();

      setCreatedLink(link);
      setLabel('');
      setExpiration('never');
      setShowCreateDialog(false);

      toast({
        title: 'Share link created',
        description: 'Copy the URL to share with others.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description:
          (err as { data?: { message?: string } })?.data?.message ||
          'Failed to create share link',
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (link: ShareLink) => {
    try {
      await updateShareLink({
        id: link.id,
        updates: { isActive: !link.isActive },
        projectId: project.id,
      }).unwrap();
      toast({
        title: link.isActive ? 'Share link disabled' : 'Share link enabled',
      });
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description:
          (err as { data?: { message?: string } })?.data?.message ||
          'Failed to update share link',
        variant: 'destructive',
      });
    }
  };

  const handleRegenerate = async (link: ShareLink) => {
    try {
      await regenerateToken({
        id: link.id,
        projectId: project.id,
      }).unwrap();
      toast({
        title: 'Token regenerated',
        description: 'The old token will no longer work.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description:
          (err as { data?: { message?: string } })?.data?.message ||
          'Failed to regenerate token',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingLink) return;
    try {
      await deleteShareLink({
        id: deletingLink.id,
        projectId: project.id,
      }).unwrap();
      toast({ title: 'Share link deleted' });
      setShowDeleteDialog(false);
      setDeletingLink(null);
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description:
          (err as { data?: { message?: string } })?.data?.message ||
          'Failed to delete share link',
        variant: 'destructive',
      });
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy to clipboard.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load share links.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Link className="h-5 w-5" />
                Share Links
              </CardTitle>
              <CardDescription>
                Create links that allow anyone to view private content without
                an account. Project-level links grant access to all content in
                this project.
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Share Link
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Show created link URL */}
          {createdLink && (
            <Alert className="mb-4">
              <Link className="h-4 w-4" />
              <AlertDescription>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-2 py-1 rounded break-all">
                    {buildShareUrl(createdLink.token)}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(
                        buildShareUrl(createdLink.token),
                        'created',
                      )
                    }
                  >
                    {copiedId === 'created' ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreatedLink(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {shareLinks && shareLinks.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareLinks.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">
                      {link.label || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {link.token}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() =>
                            copyToClipboard(
                              buildShareUrl(link.token),
                              link.id,
                            )
                          }
                        >
                          {copiedId === link.id ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(link)}</TableCell>
                    <TableCell>{link.useCount}</TableCell>
                    <TableCell>{formatDate(link.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(link)}
                        >
                          {link.isActive ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleRegenerate(link)}
                          title="Regenerate token"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => {
                            setDeletingLink(link);
                            setShowDeleteDialog(true);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No share links yet. Create one to share private content without
              requiring authentication.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Share Link</DialogTitle>
            <DialogDescription>
              Create a link that grants access to all private content in this
              project. Anyone with the link can view deployments without
              logging in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="share-label">Label (optional)</Label>
              <Input
                id="share-label"
                placeholder="e.g., For recruiter, Client preview"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-expiration">Expiration</Label>
              <Select value={expiration} onValueChange={setExpiration}>
                <SelectTrigger id="share-expiration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="1d">1 day</SelectItem>
                  <SelectItem value="7d">7 days</SelectItem>
                  <SelectItem value="30d">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Share Link</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke access for anyone using this link.
              {deletingLink?.label && (
                <span className="block mt-1 font-medium">
                  "{deletingLink.label}"
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
