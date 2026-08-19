import { useEffect, useState } from 'react';
import {
  useGetGoogleIntegrationQuery,
  useUpdateGoogleIntegrationMutation,
  useDeleteGoogleIntegrationMutation,
  useListSsoProvidersQuery,
  useCreateSsoProviderMutation,
  useUpdateSsoProviderMutation,
  useDeleteSsoProviderMutation,
  useTestSsoProviderMutation,
  useGetEmailPasswordAuthQuery,
  useUpdateEmailPasswordAuthMutation,
  type SsoProviderKind,
  type SsoProviderStatus,
  type SsoProviderConfig,
} from '@/services/settingsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  CheckCircle,
  XCircle,
  Info,
  Loader2,
  ExternalLink,
  Calendar,
  Unlink,
  Plus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AuthenticationSettings() {
  // Loading skeleton for the wrapper — the actual SSO list has its own loading
  // state inside SingleSignOnSettingsCard, so this just covers initial render.
  const isLoading = false;
  const error = null as unknown as { message: string } | null;

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
        {/* Email/Password master switch — can only be turned off once an admin
            has proven a working OIDC sign-in (lockout safeguard). */}
        <EmailPasswordSettingsCard />

        {/* Single Sign-On (OIDC) providers — Google, Okta, Azure AD, generic OIDC */}
        <SingleSignOnSettingsCard />

        {/* Google Integration OAuth (Calendar, etc.) — workspace-level credentials */}
        <GoogleIntegrationOAuthCard />
      </CardContent>
    </Card>
  );
}

// ─── Email & Password master switch ─────────────────────────────────────────
// Toggles the ENABLE_EMAIL_PASSWORD flag via /api/settings/auth/email-password.
// The switch only allows turning OFF once an admin has signed in via OIDC
// (`canDisable`) — the lockout safeguard. Enabling is always allowed.

function EmailPasswordSettingsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useGetEmailPasswordAuthQuery();
  const [updateAuth, { isLoading: isUpdating }] = useUpdateEmailPasswordAuthMutation();

  // Default to enabled while loading so the toggle never flickers to "off".
  const enabled = data?.enabled ?? true;
  const canDisable = data?.canDisable ?? false;

  const handleToggle = async (next: boolean) => {
    try {
      await updateAuth({ enabled: next }).unwrap();
      toast({
        title: next ? 'Email & password enabled' : 'Email & password disabled',
      });
    } catch (err) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ??
        'Failed to update email/password sign-in.';
      toast({ title: 'Could not update', description: message, variant: 'destructive' });
    }
  };

  // Locked off until an admin has proven OIDC works. Enabling is never gated.
  const lockedOn = enabled && !canDisable;
  const switchDisabled = isLoading || isUpdating || lockedOn;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Label className="text-base font-medium">Email & Password</Label>
            {enabled ? (
              <Badge variant="secondary">Enabled</Badge>
            ) : (
              <Badge variant="outline">Disabled</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Users can sign in with their email and password.
          </p>
        </div>
        <Switch checked={enabled} disabled={switchDisabled} onCheckedChange={handleToggle} />
      </div>

      {lockedOn && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Want SSO-only sign-in? First add an OIDC provider below and sign in with it as an admin.
            Once that succeeds, you can disable email/password here — this check makes sure SSO
            works so you can&apos;t lock yourself out.
          </AlertDescription>
        </Alert>
      )}

      {!enabled && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Email/password sign-in is off — this workspace is OIDC-only and the password form is
            hidden on the login page. Toggle back on any time to restore it.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ─── Single Sign-On (OIDC) providers ───────────────────────────────────────
// CRUD over /api/settings/sso/providers. Replaces the old single-Google
// toggle with a list of pluggable providers (Google, Okta, Azure AD, generic
// OIDC). Each provider in the list maps to one button on /login.

function SingleSignOnSettingsCard() {
  const { data: providers, isLoading } = useListSsoProvidersQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SsoProviderStatus | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: SsoProviderStatus) => {
    setEditing(p);
    setDialogOpen(true);
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">Single Sign-On (OIDC)</Label>
          <p className="text-sm text-muted-foreground">
            Pluggable identity providers — Google, Okta, Azure AD, or any OIDC-compliant IdP. Each
            enabled provider renders one button on the login screen.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Add provider
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !providers || providers.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            No SSO providers configured. Click "Add provider" to set up Google, Okta, Azure AD, or a
            generic OIDC IdP. Self-hosters who set{' '}
            <code className="text-xs">GOOGLE_OAUTH_CLIENT_ID</code> in their environment are
            auto-backfilled here on backend boot.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <SsoProviderRow key={p.id} provider={p} onEdit={() => openEdit(p)} />
          ))}
        </div>
      )}

      {dialogOpen && <SsoProviderDialog provider={editing} onClose={() => setDialogOpen(false)} />}
    </div>
  );
}

