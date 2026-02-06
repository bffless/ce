import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Mail, CheckCircle, XCircle, Loader2, Home, LogIn, UserPlus } from 'lucide-react';
import { useValidateInvitationTokenQuery, useAcceptInvitationMutation } from '@/services/invitationsApi';
import { useGetSessionQuery, useSignOutMutation } from '@/services/authApi';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export function InvitationAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Validate the invitation token
  const {
    data: validation,
    isLoading: isValidating,
    error: validationError,
  } = useValidateInvitationTokenQuery(token || '', {
    skip: !token,
  });

  // Check if user is logged in
  const { data: session, isLoading: isLoadingSession } = useGetSessionQuery();

  // Accept invitation mutation
  const [acceptInvitation] = useAcceptInvitationMutation();

  // Sign out mutation (for email mismatch case)
  const [signOut] = useSignOutMutation();

  // If user is logged in and invitation is valid, try to accept it
  useEffect(() => {
    const doAccept = async () => {
      if (!token || !validation?.valid || !session?.user) return;

      // Check if logged in user email matches invitation email
      if (session.user.email.toLowerCase() !== validation.email?.toLowerCase()) {
        // Email mismatch - show error but don't auto-redirect
        return;
      }

      try {
        const result = await acceptInvitation(token).unwrap();
        toast({
          title: 'Welcome!',
          description: result.message,
        });
        navigate('/');
      } catch (error: any) {
        const statusCode = error?.status;
        const errorMessage = error?.data?.message || 'Failed to accept invitation';

        // If user is already a member (409), treat as success - invitation was likely
        // accepted during signup process
        if (statusCode === 409 && errorMessage.toLowerCase().includes('already a member')) {
          toast({
            title: 'Welcome!',
            description: 'You are now a member of this workspace.',
          });
          navigate('/');
          return;
        }

        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    };

    if (session?.user && validation?.valid) {
      doAccept();
    }
  }, [token, validation, session, acceptInvitation, navigate, toast]);

  // Loading state
  if (isValidating || isLoadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Validating invitation...</span>
        </div>
      </div>
    );
  }

  // Error or invalid invitation
  if (validationError || !validation?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Button variant="ghost" onClick={() => navigate('/')} className="mb-4 gap-2">
              <Home className="h-4 w-4" />
              <span className="font-semibold">Asset Host</span>
            </Button>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <XCircle className="h-6 w-6 text-destructive" />
                <CardTitle className="text-2xl font-bold">Invalid Invitation</CardTitle>
              </div>
              <CardDescription>This invitation cannot be used</CardDescription>
            </CardHeader>
            <CardContent>
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Invitation Error</AlertTitle>
                <AlertDescription>
                  {validation?.error || 'This invitation link is invalid or has expired.'}
                </AlertDescription>
              </Alert>

              <div className="mt-6 text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  Please contact the workspace administrator for a new invitation.
                </p>
                <Button variant="outline" onClick={() => navigate('/')}>
                  Go to Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Valid invitation - check if user is logged in with correct email
  const isLoggedIn = !!session?.user;
  const emailMatches = isLoggedIn && session.user?.email.toLowerCase() === validation.email?.toLowerCase();

  // User is logged in but with wrong email
  if (isLoggedIn && !emailMatches) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Button variant="ghost" onClick={() => navigate('/')} className="mb-4 gap-2">
              <Home className="h-4 w-4" />
              <span className="font-semibold">Asset Host</span>
            </Button>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="h-6 w-6 text-warning" />
                <CardTitle className="text-2xl font-bold">Email Mismatch</CardTitle>
              </div>
              <CardDescription>You're signed in with a different email</CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <Mail className="h-4 w-4" />
                <AlertTitle>Wrong Account</AlertTitle>
                <AlertDescription>
                  This invitation was sent to <strong>{validation.email}</strong>, but you're
                  currently signed in as <strong>{session.user?.email}</strong>.
                </AlertDescription>
              </Alert>

              <div className="mt-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Please sign out and sign in with the correct email address, or create a new
                  account with <strong>{validation.email}</strong>.
                </p>

                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full"
                    onClick={async () => {
                      try {
                        await signOut().unwrap();
                        navigate(`/login?redirect=/invite/${token}`);
                      } catch {
                        // Even if signout fails, try to navigate
                        navigate(`/login?redirect=/invite/${token}`);
                      }
                    }}
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign Out and Sign In
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // User is logged in with correct email - accepting (handled by useEffect)
  if (isLoggedIn && emailMatches) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Accepting invitation...</span>
        </div>
      </div>
    );
  }

  // User is not logged in - show invitation details and auth options
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Button variant="ghost" onClick={() => navigate('/')} className="mb-4 gap-2">
            <Home className="h-4 w-4" />
            <span className="font-semibold">Asset Host</span>
          </Button>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <CardTitle className="text-2xl font-bold">You're Invited!</CardTitle>
            </div>
            <CardDescription>You've been invited to join this workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Invited Email</span>
                    <span className="font-medium">{validation.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Role</span>
                    <Badge variant={validation.role === 'admin' ? 'default' : 'secondary'}>
                      {validation.role}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  Sign in or create an account with <strong>{validation.email}</strong> to accept
                  this invitation.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button asChild className="w-full">
                  <Link to={`/login?redirect=/invite/${token}`}>
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign In
                  </Link>
                </Button>

                <Button asChild variant="outline" className="w-full">
                  <Link to={`/signup?redirect=/invite/${token}`}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create Account
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
