import { useState } from 'react';
import {
  useListMyProjectsQuery,
  useLeaveProjectMutation,
  type MyProjectMembership,
} from '@/services/meApi';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ExternalLink, LogOut, Globe, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const ROLE_BADGE_VARIANT: Record<MyProjectMembership['role'], 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'default',
  contributor: 'secondary',
  viewer: 'secondary',
  guest: 'outline',
};

function formatJoinedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function MembershipCard({
  membership,
  onLeaveClick,
}: {
  membership: MyProjectMembership;
  onLeaveClick: (m: MyProjectMembership) => void;
}) {
  const isOwner = membership.role === 'owner';
  const displayHost = membership.primaryUrl
    ? membership.primaryUrl.replace(/^https?:\/\//, '')
    : `${membership.projectSlug} (no domain)`;

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{membership.projectName}</h3>
            <Badge variant={ROLE_BADGE_VARIANT[membership.role]} className="capitalize">
              {membership.role}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{displayHost}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Joined {formatJoinedAt(membership.joinedAt)}
            {membership.ownerEmail && ` · Owner: ${membership.ownerEmail}`}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {membership.primaryUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={membership.primaryUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Visit
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={isOwner}
            onClick={() => onLeaveClick(membership)}
            title={isOwner ? 'Transfer ownership before leaving' : undefined}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Leave
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * "My Sites" section for the central account hub at /account. Lists every
 * project the signed-in user is a member of, with role badge, primary URL,
 * Visit and Leave actions. Leave is disabled for owners (they must transfer
 * ownership first).
 */
export function MySitesSection() {
  const { toast } = useToast();
  const { data, isLoading, error } = useListMyProjectsQuery();
  const [leaveProject, { isLoading: isLeaving }] = useLeaveProjectMutation();

  const [pendingLeave, setPendingLeave] = useState<MyProjectMembership | null>(null);

  const onConfirmLeave = async () => {
    if (!pendingLeave) return;
    try {
      await leaveProject({ projectId: pendingLeave.projectId }).unwrap();
      toast({
        title: 'Left site',
        description: `You no longer have access to ${pendingLeave.projectName}.`,
      });
      setPendingLeave(null);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'data' in err && err.data && typeof err.data === 'object'
          ? (err.data as { message?: string }).message
          : null;
      toast({
        title: 'Could not leave site',
        description: message ?? 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Sites{data ? ` (${data.length})` : ''}</CardTitle>
        <CardDescription>
          Sites where your BFFless Auth account is a member. You can leave any site you
          don&apos;t own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Couldn&apos;t load your sites. Refresh the page or try again later.
            </AlertDescription>
          </Alert>
        )}
        {data && data.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            You&apos;re not a member of any sites yet. When a site owner adds you, it will show up
            here.
          </div>
        )}
        {data?.map((m) => (
          <MembershipCard key={m.projectId} membership={m} onLeaveClick={setPendingLeave} />
        ))}
      </CardContent>

      <AlertDialog
        open={!!pendingLeave}
        onOpenChange={(open) => !open && setPendingLeave(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Leave {pendingLeave?.projectName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll lose access to this site. The site owner can re-invite you any time.
              Your BFFless Auth account stays active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmLeave} disabled={isLeaving}>
              {isLeaving ? 'Leaving…' : 'Leave site'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
