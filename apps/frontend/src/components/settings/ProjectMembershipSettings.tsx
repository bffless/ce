import { useGetFeatureFlagQuery, useSetFeatureFlagMutation } from '@/services/featureFlagsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const FLAG_KEY = 'REQUIRE_PROJECT_MEMBERSHIP';

export function ProjectMembershipSettings() {
  const { toast } = useToast();
  const { data: flag, isLoading, error } = useGetFeatureFlagQuery(FLAG_KEY);
  const [setFeatureFlag, { isLoading: isUpdating }] = useSetFeatureFlagMutation();

  const enabled = Boolean(flag?.value);

  const handleToggle = async (next: boolean) => {
    try {
      await setFeatureFlag({ key: FLAG_KEY, value: next, enabled: true }).unwrap();
      toast({
        title: next ? 'Project-membership gating enabled' : 'Project-membership gating disabled',
        description: next
          ? 'Users now need a project membership to sign in to a specific site.'
          : 'Workspace members can again authenticate against any project.',
      });
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === 'object' && 'data' in err
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
            <Users className="h-5 w-5" />
            <div>
              <CardTitle>Project membership</CardTitle>
              <CardDescription>Restrict signin to users with project membership</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <div>
              <CardTitle>Project membership</CardTitle>
              <CardDescription>Restrict signin to users with project membership</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>Failed to load setting.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <div>
            <CardTitle>Project membership</CardTitle>
            <CardDescription>
              Control whether workspace users can authenticate against every project
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5 pr-4">
            <Label className="text-base font-medium">
              Require project membership for site authentication
            </Label>
            <p className="text-sm text-muted-foreground">
              When enabled, signing in on a project's site requires a project membership. Each
              project independently controls public signups via{' '}
              <span className="font-medium">Allow public signups</span> in its Members tab.
              Recommended for workspaces hosting unrelated whitelabel sites; leave off for
              single-owner workspaces that want SSO across their own projects.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} disabled={isUpdating} />
        </div>
      </CardContent>
    </Card>
  );
}
