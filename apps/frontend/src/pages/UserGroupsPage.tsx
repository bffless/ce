import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useListUserGroupsQuery,
  useCreateGroupMutation,
  useDeleteGroupMutation,
} from '@/services/userGroupsApi';
import { useGetSessionQuery } from '@/services/authApi';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Users, Trash2, Eye, ArrowLeft } from 'lucide-react';
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

/**
 * UserGroupsPage - Manage user groups
 * Route: /groups
 */
export function UserGroupsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Check authentication
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const isAuthenticated = Boolean(sessionData?.user);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoadingSession && !isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [isLoadingSession, isAuthenticated, navigate]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);

  // Form state
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');

  // Fetch groups
  const { data: groups, isLoading, error } = useListUserGroupsQuery();

  // Mutations
  const [createGroup, { isLoading: isCreating }] = useCreateGroupMutation();
  const [deleteGroup, { isLoading: isDeleting }] = useDeleteGroupMutation();

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a group name',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createGroup({
        name: newGroupName,
        description: newGroupDescription || undefined,
      }).unwrap();

      toast({
        title: 'Group created',
        description: `${newGroupName} has been created successfully`,
      });

      setCreateDialogOpen(false);
      setNewGroupName('');
      setNewGroupDescription('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to create group',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await deleteGroup(groupId).unwrap();

      toast({
        title: 'Group deleted',
        description: 'Group has been deleted successfully',
      });

      setDeletingGroup(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to delete group',
        variant: 'destructive',
      });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b">
          <div className="px-4 py-3 flex items-center justify-between">
            <Skeleton className="h-8 w-48" />
            
          </div>
        </div>
        <div className="p-8 space-y-6">
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b">
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="text-xl font-semibold">User Groups</h1>
            
          </div>
        </div>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load user groups. {(error as any)?.data?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Home
            </Button>
            <div className="border-l h-6" />
            <h1 className="text-xl font-semibold">User Groups</h1>
          </div>
          
        </div>
      </div>

      {/* Content */}
      <div className="p-8 max-w-6xl mx-auto">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Manage User Groups</CardTitle>
                <CardDescription>
                  Create and manage groups to organize users and grant project access
                </CardDescription>
              </div>
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Users className="h-4 w-4 mr-2" />
                    Create Group
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create User Group</DialogTitle>
                    <DialogDescription>
                      Create a new group to organize users
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Group Name</Label>
                      <Input
                        id="name"
                        placeholder="e.g., Frontend Team"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description (Optional)</Label>
                      <Input
                        id="description"
                        placeholder="What is this group for?"
                        value={newGroupDescription}
                        onChange={(e) => setNewGroupDescription(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateGroup} disabled={isCreating}>
                      {isCreating ? 'Creating...' : 'Create Group'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {!groups || groups.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No groups yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first group to organize users and manage project access
                </p>
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Users className="h-4 w-4 mr-2" />
                  Create Group
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => (
                    <TableRow key={group.id}>
                      <TableCell className="font-medium">{group.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {group.description || '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(group.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/groups/${group.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          <AlertDialog
                            open={deletingGroup === group.id}
                            onOpenChange={(open) =>
                              setDeletingGroup(open ? group.id : null)
                            }
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeletingGroup(group.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </DialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Group</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete {group.name}? This will
                                  remove the group from all projects and cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setDeletingGroup(null)}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteGroup(group.id)}
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
