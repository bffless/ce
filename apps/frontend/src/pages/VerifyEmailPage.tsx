import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home, CheckCircle2, AlertCircle, Mail, Loader2 } from 'lucide-react';
import {
  useGetSessionQuery,
  useSignOutMutation,
  useSendVerificationEmailMutation,
  useVerifyEmailMutation,
} from '@/services/authApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const [signOut] = useSignOutMutation();
  const [sendVerificationEmail, { isLoading: isSending }] = useSendVerificationEmailMutation();
  const [verifyEmail] = useVerifyEmailMutation();

  const [resendCooldown, setResendCooldown] = useState(0);
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [verifyError, setVerifyError] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);

  // If already verified, redirect to home
  useEffect(() => {
    if (!isLoadingSession && sessionData?.emailVerified && sessionData?.emailVerificationRequired) {
      navigate('/', { replace: true });
    }
  }, [isLoadingSession, sessionData, navigate]);

  // If not authenticated at all, redirect to login
  useEffect(() => {
    if (!isLoadingSession && !sessionData?.user) {
      navigate('/login', { replace: true });
    }
  }, [isLoadingSession, sessionData, navigate]);

  // Auto-verify when token is present
  useEffect(() => {
    if (token && verifyState === 'idle') {
      setVerifyState('loading');
      verifyEmail({ token })
        .unwrap()
        .then(() => {
          setVerifyState('success');
          // Auto-redirect after 3 seconds
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 3000);
        })
        .catch((error: any) => {
          setVerifyState('error');
          setVerifyError(
            error?.data?.message || 'Verification link is invalid or expired.',
          );
        });
    }
  }, [token, verifyState, verifyEmail, navigate]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResend = useCallback(async () => {
    try {
      setResendSuccess(false);
      const result = await sendVerificationEmail().unwrap();
      if (result.alreadyVerified) {
        navigate('/', { replace: true });
        return;
      }
      setResendSuccess(true);
      setResendCooldown(60);
    } catch {
      // Error handled by RTK Query
    }
  }, [sendVerificationEmail, navigate]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login', { replace: true });
  }, [signOut, navigate]);

  if (isLoadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Token verification mode
  if (token) {
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
              <CardTitle className="text-2xl font-bold">
                {verifyState === 'success' ? 'Email Verified' : 'Verify Email'}
              </CardTitle>
              <CardDescription>
                {verifyState === 'loading' && 'Verifying your email...'}
                {verifyState === 'success' && 'Your email has been verified successfully'}
                {verifyState === 'error' && 'Verification failed'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {verifyState === 'loading' && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {verifyState === 'success' && (
                <div className="space-y-4">
                  <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertDescription className="text-green-700 dark:text-green-300">
                      Your email has been verified. You now have full access.
                    </AlertDescription>
                  </Alert>
                  <p className="text-sm text-muted-foreground">
                    Redirecting to dashboard in 3 seconds...
                  </p>
                  <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
                    Go to Dashboard
                  </Button>
                </div>
              )}

              {verifyState === 'error' && (
                <div className="space-y-4">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{verifyError}</AlertDescription>
                  </Alert>
                  <Button className="w-full" onClick={handleResend} disabled={isSending || resendCooldown > 0}>
                    {isSending ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Request New Link'}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={handleSignOut}>
                    Sign Out
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Default mode: "Check your email" screen
  const userEmail = sessionData?.user?.email;

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
            <CardTitle className="text-2xl font-bold">Verify Your Email</CardTitle>
            <CardDescription>
              We sent a verification link to your email address
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-4 bg-muted/50">
              <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{userEmail}</p>
                <p className="text-xs text-muted-foreground">
                  Check your inbox for the verification link
                </p>
              </div>
            </div>

            {resendSuccess && (
              <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-700 dark:text-green-300">
                  Verification email sent! Check your inbox.
                </AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={handleResend}
              disabled={isSending || resendCooldown > 0}
            >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : resendCooldown > 0 ? (
                `Resend in ${resendCooldown}s`
              ) : (
                'Resend Verification Email'
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Didn't receive the email? Check your spam folder.
            </p>

            <div className="text-center">
              <Button variant="link" className="text-sm" onClick={handleSignOut}>
                Sign out and use a different account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
