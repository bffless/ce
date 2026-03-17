import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCompletePluginOAuthMutation } from '@/services/projectsApi';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [completeOAuth] = useCompletePluginOAuthMutation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [connectedEmail, setConnectedEmail] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage(
        error === 'access_denied'
          ? 'Access was denied. Please try again.'
          : `OAuth error: ${error}`,
      );
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMessage('Missing authorization code or state parameter.');
      return;
    }

    // Read stored context from sessionStorage
    const storedData = sessionStorage.getItem('oauth_plugin_context');
    if (!storedData) {
      setStatus('error');
      setErrorMessage('OAuth session expired. Please try connecting again.');
      return;
    }

    const { projectId, pluginId, owner, repo } = JSON.parse(storedData);
    sessionStorage.removeItem('oauth_plugin_context');

    const redirectUri = window.location.origin + '/oauth/callback';

    completeOAuth({ projectId, pluginId, code, state, redirectUri })
      .unwrap()
      .then((result) => {
        setConnectedEmail(result.connectedEmail);
        setStatus('success');
        // Redirect to project settings after a brief delay
        setTimeout(() => {
          if (owner && repo) {
            navigate(`/repo/${owner}/${repo}/settings?tab=ai`);
          } else {
            navigate('/');
          }
        }, 2000);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(
          err.data?.message || 'Failed to complete OAuth connection. Please try again.',
        );
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4 max-w-md">
        {status === 'loading' && (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Completing Google account connection...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-8 w-8 mx-auto text-green-600" />
            <div>
              <p className="font-medium">Google Account Connected</p>
              <p className="text-sm text-muted-foreground mt-1">
                Connected as {connectedEmail}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Redirecting to project settings...
              </p>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-8 w-8 mx-auto text-destructive" />
            <div>
              <p className="font-medium">Connection Failed</p>
              <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
