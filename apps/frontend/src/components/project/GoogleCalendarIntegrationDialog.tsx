import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  useSetIntegrationConfigMutation,
  useTestIntegrationConnectionMutation,
  useLazyInitiateGoogleCalendarOAuthQuery,
  useDisconnectGoogleCalendarOAuthMutation,
  useListGoogleCalendarCalendarsQuery,
  type IntegrationInfo,
  type CalendarSummary,
} from '@/services/integrationsApi';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Loader2, ExternalLink, Unlink } from 'lucide-react';

interface GoogleCalendarIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectOwner: string;
  projectName: string;
  integration: IntegrationInfo;
}

export function GoogleCalendarIntegrationDialog({
  open,
  onOpenChange,
  projectId,
  projectOwner,
  projectName,
  integration,
}: GoogleCalendarIntegrationDialogProps) {
  const { toast } = useToast();

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const [setConfig, { isLoading: isSaving }] = useSetIntegrationConfigMutation();
  const [testConnection, { isLoading: isTesting }] = useTestIntegrationConnectionMutation();
  const [initiateOAuth, { isFetching: isInitiating }] = useLazyInitiateGoogleCalendarOAuthQuery();
  const [disconnectOAuth, { isLoading: isDisconnecting }] = useDisconnectGoogleCalendarOAuthMutation();

  const connectedEmail = integration.publicConfig?.connectedEmail as string | undefined;
  const availableCalendars =
    (integration.publicConfig?.availableCalendars as CalendarSummary[] | undefined) || [];
  const hasCredentials = integration.hasProductionConfig;
  const isConnected = !!connectedEmail;

  // Only fetch fresh calendar list when already connected — avoid 4xx noise
  // before OAuth completion.
  const { data: calendarsData, isFetching: isFetchingCalendars } =
    useListGoogleCalendarCalendarsQuery(projectId, {
      skip: !isConnected,
    });

  const calendars =
    (calendarsData?.calendars && calendarsData.calendars.length > 0
      ? calendarsData.calendars
      : availableCalendars) || [];

  const handleSaveCredentials = async () => {
    if (!hasCredentials && (!clientId || !clientSecret)) {
      toast({
        title: 'Error',
        description: 'Both Client ID and Client Secret are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const config: Record<string, string> = {};
      if (clientId) config.clientId = clientId;
      if (clientSecret) config.clientSecret = clientSecret;

      await setConfig({
        projectId,
        integrationId: 'google-calendar',
        environment: 'production',
        config,
      }).unwrap();

      toast({
        title: 'Saved',
        description: 'Google Calendar credentials saved. Click "Connect Google" to authorize.',
      });
      setClientId('');
      setClientSecret('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to save credentials',
        variant: 'destructive',
      });
    }
  };

  const handleConnect = async () => {
    try {
      const redirectUri = window.location.origin + '/oauth/callback';
      sessionStorage.setItem(
        'oauth_integration_context',
        JSON.stringify({
          projectId,
          integrationId: 'google-calendar',
          owner: projectOwner,
          repo: projectName,
        }),
      );
      const result = await initiateOAuth({ projectId, redirectUri }).unwrap();
      window.location.href = result.authUrl;
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to start OAuth flow',
        variant: 'destructive',
      });
      sessionStorage.removeItem('oauth_integration_context');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectOAuth({ projectId }).unwrap();
      toast({ title: 'Google Calendar disconnected' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to disconnect',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const result = await testConnection({
        projectId,
        integrationId: 'google-calendar',
        environment: 'production',
      }).unwrap();
      setTestResult(result);
    } catch (error: any) {
      setTestResult({
        success: false,
        error: error?.data?.message || 'Connection test failed',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Configure Google Calendar Integration</DialogTitle>
          <DialogDescription>
            Connect a Google account so pipelines can read free/busy information and create
            calendar events. Each project owns its own OAuth client (configured in
            Google Cloud Console) so credentials never leave this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1 — credentials */}
          {!isConnected && (
            <div className="space-y-3">
              {hasCredentials && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    OAuth credentials saved. Click "Connect Google" to authorize.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label>Client ID *</Label>
                <Input
                  type="text"
                  placeholder={
                    hasCredentials
                      ? '••••••••••.apps.googleusercontent.com'
                      : 'xxxxx.apps.googleusercontent.com'
                  }
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Client Secret *</Label>
                <Input
                  type="password"
                  placeholder={hasCredentials ? '••••••••••••••••' : 'GOCSPX-...'}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create at{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="underline inline-flex items-center gap-1"
                  >
                    console.cloud.google.com/apis/credentials
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  . Add{' '}
                  <code>{`${typeof window !== 'undefined' ? window.location.origin : ''}/oauth/callback`}</code>{' '}
                  as an authorized redirect URI.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSaveCredentials}
                  disabled={isSaving || (!hasCredentials && (!clientId || !clientSecret))}
                >
                  {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Credentials
                </Button>

                {hasCredentials && (
                  <Button onClick={handleConnect} variant="default" disabled={isInitiating}>
                    {isInitiating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4 mr-2" />
                    )}
                    Connect Google
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Step 2 — connected state */}
          {isConnected && (
            <div className="space-y-3">
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Connected as <strong>{connectedEmail}</strong>
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label>Available calendars</Label>
                {isFetchingCalendars ? (
                  <p className="text-sm text-muted-foreground">Loading calendars…</p>
                ) : calendars.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No calendars returned. The connected account may not have any sub-calendars yet.
                  </p>
                ) : (
                  <ul className="text-sm border rounded-md divide-y">
                    {calendars.map((c) => (
                      <li key={c.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <div className="font-medium">{c.summary}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.id} · {c.timeZone}
                          </div>
                        </div>
                        {c.primary && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">primary</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                  {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Test Connection
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="text-destructive hover:text-destructive"
                >
                  {isDisconnecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Unlink className="h-4 w-4 mr-2" />
                  )}
                  Disconnect
                </Button>
              </div>

              {testResult && (
                <Alert variant={testResult.success ? 'default' : 'destructive'}>
                  {testResult.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {testResult.success
                      ? 'Successfully reached Google Calendar.'
                      : `Connection failed: ${testResult.error}`}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
