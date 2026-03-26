import { useState } from 'react';
import {
  useGetOAuthSettingsQuery,
  useUpdateGoogleOAuthMutation,
  useTestGoogleOAuthMutation,
} from '@/services/settingsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Shield, Eye, EyeOff, Loader2, CheckCircle, XCircle, ExternalLink, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AuthenticationSettings() {
  const { toast } = useToast();
  const { data, isLoading, error } = useGetOAuthSettingsQuery();
  const [updateGoogleOAuth, { isLoading: isUpdating }] = useUpdateGoogleOAuthMutation();
  const [testGoogleOAuth, { isLoading: isTesting }] = useTestGoogleOAuthMutation();

  const [isEditing, setIsEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const googleEnabled = data?.google?.enabled ?? false;
  const googleClientId = data?.google?.clientId;

  const callbackUrl = `${window.location.origin}/oauth/signin/callback`;

  const handleEnable = () => {
    setIsEditing(true);
    setClientId(googleClientId || '');
    setClientSecret('');
  };

  const handleDisable = async () => {
    try {
      await updateGoogleOAuth({ enabled: false }).unwrap();
      setIsEditing(false);
      toast({
        title: 'Google OAuth disabled',
        description: 'Google sign-in has been removed from login and signup pages.',
      });
    } catch (err: unknown) {
      const errorMessage = err && typeof err === 'object' && 'data' in err
        ? (err.data as { message?: string })?.message || 'An error occurred'
        : 'An error occurred';
      toast({
        title: 'Failed to disable Google OAuth',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({
        title: 'Missing fields',
        description: 'Both Client ID and Client Secret are required.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updateGoogleOAuth({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }).unwrap();
      setIsEditing(false);
      setClientSecret('');
      toast({
        title: 'Google OAuth enabled',
        description: 'Google sign-in is now available on login and signup pages.',
      });
    } catch (err: unknown) {
      const errorMessage = err && typeof err === 'object' && 'data' in err
        ? (err.data as { message?: string })?.message || 'An error occurred'
        : 'An error occurred';
      toast({
        title: 'Failed to save Google OAuth',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleTest = async () => {
    try {
      const result = await testGoogleOAuth().unwrap();
      toast({
        title: result.success ? 'Test passed' : 'Test failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch {
      toast({
        title: 'Test failed',
        description: 'Could not test Google OAuth configuration.',
        variant: 'destructive',
      });
    }
  };

  const handleCopyCallback = () => {
    navigator.clipboard.writeText(callbackUrl);
    toast({ title: 'Copied', description: 'Callback URL copied to clipboard.' });
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
                {googleEnabled ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Enabled
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <XCircle className="h-3 w-3 mr-1" />
                    Disabled
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Allow users to sign in with their Google account.
              </p>
            </div>
            {!isEditing && (
              <Switch
                checked={googleEnabled}
                onCheckedChange={(checked) => {
                  if (checked) {
                    handleEnable();
                  } else {
                    handleDisable();
                  }
                }}
                disabled={isUpdating}
              />
            )}
          </div>

          {/* Configured state - show client ID and actions */}
          {googleEnabled && !isEditing && (
            <div className="space-y-3 pl-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Client ID:</span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded">{googleClientId}</code>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleEnable}>
                  Update Credentials
                </Button>
                <Button variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
                  {isTesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Test Connection
                </Button>
              </div>
            </div>
          )}

          {/* Edit/Setup form */}
          {isEditing && (
            <div className="space-y-4 border-t pt-4">
              <Alert>
                <AlertDescription className="text-sm">
                  Create OAuth credentials in the{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Google Cloud Console
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  . Set the authorized redirect URI to:
                </AlertDescription>
              </Alert>

              <div className="space-y-1.5">
                <Label className="text-sm">Authorized Redirect URI</Label>
                <div className="flex gap-2">
                  <Input value={callbackUrl} readOnly className="bg-muted text-sm font-mono" />
                  <Button variant="outline" size="icon" onClick={handleCopyCallback} title="Copy">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="google-client-id">Client ID</Label>
                <Input
                  id="google-client-id"
                  placeholder="123456789.apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="google-client-secret">Client Secret</Label>
                <div className="relative">
                  <Input
                    id="google-client-secret"
                    type={showSecret ? 'text' : 'password'}
                    placeholder="Enter client secret"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {googleEnabled ? 'Update' : 'Enable Google OAuth'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setClientSecret('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
