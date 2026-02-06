import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useListInvitationsQuery,
  useCreateInvitationMutation,
  useResendInvitationMutation,
  useDeleteInvitationMutation,
  Invitation,
} from '@/services/invitationsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  CheckCircle,
  XCircle,
  Loader2,
  UserPlus,
  Copy,
  RefreshCw,
  Trash2,
  Clock,
  Mail,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const inviteSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  role: z.enum(['admin', 'user']),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

export function InvitationsSettings() {
  const { toast } = useToast();
  const { data, isLoading, error } = useListInvitationsQuery();
  const [createInvitation, { isLoading: isCreating }] = useCreateInvitationMutation();
  const [resendInvitation] = useResendInvitationMutation();
  const [deleteInvitation, { isLoading: isDeleting }] = useDeleteInvitationMutation();

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invitationToDelete, setInvitationToDelete] = useState<Invitation | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: 'user',
    },
  });

  const onSubmit = async (data: InviteFormValues) => {
    try {
      const result = await createInvitation(data).unwrap();
      toast({
        title: 'Invitation sent',
        description: `Invitation sent to ${data.email}`,
      });
      form.reset();
      setShowInviteForm(false);

      // Copy invite URL to clipboard - construct from token to ensure HTTPS
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
    // Construct URL from token - use current origin with HTTPS
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

  const handleDeleteClick = (invitation: Invitation) => {
    setInvitationToDelete(invitation);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
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
      hour: '2-digit',
      minute: '2-digit',
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

  const invitations = data?.invitations || [];
  const pendingCount = invitations.filter((i) => !i.acceptedAt && !i.isExpired).length;
  const acceptedCount = invitations.filter((i) => i.acceptedAt).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            <div>
              <CardTitle>User Invitations</CardTitle>
              <CardDescription>
                Invite new users to join this workspace
              </CardDescription>
            </div>
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
          <span>{acceptedCount} accepted</span>
          <span>{invitations.length} total</span>
        </div>

        {/* Invite Form */}
        {showInviteForm && (
          <Card className="border-dashed">
            <CardContent className="pt-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
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
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load invitations. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Invitations Table */}
        {!isLoading && !error && invitations.length > 0 && (
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
                        {/* Only show delete for pending/expired invitations - accepted ones are historical records */}
                        {!invitation.acceptedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(invitation)}
                            disabled={isDeleting}
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
        {!isLoading && !error && invitations.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No invitations yet</p>
            <p className="text-sm">Click "Invite User" to send your first invitation</p>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
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
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
