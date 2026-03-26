import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGoogleOAuthCallbackMutation } from '@/services/authApi';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * OAuth Sign-In Callback Page
 *
 * Handles the redirect from Google OAuth after user authenticates.
 * Reads ?code= and ?state= from URL, sends to backend to complete sign-in.
 */
export function OAuthSignInCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [googleCallback] = useGoogleOAuthCallbackMutation();
  const [error, setError] = useState<string | null>(null);
  const callbackAttemptedRef = useRef(false);

  useEffect(() => {
    if (callbackAttemptedRef.current) return;
    callbackAttemptedRef.current = true;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(`Google sign-in was denied: ${errorParam}`);
      return;
    }

    if (!code) {
      setError('No authorization code received from Google');
      return;
    }

    // Retrieve stored OAuth context
    const redirectUrl = sessionStorage.getItem('oauth_redirect_url');
    const pkceCodeVerifier = sessionStorage.getItem('oauth_pkce_code_verifier');
    const originalRedirect = sessionStorage.getItem('oauth_original_redirect');

    // Clean up stored values
    sessionStorage.removeItem('oauth_redirect_url');
    sessionStorage.removeItem('oauth_pkce_code_verifier');
    sessionStorage.removeItem('oauth_original_redirect');

    if (!redirectUrl) {
      setError('OAuth session expired. Please try signing in again.');
      return;
    }

    googleCallback({
      code,
      redirectUrl,
      pkceCodeVerifier: pkceCodeVerifier || undefined,
    })
      .unwrap()
      .then((result) => {
        toast({
          title: result.createdNewUser ? 'Account created!' : 'Welcome back!',
          description: result.createdNewUser
            ? 'Your account has been created via Google.'
            : 'You have been signed in via Google.',
        });

        // Redirect to original destination
        const destination = originalRedirect || '/';
        if (destination.startsWith('http')) {
          window.location.href = destination;
        } else {
          navigate(destination, { replace: true });
        }
      })
      .catch((err) => {
        const message = err?.data?.message || 'Google sign-in failed. Please try again.';
        setError(message);
      });
  }, [searchParams, googleCallback, navigate, toast]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <CardTitle className="text-xl">Sign-in Failed</CardTitle>
              </div>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={() => navigate('/login', { replace: true })}
              >
                Back to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Completing sign-in...
      </div>
    </div>
  );
}
