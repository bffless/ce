import { useState } from 'react';
import {
  useGetProjectPermissionsQuery,
  useGrantUserPermissionMutation,
  useRevokeUserPermissionMutation,
  type ProjectRole,
} from '@/services/permissionsApi';
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
import { AlertCircle, UserPlus, Trash2, Edit } from 'lucide-react';
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

interface ProjectMembersTabProps {
  owner: string;
  repo: string;
}

const roleColors: Record<ProjectRole, string> = {
  owner: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  contributor: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

export function ProjectMembersTab({ owner, repo }: ProjectMembersTabProps) {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);

  // Form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<ProjectRole>('viewer');
  const [editRole, setEditRole] = useState<ProjectRole>('viewer');

  // Fetch permissions
  const { data, isLoading, error } = useGetProjectPermissionsQuery({ owner, repo });

  // Mutations
  const [grantPermission, { isLoading: isGranting }] = useGrantUserPermissionMutation();
  const [revokePermission, { isLoading: isRevoking }] = useRevokeUserPermissionMutation();

  const handleAddMember = async () => {
    if (!newUserEmail.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a user email',
        variant: 'destructive',
      });
      return;
    }

    try {
      await grantPermission({
        owner,
        repo,
        dto: {
          userId: newUserEmail, // Note: Backend should lookup user by email
          role: newUserRole,
        },
      }).unwrap();

      toast({
        title: 'Member added',
        description: `${newUserEmail} has been added with ${newUserRole} role`,
      });

      setAddDialogOpen(false);
      setNewUserEmail('');
      setNewUserRole('viewer');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to add member',
        variant: 'destructive',
      });
    }
  };

  const handleChangeRole = async (userId: string) => {
    try {
      // First revoke, then grant new role
      await revokePermission({ owner, repo, userId }).unwrap();
      await grantPermission({
        owner,
        repo,
        dto: { userId, role: editRole },
      }).unwrap();

      toast({
        title: 'Role updated',
        description: `Member role has been updated to ${editRole}`,
      });

      setEditingMember(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update role',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await revokePermission({ owner, repo, userId }).unwrap();

      toast({
        title: 'Member removed',
        description: 'Member has been removed from the project',
      });

      setRemovingMember(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to remove member',
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
          Failed to load project members. {(error as any)?.data?.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const users = data?.userPermissions || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Project Members</CardTitle>
            <CardDescription>
              Manage user access and roles for this project
            </CardDescription>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Project Member</DialogTitle>
                <DialogDescription>
                  Add a user to this project with a specific role
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">User Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={newUserRole} onValueChange={(value) => setNewUserRole(value as ProjectRole)}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer - Read only</SelectItem>
                      <SelectItem value="contributor">Contributor - Can deploy</SelectItem>
                      <SelectItem value="admin">Admin - Can manage settings</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddMember} disabled={isGranting}>
                  {isGranting ? 'Adding...' : 'Add Member'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No members yet. Add your first member to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((permission) => (
                <TableRow key={permission.id}>
                  <TableCell className="font-medium">
                    {permission.user.email}
                    {permission.user.name && (
                      <span className="text-sm text-muted-foreground ml-2">
                        ({permission.user.name})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={roleColors[permission.role]}>
                      {permission.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(permission.grantedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {permission.role !== 'owner' && (
                        <>
                          <Dialog
                            open={editingMember === permission.userId}
                            onOpenChange={(open) =>
                              setEditingMember(open ? permission.userId : null)
                            }
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingMember(permission.userId);
                                  setEditRole(permission.role);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Change Member Role</DialogTitle>
                                <DialogDescription>
                                  Update the role for {permission.user.email}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label htmlFor="edit-role">New Role</Label>
                                  <Select
                                    value={editRole}
                                    onValueChange={(value) => setEditRole(value as ProjectRole)}
                                  >
                                    <SelectTrigger id="edit-role">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="viewer">Viewer - Read only</SelectItem>
                                      <SelectItem value="contributor">
                                        Contributor - Can deploy
                                      </SelectItem>
                                      <SelectItem value="admin">
                                        Admin - Can manage settings
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => setEditingMember(null)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => handleChangeRole(permission.userId)}
                                  disabled={isGranting || isRevoking}
                                >
                                  {isGranting || isRevoking ? 'Updating...' : 'Update Role'}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          <AlertDialog
                            open={removingMember === permission.userId}
                            onOpenChange={(open) =>
                              setRemovingMember(open ? permission.userId : null)
                            }
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRemovingMember(permission.userId)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </DialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Member</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove {permission.user.email} from
                                  this project? They will lose all access immediately.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setRemovingMember(null)}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleRemoveMember(permission.userId)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  disabled={isRevoking}
                                >
                                  {isRevoking ? 'Removing...' : 'Remove'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                      {permission.role === 'owner' && (
                        <span className="text-xs text-muted-foreground px-2">
                          Cannot remove owner
                        </span>
                      )}
                    </div>
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
