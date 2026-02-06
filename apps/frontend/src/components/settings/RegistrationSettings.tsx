import {
  useGetRegistrationSettingsQuery,
  useUpdateAllowPublicSignupsMutation,
} from '@/services/setupApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPlus, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function RegistrationSettings() {
  const { toast } = useToast();
  const { data, isLoading, error } = useGetRegistrationSettingsQuery();
  const [updateAllowPublicSignups, { isLoading: isUpdating }] = useUpdateAllowPublicSignupsMutation();

  const handleToggle = async (checked: boolean) => {
    try {
      const result = await updateAllowPublicSignups({ allowPublicSignups: checked }).unwrap();
      toast({
        title: checked ? 'Public signups enabled' : 'Public signups disabled',
        description: result.message,
      });
    } catch (err: unknown) {
      const errorMessage = err && typeof err === 'object' && 'data' in err
        ? (err.data as { message?: string })?.message || 'An error occurred'
        : 'An error occurred';
      toast({
        title: 'Failed to update setting',
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
            <UserPlus className="h-5 w-5" />
            <div>
              <CardTitle>Registration Settings</CardTitle>
              <CardDescription>Control how users can join this workspace</CardDescription>
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
            <UserPlus className="h-5 w-5" />
            <div>
              <CardTitle>Registration Settings</CardTitle>
              <CardDescription>Control how users can join this workspace</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load registration settings. Please try again.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { registrationEnabled, allowPublicSignups } = data || {};

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            <div>
              <CardTitle>Registration Settings</CardTitle>
              <CardDescription>Control how users can join this workspace</CardDescription>
            </div>
          </div>
          <Badge variant={registrationEnabled ? 'default' : 'destructive'}>
            {registrationEnabled ? (
              <>
                <CheckCircle className="h-3 w-3 mr-1" />
                Registration Enabled
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3 mr-1" />
                Registration Disabled
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Feature Flag Warning */}
        {!registrationEnabled && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Registration Disabled</AlertTitle>
            <AlertDescription>
              The <code className="text-xs bg-muted px-1 py-0.5 rounded">ENABLE_USER_REGISTRATION</code> feature flag is set to <code className="text-xs bg-muted px-1 py-0.5 rounded">false</code>.
              All user registration (including invitations) is blocked. Contact your system administrator to enable registration.
            </AlertDescription>
          </Alert>
        )}

        {/* Public Signups Toggle */}
        <div className="flex items-center justify-between space-x-4">
          <div className="flex-1 space-y-1">
            <Label htmlFor="allow-public-signups" className="text-base font-medium">
              Allow Public Signups
            </Label>
            <p className="text-sm text-muted-foreground">
              {allowPublicSignups
                ? 'Anyone can create an account without an invitation'
                : 'Only users with an invitation can create an account (invite-only)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
            <Switch
              id="allow-public-signups"
              checked={allowPublicSignups ?? false}
              onCheckedChange={handleToggle}
              disabled={!registrationEnabled || isUpdating}
            />
          </div>
        </div>

        {/* Status Summary */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <h4 className="text-sm font-medium">Current Status</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            {!registrationEnabled ? (
              <p>All registration is disabled by system configuration.</p>
            ) : allowPublicSignups ? (
              <>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Anyone can sign up directly
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Invitation links work
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-orange-500" />
                  Public signup page will show an error
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Only invited users can register
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
