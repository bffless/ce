import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useListUsersQuery,
  useUpdateUserRoleMutation,
  useDeleteUserMutation,
  useDisableUserMutation,
  useEnableUserMutation,
  UserRole,
} from '@/services/usersApi';
import {
  useListInvitationsQuery,
  useCreateInvitationMutation,
  useResendInvitationMutation,
  useDeleteInvitationMutation,
  Invitation,
} from '@/services/invitationsApi';
import { useGetSessionQuery } from '@/services/authApi';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
import {
  AlertCircle,
  Users,
  MoreHorizontal,
  Shield,
  UserX,
  UserCheck,
  Trash2,
  ArrowLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Copy,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Mail,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const inviteSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  role: z.enum(['admin', 'user', 'member']),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

/**
 * UsersPage - Manage registered users and invitations
 * Route: /users
 * Admin only
 */
export function UsersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  // Get tab from URL or default to 'users'
  const activeTab = searchParams.get('tab') || 'users';

  // Check authentication
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const isAuthenticated = Boolean(sessionData?.user);
  const isAdmin = sessionData?.user?.role === 'admin';
  const currentUserId = sessionData?.user?.id;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoadingSession && !isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [isLoadingSession, isAuthenticated, navigate]);

  // Redirect if not admin
  useEffect(() => {
    if (!isLoadingSession && isAuthenticated && !isAdmin) {
      navigate('/');
    }
  }, [isLoadingSession, isAuthenticated, isAdmin, navigate]);

  // Users state
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deletingUser, setDeletingUser] = useState<{ id: string; email: string } | null>(null);

  // Invitations state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invitationToDelete, setInvitationToDelete] = useState<Invitation | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Fetch users
  const { data: usersData, isLoading: isLoadingUsers, error: usersError } = useListUsersQuery({
    page,
    limit: 20,
    search: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  // Fetch invitations
  const { data: invitationsData, isLoading: isLoadingInvitations, error: invitationsError } = useListInvitationsQuery();

  // User mutations
  const [updateRole, { isLoading: isUpdatingRole }] = useUpdateUserRoleMutation();
  const [deleteUser, { isLoading: isDeleting }] = useDeleteUserMutation();
  const [disableUser, { isLoading: isDisabling }] = useDisableUserMutation();
  const [enableUser, { isLoading: isEnabling }] = useEnableUserMutation();

  // Invitation mutations
  const [createInvitation, { isLoading: isCreating }] = useCreateInvitationMutation();
  const [resendInvitation] = useResendInvitationMutation();
  const [deleteInvitation, { isLoading: isDeletingInvitation }] = useDeleteInvitationMutation();

  // Invitation form
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: 'member',
    },
  });

  // User handlers
  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      await updateRole({ id: userId, role: newRole }).unwrap();
      toast({
        title: 'Role updated',
        description: `User role changed to ${newRole}`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update role',
        variant: 'destructive',
      });
    }
  };

  const handleToggleDisabled = async (userId: string, currentlyDisabled: boolean) => {
    try {
      if (currentlyDisabled) {
        await enableUser(userId).unwrap();
        toast({
          title: 'User enabled',
          description: 'User account has been enabled',
        });
      } else {
        await disableUser(userId).unwrap();
        toast({
          title: 'User disabled',
          description: 'User account has been disabled',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update user status',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    try {
      await deleteUser(deletingUser.id).unwrap();
      toast({
        title: 'User deleted',
        description: 'User has been deleted successfully',
      });
      setDeletingUser(null);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to delete user',
        variant: 'destructive',
      });
    }
  };

  // Invitation handlers
  const onSubmitInvite = async (data: InviteFormValues) => {
    try {
      const result = await createInvitation(data).unwrap();
      toast({
        title: 'Invitation sent',
        description: `Invitation sent to ${data.email}`,
      });
      form.reset();
      setShowInviteForm(false);

      if (result.invitation.token) {
        const baseUrl = window.location.origin.replace(/^http:/, 'https:');
        const inviteUrl = `${baseUrl}/invite/${result.invitation.token}`;
        await navigator.clipboard.writeText(inviteUrl);
        toast({
          title: 'Link copied',
          description: 'Invite link has been copied to your clipboard',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Failed to create invitation',
        description: err?.data?.message || 'An error occurred',
        variant: 'destructive',
      });
    }
  };

  const handleCopyLink = async (invitation: Invitation) => {
    const baseUrl = window.location.origin.replace(/^http:/, 'https:');
    const inviteUrl = invitation.inviteUrl || `${baseUrl}/invite/${invitation.token}`;
    await navigator.clipboard.writeText(inviteUrl);
    toast({
      title: 'Link copied',
      description: 'Invite link has been copied to your clipboard',
    });
  };

  const handleResend = async (invitation: Invitation) => {
    setResendingId(invitation.id);
    try {
      await resendInvitation(invitation.id).unwrap();
      toast({
        title: 'Invitation resent',
        description: `New invitation sent to ${invitation.email}`,
      });
    } catch (err: any) {
      toast({
        title: 'Failed to resend invitation',
        description: err?.data?.message || 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setResendingId(null);
    }
  };

  const handleDeleteInvitationClick = (invitation: Invitation) => {
    setInvitationToDelete(invitation);
    setDeleteDialogOpen(true);
  };

  const handleDeleteInvitationConfirm = async () => {
    if (!invitationToDelete) return;
    try {
      await deleteInvitation(invitationToDelete.id).unwrap();
      toast({
        title: 'Invitation deleted',
        description: `Invitation for ${invitationToDelete.email} has been deleted`,
      });
    } catch (err: any) {
      toast({
        title: 'Failed to delete invitation',
        description: err?.data?.message || 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setDeleteDialogOpen(false);
      setInvitationToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusBadge = (invitation: Invitation) => {
    if (invitation.acceptedAt) {
      return (
        <Badge variant="default" className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Accepted
        </Badge>
      );
    }
    if (invitation.isExpired) {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Expired
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  // Loading state
  if (isLoadingSession) {
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

  const users = usersData?.data || [];
  const meta = usersData?.meta;
  const invitations = invitationsData?.invitations || [];
  const pendingCount = invitations.filter((i) => !i.acceptedAt && !i.isExpired).length;

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
            <h1 className="text-xl font-semibold">Users</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-8 max-w-6xl mx-auto">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setSearchParams({ tab: value })}
        >
          <TabsList className="mb-6">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users
              {users.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {meta?.total || users.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Invitations
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Manage Users</CardTitle>
                    <CardDescription>
                      View and manage registered users, roles, and account status
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by email..."
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        className="pl-9 w-64"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {usersError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Failed to load users. {(usersError as any)?.data?.message || 'Unknown error'}
                    </AlertDescription>
                  </Alert>
                ) : isLoadingUsers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : users.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">
                      {search ? 'No users found' : 'No users yet'}
                    </h3>
                    <p className="text-muted-foreground">
                      {search
                        ? `No users match "${search}"`
                        : 'Users will appear here after they sign up or accept an invitation'}
                    </p>
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((user) => {
                          const isCurrentUser = user.id === currentUserId;
                          return (
                            <TableRow
                              key={user.id}
                              className={user.disabled ? 'opacity-60' : undefined}
                            >
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  {user.email}
                                  {isCurrentUser && (
                                    <Badge variant="outline" className="text-xs">
                                      You
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={user.role === 'admin' ? 'default' : user.role === 'member' ? 'outline' : 'secondary'}
                                  className={
                                    user.role === 'admin'
                                      ? 'bg-[#d96459] hover:bg-[#c55449]'
                                      : user.role === 'member'
                                        ? 'text-muted-foreground'
                                        : undefined
                                  }
                                >
                                  {user.role === 'admin' ? (
                                    <Shield className="h-3 w-3 mr-1" />
                                  ) : null}
                                  {user.role}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {user.disabled ? (
                                  <Badge variant="destructive">
                                    <UserX className="h-3 w-3 mr-1" />
                                    Disabled
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-green-600 border-green-600">
                                    <UserCheck className="h-3 w-3 mr-1" />
                                    Active
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {new Date(user.createdAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {isCurrentUser ? (
                                      <DropdownMenuItem disabled className="text-muted-foreground">
                                        Cannot modify your own account
                                      </DropdownMenuItem>
                                    ) : (
                                      <>
                                        {user.role !== 'admin' && (
                                          <DropdownMenuItem
                                            onClick={() => handleRoleChange(user.id, 'admin')}
                                            disabled={isUpdatingRole}
                                          >
                                            <Shield className="h-4 w-4 mr-2" />
                                            Make Admin
                                          </DropdownMenuItem>
                                        )}
                                        {user.role !== 'user' && (
                                          <DropdownMenuItem
                                            onClick={() => handleRoleChange(user.id, 'user')}
                                            disabled={isUpdatingRole}
                                          >
                                            <UserCheck className="h-4 w-4 mr-2" />
                                            Make User
                                          </DropdownMenuItem>
                                        )}
                                        {user.role !== 'member' && (
                                          <DropdownMenuItem
                                            onClick={() => handleRoleChange(user.id, 'member')}
                                            disabled={isUpdatingRole}
                                          >
                                            <UserX className="h-4 w-4 mr-2" />
                                            Make Member
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        {user.disabled ? (
                                          <DropdownMenuItem
                                            onClick={() => handleToggleDisabled(user.id, true)}
                                            disabled={isEnabling}
                                          >
                                            <UserCheck className="h-4 w-4 mr-2" />
                                            Enable Account
                                          </DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem
                                            onClick={() => handleToggleDisabled(user.id, false)}
                                            disabled={isDisabling}
                                          >
                                            <UserX className="h-4 w-4 mr-2" />
                                            Disable Account
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => setDeletingUser({ id: user.id, email: user.email })}
                                          className="text-destructive focus:text-destructive"
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete User
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>

                    {/* Pagination */}
                    {meta && meta.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <div className="text-sm text-muted-foreground">
                          Showing {(meta.page - 1) * meta.limit + 1} to{' '}
                          {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} users
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={!meta.hasPreviousPage}
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {meta.page} of {meta.totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => p + 1)}
                            disabled={!meta.hasNextPage}
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invitations Tab */}
          <TabsContent value="invitations">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>User Invitations</CardTitle>
                    <CardDescription>
                      Invite new users to join this workspace
                    </CardDescription>
                  </div>
                  <Button onClick={() => setShowInviteForm(!showInviteForm)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite User
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stats */}
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{pendingCount} pending</span>
                  <span>{invitations.filter((i) => i.acceptedAt).length} accepted</span>
                  <span>{invitations.length} total</span>
                </div>

                {/* Invite Form */}
                {showInviteForm && (
                  <Card className="border-dashed">
                    <CardContent className="pt-4">
                      <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmitInvite)} className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <FormField
                              control={form.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Email Address</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="email"
                                      placeholder="user@example.com"
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="role"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Role</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    defaultValue={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select role" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="member">Member (view only)</SelectItem>
                                      <SelectItem value="user">User (can create repos)</SelectItem>
                                      <SelectItem value="admin">Admin (full access)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setShowInviteForm(false);
                                form.reset();
                              }}
                            >
                              Cancel
                            </Button>
                            <Button type="submit" disabled={isCreating}>
                              {isCreating ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Sending...
                                </>
                              ) : (
                                <>
                                  <Mail className="h-4 w-4 mr-2" />
                                  Send Invitation
                                </>
                              )}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </CardContent>
                  </Card>
                )}

                {/* Error State */}
                {invitationsError && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      Failed to load invitations. Please try again.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Loading State */}
                {isLoadingInvitations && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Invitations Table */}
                {!isLoadingInvitations && !invitationsError && invitations.length > 0 && (
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invitations.map((invitation) => (
                          <TableRow key={invitation.id}>
                            <TableCell className="font-medium">{invitation.email}</TableCell>
                            <TableCell>
                              <Badge variant={invitation.role === 'admin' ? 'default' : 'secondary'}>
                                {invitation.role}
                              </Badge>
                            </TableCell>
                            <TableCell>{getStatusBadge(invitation)}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {invitation.acceptedAt
                                ? `Accepted ${formatDate(invitation.acceptedAt)}`
                                : formatDate(invitation.expiresAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {!invitation.acceptedAt && !invitation.isExpired && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleCopyLink(invitation)}
                                      title="Copy invite link"
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleResend(invitation)}
                                      disabled={resendingId === invitation.id}
                                      title="Resend invitation"
                                    >
                                      {resendingId === invitation.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </>
                                )}
                                {!invitation.acceptedAt && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteInvitationClick(invitation)}
                                    disabled={isDeletingInvitation}
                                    title="Delete invitation"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Empty State */}
                {!isLoadingInvitations && !invitationsError && invitations.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No invitations yet</p>
                    <p className="text-sm">Click "Invite User" to send your first invitation</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog
        open={!!deletingUser}
        onOpenChange={(open) => !open && setDeletingUser(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">{deletingUser?.email}</span>? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingUser(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Invitation Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the invitation for{' '}
              <strong>{invitationToDelete?.email}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteInvitationConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
