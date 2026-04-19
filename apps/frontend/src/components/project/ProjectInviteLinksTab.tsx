import { useState } from 'react';
import {
  useGetProjectInviteLinksQuery,
  useCreateProjectInviteLinkMutation,
  useUpdateProjectInviteLinkMutation,
  useDeleteProjectInviteLinkMutation,
} from '@/services/projectInviteLinksApi';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, Link2, Trash2, Copy, Check } from 'lucide-react';
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

interface ProjectInviteLinksTabProps {
  owner: string;
  repo: string;
}

const roleColors: Record<string, string> = {
  guest: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  contributor: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
};

export function ProjectInviteLinksTab({ owner, repo }: ProjectInviteLinksTabProps) {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [newRole, setNewRole] = useState('guest');
  const [newLabel, setNewLabel] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');

  const { data: links, isLoading, error } = useGetProjectInviteLinksQuery({ owner, repo });
  const [createLink, { isLoading: isCreating }] = useCreateProjectInviteLinkMutation();
  const [updateLink] = useUpdateProjectInviteLinkMutation();
  const [deleteLink, { isLoading: isDeleting }] = useDeleteProjectInviteLinkMutation();

  const getInviteUrl = (token: string) => {
    const base = window.location.origin;
    return `${base}/signup?projectInvite=${token}`;
  };

  const handleCopy = async (token: string, id: string) => {
    try {
      await navigator.clipboard.writeText(getInviteUrl(token));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: 'Copied', description: 'Invite link copied to clipboard' });
    } catch {
      toast({ title: 'Error', description: 'Failed to copy link', variant: 'destructive' });
    }
  };

  const handleCreate = async () => {
    try {
      await createLink({
        owner,
        repo,
        dto: {
          role: newRole,
          label: newLabel || undefined,
          maxUses: newMaxUses ? parseInt(newMaxUses, 10) : undefined,
        },
      }).unwrap();

      toast({ title: 'Invite link created', description: 'Share the link to invite users' });
      setCreateDialogOpen(false);
      setNewRole('guest');
      setNewLabel('');
      setNewMaxUses('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to create invite link',
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateLink({ owner, repo, id, dto: { isActive: !isActive } }).unwrap();
      toast({
        title: isActive ? 'Link disabled' : 'Link enabled',
        description: isActive ? 'The invite link is now inactive' : 'The invite link is now active',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update invite link',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLink({ owner, repo, id }).unwrap();
      toast({ title: 'Link deleted', description: 'The invite link has been removed' });
      setDeletingId(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to delete invite link',
        variant: 'destructive',
      });
    }
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
          Failed to load invite links. {(error as any)?.data?.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Invite Links</CardTitle>
            <CardDescription>
              Create shareable links that auto-grant project access on signup or login
            </CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Link2 className="h-4 w-4 mr-2" />
                Create Invite Link
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Invite Link</DialogTitle>
                <DialogDescription>
                  Anyone who signs up or logs in with this link will be added to the project
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="guest">Guest - Site access only</SelectItem>
                      <SelectItem value="viewer">Viewer - Read only admin</SelectItem>
                      <SelectItem value="contributor">Contributor - Can deploy</SelectItem>
                      <SelectItem value="admin">Admin - Can manage settings</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="label">Label (optional)</Label>
                  <Input
                    id="label"
                    placeholder="e.g., Graduation guests"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxUses">Max uses (optional)</Label>
                  <Input
                    id="maxUses"
                    type="number"
                    placeholder="Unlimited"
                    value={newMaxUses}
                    onChange={(e) => setNewMaxUses(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty for unlimited uses
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isCreating}>
                  {isCreating ? 'Creating...' : 'Create Link'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!links || links.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No invite links yet. Create one to share with users.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => {
                const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
                const isMaxed = link.maxUses !== null && link.useCount >= link.maxUses;

                return (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">
                      {link.label || <span className="text-muted-foreground">No label</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={roleColors[link.role] || ''}>
                        {link.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {link.useCount}
                      {link.maxUses !== null && ` / ${link.maxUses}`}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={link.isActive}
                          onCheckedChange={() => handleToggleActive(link.id, link.isActive)}
                        />
                        <span className="text-sm text-muted-foreground">
                          {isExpired ? 'Expired' : isMaxed ? 'Max reached' : link.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(link.token, link.id)}
                        >
                          {copiedId === link.id ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <AlertDialog
                          open={deletingId === link.id}
                          onOpenChange={(open) => setDeletingId(open ? link.id : null)}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingId(link.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Invite Link</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this invite link. Users who already
                                accepted will keep their access.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setDeletingId(null)}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(link.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={isDeleting}
                              >
                                {isDeleting ? 'Deleting...' : 'Delete'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
