import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGetSessionQuery } from '@/services/authApi';
import {
  useGetGroupQuery,
  useGetGroupMembersQuery,
  useUpdateGroupMutation,
  useAddMemberMutation,
  useRemoveMemberMutation,
} from '@/services/userGroupsApi';
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
import { AlertCircle, UserPlus, Trash2, ArrowLeft, Edit, Save } from 'lucide-react';

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
 * GroupDetailPage - View and manage group members
 * Route: /groups/:groupId
 */
export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
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

  const [editMode, setEditMode] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState('');

  // Fetch group details
  const {
    data: group,
    isLoading: isLoadingGroup,
    error: groupError,
  } = useGetGroupQuery(groupId!, { skip: !groupId });

  // Fetch group members
  const {
    data: members,
    isLoading: isLoadingMembers,
    error: membersError,
  } = useGetGroupMembersQuery(groupId!, { skip: !groupId });

  // Mutations
  const [updateGroup, { isLoading: isUpdating }] = useUpdateGroupMutation();
  const [addMember, { isLoading: isAddingMember }] = useAddMemberMutation();
  const [removeMember, { isLoading: isRemovingMember }] = useRemoveMemberMutation();

  // Initialize form state when group loads
  if (group && !groupName && !editMode) {
    setGroupName(group.name);
    setGroupDescription(group.description || '');
  }

  const handleUpdateGroup = async () => {
    if (!group || !groupName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a group name',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updateGroup({
        id: group.id,
        updates: {
          name: groupName,
          description: groupDescription || undefined,
        },
      }).unwrap();

      toast({
        title: 'Group updated',
        description: 'Group details have been updated successfully',
      });

      setEditMode(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update group',
        variant: 'destructive',
      });
    }
  };

  const handleAddMember = async () => {
    if (!groupId || !newMemberEmail.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a user email',
        variant: 'destructive',
      });
      return;
    }

    try {
      await addMember({
        groupId,
        dto: { userId: newMemberEmail }, // Backend should lookup user by email
      }).unwrap();

      toast({
        title: 'Member added',
        description: `${newMemberEmail} has been added to the group`,
      });

      setAddMemberDialogOpen(false);
      setNewMemberEmail('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to add member',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!groupId) return;

    try {
      await removeMember({ groupId, userId }).unwrap();

      toast({
        title: 'Member removed',
        description: 'Member has been removed from the group',
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

  const isLoading = isLoadingGroup || isLoadingMembers;
  const error = groupError || membersError;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b">
          <div className="px-4 py-3 flex items-center justify-between">
            <Skeleton className="h-8 w-64" />
            
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
            <h1 className="text-xl font-semibold">Group Details</h1>
            
          </div>
        </div>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load group details. {(error as any)?.data?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!group) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/groups')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Groups
            </Button>
            <div className="border-l h-6" />
            <h1 className="text-xl font-semibold">{group.name}</h1>
          </div>
          
        </div>
      </div>

      {/* Content */}
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        {/* Group Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Group Information</CardTitle>
                <CardDescription>Basic details about this group</CardDescription>
              </div>
              {!editMode && (
                <Button variant="outline" onClick={() => setEditMode(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Group Name</Label>
              <Input
                id="name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                disabled={!editMode}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Optional description"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                disabled={!editMode}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Created: {new Date(group.createdAt).toLocaleDateString()}
            </div>

            {editMode && (
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setEditMode(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateGroup} disabled={isUpdating}>
                  <Save className="h-4 w-4 mr-2" />
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Members */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Group Members</CardTitle>
                <CardDescription>
                  Users in this group ({members?.length || 0})
                </CardDescription>
              </div>
              <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add Member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Member to Group</DialogTitle>
                    <DialogDescription>
                      Add a user to {group.name}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">User Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="user@example.com"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAddMemberDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddMember} disabled={isAddingMember}>
                      {isAddingMember ? 'Adding...' : 'Add Member'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {!members || members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No members yet. Add your first member to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.user.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.user.name || '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(member.addedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog
                          open={removingMember === member.userId}
                          onOpenChange={(open) =>
                            setRemovingMember(open ? member.userId : null)
                          }
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRemovingMember(member.userId)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </DialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Member</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {member.user.email} from
                                this group?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setRemovingMember(null)}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveMember(member.userId)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={isRemovingMember}
                              >
                                {isRemovingMember ? 'Removing...' : 'Remove'}
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
      </div>
    </div>
  );
}
