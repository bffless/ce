import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCompletePluginOAuthMutation } from '@/services/projectsApi';
import { useCompleteGoogleCalendarOAuthMutation } from '@/services/integrationsApi';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [completePluginOAuth] = useCompletePluginOAuthMutation();
  const [completeIntegrationOAuth] = useCompleteGoogleCalendarOAuthMutation();
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

    // Two callers, two sessionStorage keys. Integration takes precedence
    // because the new google-calendar entry under Project Settings is the
    // intended path going forward; AI-plugin OAuth is the legacy path.
    const integrationContext = sessionStorage.getItem('oauth_integration_context');
    const pluginContext = sessionStorage.getItem('oauth_plugin_context');

    if (integrationContext) {
      sessionStorage.removeItem('oauth_integration_context');
      const { projectId, integrationId, owner, repo } = JSON.parse(integrationContext);
      const redirectUri = window.location.origin + '/oauth/callback';

      if (integrationId !== 'google-calendar') {
        setStatus('error');
        setErrorMessage(`Unsupported integration: ${integrationId}`);
        return;
      }

      completeIntegrationOAuth({ projectId, code, state, redirectUri })
        .unwrap()
        .then((result) => {
          setConnectedEmail(result.connectedEmail);
          setStatus('success');
          setTimeout(() => {
            if (owner && repo) {
              navigate(`/repo/${owner}/${repo}/settings?tab=integrations`);
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
      return;
    }

    if (pluginContext) {
      sessionStorage.removeItem('oauth_plugin_context');
      const { projectId, pluginId, owner, repo } = JSON.parse(pluginContext);
      const redirectUri = window.location.origin + '/oauth/callback';

      completePluginOAuth({ projectId, pluginId, code, state, redirectUri })
        .unwrap()
        .then((result) => {
          setConnectedEmail(result.connectedEmail);
          setStatus('success');
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
      return;
    }

    setStatus('error');
    setErrorMessage('OAuth session expired. Please try connecting again.');
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
