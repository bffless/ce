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
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  useTestIntegrationConnectionMutation,
  useLazyInitiateGoogleCalendarOAuthQuery,
  useListGoogleCalendarCalendarsQuery,
  type IntegrationInfo,
  type CalendarSummary,
} from '@/services/integrationsApi';
import { useGetGoogleOAuthIntegrationQuery } from '@/services/settingsApi';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Loader2, ExternalLink, Settings } from 'lucide-react';

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

  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const [testConnection, { isLoading: isTesting }] = useTestIntegrationConnectionMutation();
  const [initiateOAuth, { isFetching: isInitiating }] = useLazyInitiateGoogleCalendarOAuthQuery();

  // Workspace-level OAuth credentials must be set at /admin/settings/auth
  // before any project can connect Google Calendar. Polled when the dialog
  // opens so the operator sees the live state.
  const { data: workspaceOAuth, isLoading: isWorkspaceLoading } =
    useGetGoogleOAuthIntegrationQuery(undefined, { skip: !open });

  const connectedEmail = integration.publicConfig?.connectedEmail as string | undefined;
  const availableCalendars =
    (integration.publicConfig?.availableCalendars as CalendarSummary[] | undefined) || [];
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
          <DialogTitle>Connect Google Calendar</DialogTitle>
          <DialogDescription>
            Connect a Google account so pipelines can read free/busy information and create
            calendar events. Uses the workspace's shared Google OAuth credentials — no Google
            Cloud Console setup needed per project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Workspace credentials check */}
          {!isWorkspaceLoading && !workspaceOAuth?.isConfigured && (
            <Alert>
              <Settings className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p>
                  Workspace Google OAuth credentials aren't configured yet. A workspace admin
                  needs to set them up before any project can connect Google Calendar.
                </p>
                <p>
                  <a
                    href="/admin/settings/auth"
                    className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                  >
                    Open /admin/settings/auth
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Not connected */}
          {!isConnected && workspaceOAuth?.isConfigured && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Click below to authorize this project against the workspace's Google OAuth
                client. You'll be redirected to Google's consent screen and back.
              </p>
              <Button onClick={handleConnect} variant="default" disabled={isInitiating}>
                {isInitiating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                Connect Google Calendar
              </Button>
            </div>
          )}

          {/* Connected state */}
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
                      <li key={c.id} className="flex items-start justify-between gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{c.summary}</div>
                          <div className="text-xs text-muted-foreground break-all">
                            {c.id} · {c.timeZone}
                          </div>
                        </div>
                        {c.primary && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted shrink-0">
                            primary
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                  {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Test Connection
                </Button>
                <p className="text-xs text-muted-foreground ml-auto">
                  To switch Google accounts or remove the integration, close this dialog
                  and click the trash icon on the Google Calendar card.
                </p>
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
