import {
  useGetOAuthSettingsQuery,
  useUpdateGoogleOAuthMutation,
} from '@/services/settingsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Shield, CheckCircle, XCircle, Info } from 'lucide-react';
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
      </CardContent>
    </Card>
  );
}