function SsoProviderRow({ provider, onEdit }: { provider: SsoProviderStatus; onEdit: () => void }) {
  const { toast } = useToast();
  const [updateProvider, { isLoading: isToggling }] = useUpdateSsoProviderMutation();
  const [deleteProvider, { isLoading: isDeleting }] = useDeleteSsoProviderMutation();
  const [testProvider, { isLoading: isTesting }] = useTestSsoProviderMutation();

  const handleToggle = async (enabled: boolean) => {
    try {
      await updateProvider({ id: provider.id, body: { enabled } }).unwrap();
      toast({ title: enabled ? 'Provider enabled' : 'Provider disabled' });
    } catch (err: unknown) {
      toast({
        title: 'Failed to toggle provider',
        description: extractErrorMessage(err),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete the SSO provider "${provider.displayName}"? This cannot be undone.`))
      return;
    try {
      await deleteProvider({ id: provider.id }).unwrap();
      toast({ title: 'Provider deleted' });
    } catch (err: unknown) {
      toast({
        title: 'Failed to delete provider',
        description: extractErrorMessage(err),
        variant: 'destructive',
      });
    }
  };

  const handleTest = async () => {
    try {
      const result = await testProvider({ id: provider.id }).unwrap();
      if (result.ok) {
        toast({
          title: 'Probe succeeded',
          description: result.issuer ? `Issuer: ${result.issuer}` : 'Credentials decrypt cleanly.',
        });
      } else {
        toast({
          title: 'Probe failed',
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      toast({
        title: 'Probe failed',
        description: extractErrorMessage(err),
        variant: 'destructive',
      });
    }
  };

  const isEnvSourced = provider.source === 'env';

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{provider.displayName}</Label>
          <Badge variant="outline" className="text-xs">
            {kindLabel(provider.kind)}
          </Badge>
          {isEnvSourced && (
            <Badge variant="secondary" className="text-xs">
              env-managed
            </Badge>
          )}
          {provider.enabled ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
              <CheckCircle className="h-3 w-3 mr-1" />
              Enabled
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              <XCircle className="h-3 w-3 mr-1" />
              Disabled
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          id: <code>{provider.providerId}</code>
          {provider.clientIdMasked && (
            <>
              {' '}
              · clientId: <code>{provider.clientIdMasked}</code>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch checked={provider.enabled} onCheckedChange={handleToggle} disabled={isToggling} />
        <Button variant="ghost" size="sm" onClick={handleTest} disabled={isTesting}>
          {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting || isEnvSourced}
          title={
            isEnvSourced
              ? 'Env-managed providers cannot be deleted via UI — unset env vars and restart'
              : 'Delete'
          }
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function SsoProviderDialog({
  provider,
  onClose,
}: {
  provider: SsoProviderStatus | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isCreate = !provider;
  const [createProvider, { isLoading: isCreating }] = useCreateSsoProviderMutation();
  const [updateProvider, { isLoading: isUpdating }] = useUpdateSsoProviderMutation();

  const [providerId, setProviderId] = useState(provider?.providerId ?? '');
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '');
  const [kind, setKind] = useState<SsoProviderKind>(provider?.kind ?? 'oidc');
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [oidcDiscoveryEndpoint, setOidcDiscoveryEndpoint] = useState(
    provider?.oidcDiscoveryEndpoint ?? '',
  );
  const [oktaDomain, setOktaDomain] = useState(provider?.oktaDomain ?? '');
  const [directoryId, setDirectoryId] = useState(provider?.directoryId ?? '');
  const [scope, setScope] = useState((provider?.scope ?? []).join(' '));

  // When kind changes (in create mode only — kind is locked on edit), reset
  // kind-specific fields so we don't carry stale Okta domain into a generic
  // OIDC submission.
  useEffect(() => {
    if (!isCreate) return;
    setOidcDiscoveryEndpoint('');
    setOktaDomain('');
    setDirectoryId('');
  }, [kind, isCreate]);

  const handleSave = async () => {
    const config: SsoProviderConfig = {
      clientId,
      clientSecret,
      ...(kind === 'oidc' && oidcDiscoveryEndpoint ? { oidcDiscoveryEndpoint } : {}),
      ...(kind === 'okta' && oktaDomain ? { oktaDomain } : {}),
      ...(kind === 'azure-ad' && directoryId ? { directoryId } : {}),
      ...(scope.trim() ? { scope: scope.trim().split(/\s+/) } : {}),
    };

    try {
      if (isCreate) {
        await createProvider({ providerId, displayName, kind, config, enabled }).unwrap();
        toast({ title: 'Provider created' });
      } else {
        // On edit, omit clientSecret if blank so backend keeps the existing one.
        const editConfig: Partial<SsoProviderConfig> = {
          ...(clientId ? { clientId } : {}),
          ...(clientSecret ? { clientSecret } : {}),
          ...(kind === 'oidc' && oidcDiscoveryEndpoint ? { oidcDiscoveryEndpoint } : {}),
          ...(kind === 'okta' && oktaDomain ? { oktaDomain } : {}),
          ...(kind === 'azure-ad' && directoryId ? { directoryId } : {}),
          ...(scope.trim() ? { scope: scope.trim().split(/\s+/) } : {}),
        };
        await updateProvider({
          id: provider!.id,
          body: { displayName, enabled, config: editConfig },
        }).unwrap();
        toast({ title: 'Provider updated' });
      }
      onClose();
    } catch (err: unknown) {
      toast({
        title: 'Failed to save provider',
        description: extractErrorMessage(err),
        variant: 'destructive',
      });
    }
  };

  const isSaving = isCreating || isUpdating;
  const canSubmit = !!displayName && (!isCreate || (!!providerId && !!clientId && !!clientSecret));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isCreate ? 'Add SSO Provider' : `Edit ${provider!.displayName}`}
          </DialogTitle>
          <DialogDescription>
            {isCreate
              ? 'Configure an OIDC provider. Pick the kind that matches your IdP — Google, Okta, Azure AD, or a generic OIDC server.'
              : 'Update display name, scope, or rotate credentials. Leave clientSecret blank to keep the existing one.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isCreate && (
            <>
              <div>
                <Label className="text-sm">Kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as SsoProviderKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="okta">Okta</SelectItem>
                    <SelectItem value="azure-ad">Azure AD / Microsoft Entra</SelectItem>
                    <SelectItem value="oidc">Generic OIDC (any IdP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Provider ID (URL slug)</Label>
                <Input
                  placeholder="okta-acme"
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Lowercase letters, numbers, hyphens. Used in /api/auth/oauth/<i>:providerId</i>
                  /url. Pick something stable — it can't be renamed.
                </p>
              </div>
            </>
          )}

          <div>
            <Label className="text-sm">Display name</Label>
            <Input
              placeholder="Acme SSO"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">Shown on the login button.</p>
          </div>

          <div>
            <Label className="text-sm">Client ID</Label>
            <Input
              placeholder={isCreate ? '' : (provider?.clientIdMasked ?? '')}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>

          <div>
            <Label className="text-sm">Client Secret</Label>
            <Input
              type="password"
              placeholder={isCreate ? '' : '(leave blank to keep existing)'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>

          {kind === 'oidc' && (
            <div>
              <Label className="text-sm">Issuer URL</Label>
              <Input
                placeholder="https://idp.example.com"
                value={oidcDiscoveryEndpoint}
                onChange={(e) => setOidcDiscoveryEndpoint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The IdP's base issuer URL (e.g. <code>http://localhost:5556</code> for local Dex).
                Pasting the full <code>/.well-known/openid-configuration</code> URL also works — the
                suffix is stripped automatically.
              </p>
            </div>
          )}

          {kind === 'okta' && (
            <div>
              <Label className="text-sm">Okta Domain</Label>
              <Input
                placeholder="dev-XXXXXX.okta.com"
                value={oktaDomain}
                onChange={(e) => setOktaDomain(e.target.value)}
              />
            </div>
          )}

          {kind === 'azure-ad' && (
            <div>
              <Label className="text-sm">Directory (Tenant) ID</Label>
              <Input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={directoryId}
                onChange={(e) => setDirectoryId(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label className="text-sm">Scopes (space-separated, optional)</Label>
            <Input
              placeholder="openid email profile"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Defaults to <code>openid email profile</code> for generic OIDC; provider built-ins set
              their own.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-2">
            <Label className="text-sm">Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit || isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isCreate ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function kindLabel(kind: SsoProviderKind): string {
  switch (kind) {
    case 'google':
      return 'Google';
    case 'okta':
      return 'Okta';
    case 'azure-ad':
      return 'Azure AD';
    case 'oidc':
      return 'Generic OIDC';
  }
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}

// ─── Google Integration OAuth (workspace-level credentials) ────────────────
// Only the Calendar service is rendered today. The backend table supports
// per-service rows (drive/sheets/gmail) — those become additional cards in
// follow-up stories alongside their handlers (0048 §Out of scope).

function GoogleIntegrationOAuthCard() {
  const { toast } = useToast();
  const { data: status, isLoading } = useGetGoogleIntegrationQuery({ service: 'calendar' });
  const [updateCreds, { isLoading: isSaving }] = useUpdateGoogleIntegrationMutation();
  const [deleteCreds, { isLoading: isClearing }] = useDeleteGoogleIntegrationMutation();
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
      await updateCreds({ service: 'calendar', body: { clientId, clientSecret } }).unwrap();
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
    if (
      !confirm(
        'Clear the workspace Google OAuth integration credentials? Project-level Google Calendar connections will stop working until new credentials are saved.',
      )
    ) {
      return;
    }
    try {
      await deleteCreds({ service: 'calendar' }).unwrap();
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
