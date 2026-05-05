import { useState } from 'react';
import {
  useGetOAuthSettingsQuery,
  useUpdateGoogleOAuthMutation,
  useGetGoogleOAuthIntegrationQuery,
  useUpdateGoogleOAuthIntegrationMutation,
  useDeleteGoogleOAuthIntegrationMutation,
} from '@/services/settingsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Shield, CheckCircle, XCircle, Info, Loader2, ExternalLink, Calendar, Unlink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AuthenticationSettings() {
  const { toast } = useToast();
  const { data, isLoading, error } = useGetOAuthSettingsQuery();
  const [updateGoogleOAuth, { isLoading: isUpdating }] = useUpdateGoogleOAuthMutation();

  const googleEnabled = data?.google?.enabled ?? false;
  const googleConfigured = data?.google?.configured ?? false;

  const handleToggle = async (enabled: boolean) => {
    try {
      await updateGoogleOAuth({ enabled }).unwrap();
      toast({
        title: enabled ? 'Google OAuth enabled' : 'Google OAuth disabled',
        description: enabled
          ? 'Google sign-in is now available on login and signup pages.'
          : 'Google sign-in has been removed from login and signup pages.',
      });
    } catch (err: unknown) {
      const errorMessage = err && typeof err === 'object' && 'data' in err
        ? (err.data as { message?: string })?.message || 'An error occurred'
        : 'An error occurred';
      toast({
        title: 'Failed to update Google OAuth',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <div>
              <CardTitle>Authentication</CardTitle>
              <CardDescription>Configure sign-in methods</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <div>
              <CardTitle>Authentication</CardTitle>
              <CardDescription>Configure sign-in methods</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>Failed to load authentication settings.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <div>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>Configure sign-in methods for your workspace</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email/Password - always enabled */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Label className="text-base font-medium">Email & Password</Label>
              <Badge variant="secondary">Always On</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Users can sign in with their email and password.
            </p>
          </div>
          <Switch checked disabled />
        </div>

        {/* Google OAuth */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label className="text-base font-medium">Google OAuth</Label>
                {googleConfigured ? (
                  googleEnabled ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <XCircle className="h-3 w-3 mr-1" />
                      Disabled
                    </Badge>
                  )
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Not Configured
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Allow users to sign in with their Google account.
              </p>
            </div>
            {googleConfigured && (
              <Switch
                checked={googleEnabled}
                onCheckedChange={handleToggle}
                disabled={isUpdating}
              />
            )}
          </div>

          {!googleConfigured && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Google OAuth requires credentials to be configured in SuperTokens.
                See the{' '}
                <a
                  href="https://docs.bffless.app/configuration/authentication/#google-oauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-medium"
                >
                  authentication docs
                </a>
                {' '}for setup instructions.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Google Integration OAuth (Calendar, etc.) — workspace-level credentials */}
        <GoogleIntegrationOAuthCard />
      </CardContent>
    </Card>
  );
}

// ─── Google Integration OAuth (workspace-level credentials) ────────────────

function GoogleIntegrationOAuthCard() {
  const { toast } = useToast();
  const { data: status, isLoading } = useGetGoogleOAuthIntegrationQuery();
  const [updateCreds, { isLoading: isSaving }] = useUpdateGoogleOAuthIntegrationMutation();
  const [deleteCreds, { isLoading: isClearing }] = useDeleteGoogleOAuthIntegrationMutation();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState(false);

  const isConfigured = !!status?.isConfigured;
  const showForm = !isConfigured || editing;

  const redirectUri =
    typeof window !== 'undefined' ? `${window.location.origin}/oauth/callback` : '/oauth/callback';

  const handleSave = async () => {
    if (!clientId || !clientSecret) {
      toast({
        title: 'Both fields required',
        description: 'Client ID and Client Secret are both required.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await updateCreds({ clientId, clientSecret }).unwrap();
      toast({
        title: 'Saved',
        description:
          'Google integration credentials saved. Project owners can now connect Google Calendar without setting up their own Cloud app.',
      });
      setClientId('');
      setClientSecret('');
      setEditing(false);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'data' in err
          ? (err.data as { message?: string })?.message || 'Failed to save credentials.'
          : 'Failed to save credentials.';
      toast({ title: 'Failed to save', description: message, variant: 'destructive' });
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear the workspace Google OAuth integration credentials? Project-level Google Calendar connections will stop working until new credentials are saved.')) {
      return;
    }
    try {
      await deleteCreds().unwrap();
      toast({ title: 'Cleared', description: 'Google integration credentials removed.' });
      setClientId('');
      setClientSecret('');
      setEditing(false);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'data' in err
          ? (err.data as { message?: string })?.message || 'Failed to clear credentials.'
          : 'Failed to clear credentials.';
      toast({ title: 'Failed to clear', description: message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <Label className="text-base font-medium">Google Integration OAuth</Label>
            {isConfigured ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                <CheckCircle className="h-3 w-3 mr-1" />
                Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not Configured
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Workspace-level credentials for Google Calendar (and future Drive / Sheets / Gmail).
            Project owners use a single "Connect" button — no per-project Cloud Console setup.
            Distinct from sign-in (which uses environment variables).
          </p>
        </div>
        {isConfigured && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Replace
          </Button>
        )}
      </div>

      {isConfigured && !editing && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Client ID: </span>
          <code>{status?.clientIdMasked}</code>
          <span className="text-muted-foreground"> · Secret stored.</span>
        </div>
      )}

      {showForm && (
        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-2">
            <Label>Client ID</Label>
            <Input
              type="text"
              placeholder="xxxxx.apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Client Secret</Label>
            <Input
              type="password"
              placeholder="GOCSPX-..."
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
              . Add <code className="text-xs">{redirectUri}</code> as an authorized redirect URI.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={isSaving || !clientId || !clientSecret}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save credentials
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            {isConfigured && (
              <Button
                variant="ghost"
                onClick={handleClear}
                disabled={isClearing}
                className="text-destructive hover:text-destructive ml-auto"
              >
                {isClearing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4 mr-2" />
                )}
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
