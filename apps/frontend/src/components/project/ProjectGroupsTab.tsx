import { useState } from 'react';
import {
  useGetProjectPermissionsQuery,
  useGrantGroupPermissionMutation,
  useRevokeGroupPermissionMutation,
  type ProjectGroupRole,
} from '@/services/permissionsApi';
import { useListUserGroupsQuery } from '@/services/userGroupsApi';
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
import { Label } from '@/components/ui/label';
import { AlertCircle, Users, Trash2, Edit } from 'lucide-react';
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

interface ProjectGroupsTabProps {
  owner: string;
  repo: string;
}

const roleColors: Record<ProjectGroupRole, string> = {
  admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  contributor: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

export function ProjectGroupsTab({ owner, repo }: ProjectGroupsTabProps) {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [removingGroup, setRemovingGroup] = useState<string | null>(null);

  // Form state
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupRole, setNewGroupRole] = useState<ProjectGroupRole>('viewer');
  const [editRole, setEditRole] = useState<ProjectGroupRole>('viewer');

  // Fetch permissions and available groups
  const { data, isLoading, error } = useGetProjectPermissionsQuery({ owner, repo });
  const { data: availableGroups, isLoading: isLoadingGroups } = useListUserGroupsQuery();

  // Mutations
  const [grantPermission, { isLoading: isGranting }] = useGrantGroupPermissionMutation();
  const [revokePermission, { isLoading: isRevoking }] = useRevokeGroupPermissionMutation();

  const handleAddGroup = async () => {
    if (!selectedGroupId) {
      toast({
        title: 'Error',
        description: 'Please select a group',
        variant: 'destructive',
      });
      return;
    }

    try {
      await grantPermission({
        owner,
        repo,
        dto: {
          groupId: selectedGroupId,
          role: newGroupRole,
        },
      }).unwrap();

      const groupName = availableGroups?.find((g) => g.id === selectedGroupId)?.name;
      toast({
        title: 'Group added',
        description: `${groupName} has been added with ${newGroupRole} role`,
      });

      setAddDialogOpen(false);
      setSelectedGroupId('');
      setNewGroupRole('viewer');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to add group',
        variant: 'destructive',
      });
    }
  };

  const handleChangeRole = async (groupId: string) => {
    try {
      // First revoke, then grant new role
      await revokePermission({ owner, repo, groupId }).unwrap();
      await grantPermission({
        owner,
        repo,
        dto: { groupId, role: editRole },
      }).unwrap();

      toast({
        title: 'Role updated',
        description: `Group role has been updated to ${editRole}`,
      });

      setEditingGroup(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update role',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveGroup = async (groupId: string) => {
    try {
      await revokePermission({ owner, repo, groupId }).unwrap();

      toast({
        title: 'Group removed',
        description: 'Group has been removed from the project',
      });

      setRemovingGroup(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to remove group',
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
          Failed to load project groups. {(error as any)?.data?.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const groups = data?.groupPermissions || [];
  const groupsToAdd = availableGroups?.filter(
    (g) => !groups.some((pg) => pg.groupId === g.id)
  ) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Project Groups</CardTitle>
            <CardDescription>
              Grant access to entire groups of users
            </CardDescription>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={groupsToAdd.length === 0}>
                <Users className="h-4 w-4 mr-2" />
                Add Group
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Group to Project</DialogTitle>
                <DialogDescription>
                  Grant project access to all members of a group
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="group">Select Group</Label>
                  {isLoadingGroups ? (
                    <Skeleton className="h-10" />
                  ) : (
                    <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                      <SelectTrigger id="group">
                        <SelectValue placeholder="Choose a group" />
                      </SelectTrigger>
                      <SelectContent>
                        {groupsToAdd.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                            {group.description && (
                              <span className="text-sm text-muted-foreground ml-2">
                                - {group.description}
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={newGroupRole} onValueChange={(value) => setNewGroupRole(value as ProjectGroupRole)}>
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
                <Button onClick={handleAddGroup} disabled={isGranting || !selectedGroupId}>
                  {isGranting ? 'Adding...' : 'Add Group'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No groups yet. Add a group to grant access to multiple users at once.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((permission) => (
                <TableRow key={permission.id}>
                  <TableCell className="font-medium">
                    {permission.group.name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {permission.group.description || '-'}
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
                      <Dialog
                        open={editingGroup === permission.groupId}
                        onOpenChange={(open) =>
                          setEditingGroup(open ? permission.groupId : null)
                        }
                      >
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingGroup(permission.groupId);
                              setEditRole(permission.role);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Change Group Role</DialogTitle>
                            <DialogDescription>
                              Update the role for {permission.group.name}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label htmlFor="edit-role">New Role</Label>
                              <Select
                                value={editRole}
                                onValueChange={(value) => setEditRole(value as ProjectGroupRole)}
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
                              onClick={() => setEditingGroup(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={() => handleChangeRole(permission.groupId)}
                              disabled={isGranting || isRevoking}
                            >
                              {isGranting || isRevoking ? 'Updating...' : 'Update Role'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      <AlertDialog
                        open={removingGroup === permission.groupId}
                        onOpenChange={(open) =>
                          setRemovingGroup(open ? permission.groupId : null)
                        }
                      >
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemovingGroup(permission.groupId)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </DialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Group</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove {permission.group.name} from
                              this project? All group members will lose access immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setRemovingGroup(null)}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRemoveGroup(permission.groupId)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              disabled={isRevoking}
                            >
                              {isRevoking ? 'Removing...' : 'Remove'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
