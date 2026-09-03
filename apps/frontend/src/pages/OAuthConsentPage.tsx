import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDecideConsentMutation, useGetPendingConsentQuery } from '@/services/oauthApi';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, KeyRound } from 'lucide-react';

/**
 * OAuth consent — `/oauth/consent?request=<signed pending request>` (ADR-0005).
 * The member sees who asks, for which project, and one checkbox per requested
 * scope (all ticked; unticking narrows the grant — a `workflow:read`-only
 * consent yields a token that cannot start a run). Requires the admin session
 * (ProtectedRoute); the authorize endpoint sends a signed-out member through
 * the login first.
 */
export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const request = params.get('request') ?? '';
  const { data, isLoading, error } = useGetPendingConsentQuery(request, { skip: request === '' });
  const [decide, { isLoading: deciding }] = useDecideConsentMutation();
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  const granted = (data?.scopes ?? []).filter((s) => !unticked.has(s));

  const submit = async (approve: boolean) => {
    setFailure(null);
    try {
      const { redirectTo } = await decide({
        request,
        approve,
        ...(approve ? { scopes: granted } : {}),
      }).unwrap();
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      const message = (err as { data?: { error_description?: string; message?: string } })?.data;
      setFailure(
        message?.error_description || message?.message || 'The decision could not be recorded',
      );
    }
  };

  if (request === '' || error) {
    return (
      <div className="max-w-lg mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {request === ''
              ? 'This page needs an authorization request to show.'
              : (error as { data?: { error_description?: string } })?.data?.error_description ||
                'The authorization request is invalid or has expired. Start again from the app that asked.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="max-w-lg mx-auto p-6">
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Allow access?
          </CardTitle>
          <CardDescription>
            <strong>{data.clientName}</strong> wants to act as you on{' '}
            <strong>{data.project.slug}</strong>
            {data.project.name !== data.project.slug ? ` (${data.project.name})` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">It asks for</div>
            {data.scopes.map((scope) => (
              <div key={scope} className="flex items-center gap-2">
                <Checkbox
                  id={`scope-${scope}`}
                  checked={!unticked.has(scope)}
                  onCheckedChange={(checked) =>
                    setUnticked((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(scope);
                      else next.add(scope);
                      return next;
                    })
                  }
                />
                <Label htmlFor={`scope-${scope}`} className="font-mono text-sm">
                  {scope}
                </Label>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              The app defines what each scope allows. Untick one to grant less; the token can never
              do more than you can.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            You will be sent back to {data.redirectHost}.
          </p>
          {failure && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => submit(false)} disabled={deciding}>
            Deny
          </Button>
          <Button onClick={() => submit(true)} disabled={deciding || granted.length === 0}>
            {deciding ? 'Working…' : 'Allow'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
