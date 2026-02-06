import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetSessionQuery } from '@/services/authApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, ArrowLeft, User as UserIcon } from 'lucide-react';

type TabValue = 'profile' | 'api-keys' | 'preferences';

/**
 * UserSettingsPage - User profile and settings
 * Route: /settings
 * Requires: Authentication (enforced by ProtectedRoute in App.tsx)
 */
export function UserSettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Fetch session data for user info (auth already verified by ProtectedRoute)
  const { data: sessionData } = useGetSessionQuery();
  const user = sessionData?.user;

  // Members cannot access API keys
  const canAccessApiKeys = user?.role !== 'member';

  // Get tab from query params, default to 'profile'
  // Redirect away from api-keys if user is a member
  const tabParam = searchParams.get('tab');
  const currentTab: TabValue =
    tabParam === 'api-keys' && canAccessApiKeys
      ? 'api-keys'
      : tabParam === 'preferences'
        ? 'preferences'
        : 'profile';

  // Handler for tab changes
  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    navigate(`/settings?tab=${newTab}`, { replace: true });
  };

  // Handler for back navigation
  const handleBack = () => {
    navigate('/');
  };

  // User should always exist here since ProtectedRoute ensures authentication
  if (!user) {
    return null;
  }

  // Format member since date
  const memberSince = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account settings and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={currentTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {canAccessApiKeys && <TabsTrigger value="api-keys">API Keys</TabsTrigger>}
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="h-5 w-5" />
                Profile Information
              </CardTitle>
              <CardDescription>Your account details and information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Email</div>
                <div className="text-base">{user.email}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Role</div>
                <div className="text-base capitalize">{user.role}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">User ID</div>
                <div className="text-base font-mono text-sm">{user.id}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Member Since</div>
                <div className="text-base">{memberSince}</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys Tab - Hidden for member role */}
        {canAccessApiKeys && (
          <TabsContent value="api-keys" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>API Keys</CardTitle>
                <CardDescription>
                  View all your API keys across all projects. To manage API keys for a specific
                  project, go to the project settings page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    API keys are managed at the project level. Navigate to a project's settings page
                    to create or manage API keys for that project.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>Customize your experience</CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  User preferences will be available in a future update. You can currently change
                  your theme using the theme toggle in the header.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
