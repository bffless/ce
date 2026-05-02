import { useNavigate } from 'react-router-dom';
import { useGetSessionQuery, useGetLoginMethodsQuery } from '@/services/authApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User as UserIcon } from 'lucide-react';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { MySitesSection } from '@/components/account/MySitesSection';

/**
 * The central identity hub. BFFless Auth is the identity provider; sites are
 * SaaS that consume that identity. This page is where a user lands to:
 *   - Confirm which account they're signed in as
 *   - Change their password / manage credentials
 *   - See every site their identity is a member of (My Sites)
 *   - Leave any site they don't own
 *
 * Linked from `<AuthDialog.PoweredBy />` (consumer sites) and from the 403
 * page when a workspace member hits a site they have no membership in.
 *
 * Distinct from `/settings`, which is the workspace-admin settings page
 * (API keys, preferences). `/account` is identity-and-memberships only.
 */
export function AccountPage() {
  const navigate = useNavigate();
  const { data: sessionData } = useGetSessionQuery();
  const { data: loginMethods } = useGetLoginMethodsQuery();
  const user = sessionData?.user;

  if (!user) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Account</h1>
          <p className="text-sm text-muted-foreground">
            Manage your BFFless Auth identity and the sites you&apos;re a member of.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            Signed in as
          </CardTitle>
          <CardDescription>
            One identity, used across every site you&apos;re a member of.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-base">{user.email}</div>
          <div className="text-xs font-mono text-muted-foreground">{user.id}</div>
        </CardContent>
      </Card>

      {loginMethods?.hasPassword && <ChangePasswordCard />}

      <MySitesSection />

      <p className="text-center text-xs text-muted-foreground">
        Powered by BFFless Auth — your identity provider for every site listed above.
      </p>
    </div>
  );
}
