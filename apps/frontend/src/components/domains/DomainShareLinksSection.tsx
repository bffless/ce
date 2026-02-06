import { useState } from 'react';
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
  Check,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useGetShareLinksByDomainQuery,
  useCreateShareLinkMutation,
  useUpdateShareLinkMutation,
  useDeleteShareLinkMutation,
  useRegenerateShareLinkTokenMutation,
  type ShareLink,
} from '@/services/shareLinksApi';

interface DomainShareLinksSectionProps {
  domainId: string;
  domain: string;
  wwwBehavior?: string | null;
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

export function DomainShareLinksSection({
  domainId,
  domain,
  wwwBehavior,
}: DomainShareLinksSectionProps) {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingLink, setDeletingLink] = useState<ShareLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState('');
  const [expiration, setExpiration] = useState<string>('never');

  const {
    data: shareLinks,
    isLoading,
    error,
  } = useGetShareLinksByDomainQuery(domainId);

  const [createShareLink, { isLoading: isCreating }] =
    useCreateShareLinkMutation();
  const [updateShareLink] = useUpdateShareLinkMutation();
  const [deleteShareLink, { isLoading: isDeleting }] =
    useDeleteShareLinkMutation();
  const [regenerateToken] = useRegenerateShareLinkTokenMutation();

  const buildShareUrl = (token: string) => {
    let effectiveDomain = domain;
    if (wwwBehavior === 'redirect-to-www' && !domain.startsWith('www.')) {
      effectiveDomain = `www.${domain}`;
    } else if (wwwBehavior === 'redirect-to-root' && domain.startsWith('www.')) {
      effectiveDomain = domain.slice(4);
    }
    return `https://${effectiveDomain}/?token=${token}`;
  };

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

      await createShareLink({
        domainMappingId: domainId,
        label: label || undefined,
        expiresAt,
      }).unwrap();

      setLabel('');
      setExpiration('never');
      setShowCreateDialog(false);

      toast({
        title: 'Share link created',
        description: `Share link created for ${domain}.`,
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
        domainMappingId: domainId,
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
        domainMappingId: domainId,
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
        domainMappingId: domainId,
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
    return <Skeleton className="h-24" />;
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
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Share links scoped to this domain only.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        {shareLinks && shareLinks.length > 0 ? (
          <div className="space-y-2">
            {shareLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between p-2 rounded border text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium">
                    {link.label || 'Untitled'}
                  </span>
                  {getStatusBadge(link)}
                  <span className="text-muted-foreground text-xs">
                    {link.useCount} uses
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() =>
                      copyToClipboard(buildShareUrl(link.token), link.id)
                    }
                    title="Copy share URL"
                  >
                    {copiedId === link.id ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleToggleActive(link)}
                  >
                    {link.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => handleRegenerate(link)}
                    title="Regenerate token"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => {
                      setDeletingLink(link);
                      setShowDeleteDialog(true);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center py-4 text-muted-foreground text-sm">
            No share links for this domain.
          </p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Share Link</DialogTitle>
            <DialogDescription>
              Create a link for <strong>{domain}</strong>. Anyone with the link
              can view content served on this domain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="domain-share-label">Label (optional)</Label>
              <Input
                id="domain-share-label"
                placeholder="e.g., For recruiter"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain-share-expiration">Expiration</Label>
              <Select value={expiration} onValueChange={setExpiration}>
                <SelectTrigger id="domain-share-expiration">
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
