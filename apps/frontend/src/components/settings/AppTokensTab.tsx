import { useMemo, useState } from 'react';
import {
  useListAppTokensQuery,
  useCreateAppTokenMutation,
  useRevokeAppTokenMutation,
  type CreateAppTokenResponse,
} from '@/services/appTokensApi';
import { useListMyProjectsQuery } from '@/services/meApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, CheckCircle, Copy, KeyRound, Trash2 } from 'lucide-react';

const SCOPE_PATTERN = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;
const DEFAULT_TTL_DAYS = 90;

/** "workflow:read workflow:run" or comma-separated → unique scope list. */
export function parseScopes(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function defaultExpiryDate(): string {
  const d = new Date(Date.now() + DEFAULT_TTL_DAYS * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * App tokens — scoped, project-bound bearers a member mints for an agent or a
 * script (or an OAuth client obtained on their behalf). Every member gets this
 * tab: a token never elevates, so minting is safe for any role.
 */
export function AppTokensTab() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [minted, setMinted] = useState<CreateAppTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [scopesInput, setScopesInput] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiryDate);
  const [neverExpires, setNeverExpires] = useState(false);

  const { data: tokens, isLoading, error } = useListAppTokensQuery();
  const { data: projects } = useListMyProjectsQuery();
  const [createToken, { isLoading: isCreating }] = useCreateAppTokenMutation();
  const [revokeToken, { isLoading: isRevoking }] = useRevokeAppTokenMutation();

  const scopes = useMemo(() => parseScopes(scopesInput), [scopesInput]);
  const badScopes = scopes.filter((s) => !SCOPE_PATTERN.test(s));
  // A member of exactly one project need not pick it.
  const effectiveProject = project || (projects?.length === 1 ? projects[0].projectSlug : '');

  const resetForm = () => {
    setName('');
    setProject('');
    setScopesInput('');
    setExpiresAt(defaultExpiryDate());
    setNeverExpires(false);
  };

  const handleMint = async () => {
    if (!name.trim() || !effectiveProject || scopes.length === 0 || badScopes.length > 0) {
      toast({
        title: 'Missing details',
        description: 'A name, a project and at least one scope (namespace:verb) are needed.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const response = await createToken({
        name: name.trim(),
        project: effectiveProject,
        scopes,
        // Only the chosen shape is sent: an older server (no `neverExpires` in
        // its DTO) still accepts the dated/default form from this UI.
        ...(neverExpires
          ? { neverExpires: true }
          : {
              expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : undefined,
            }),
      }).unwrap();
      setMinted(response);
      resetForm();
      toast({ title: 'Token minted', description: 'Copy it now — it will not be shown again.' });
    } catch (err: unknown) {
      const message = (err as { data?: { message?: string } })?.data?.message;
      toast({
        title: 'Error',
        description: message || 'Failed to mint the token',
        variant: 'destructive',
      });
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Error', description: 'Failed to copy to clipboard', variant: 'destructive' });
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeToken(id).unwrap();
      toast({ title: 'Token revoked', description: 'Anything using it will get 401 from now on.' });
      setRevoking(null);
    } catch (err: unknown) {
      const message = (err as { data?: { message?: string } })?.data?.message;
      toast({
        title: 'Error',
        description: message || 'Failed to revoke the token',
        variant: 'destructive',
      });
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setMinted(null);
    resetForm();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load app tokens.{' '}
          {(error as { data?: { message?: string } })?.data?.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>App Tokens</CardTitle>
            <CardDescription>
              Scoped, project-bound bearer tokens that act as you — for an agent or a script. A
              token can only do what you can do, narrowed to the scopes you grant. Tokens obtained
              by an OAuth client (a chat connector) appear here too.
            </CardDescription>
          </div>
          <Dialog
            open={createOpen}
            onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}
          >
            <DialogTrigger asChild>
              <Button>
                <KeyRound className="h-4 w-4 mr-2" />
                Mint token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{minted ? 'Token minted' : 'Mint an app token'}</DialogTitle>
                <DialogDescription>
                  {minted
                    ? 'Copy your token now. It will not be shown again.'
                    : 'The token acts as you on one project, limited to the scopes you list.'}
                </DialogDescription>
              </DialogHeader>

              {minted ? (
                <div className="space-y-4 py-4" data-testid="minted-token">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>This is the only time the token is shown.</AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label>Token</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={minted.token}
                        readOnly
                        className="font-mono text-sm"
                        aria-label="App token"
                      />
                      <Button variant="outline" size="sm" onClick={() => handleCopy(minted.token)}>
                        {copied ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Send it as <code>Authorization: Bearer …</code>.
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="app-token-name">Name</Label>
                    <Input
                      id="app-token-name"
                      placeholder="e.g. Claude — workflow"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="app-token-project">Project</Label>
                    <Select value={effectiveProject} onValueChange={setProject}>
                      <SelectTrigger id="app-token-project" aria-label="Project">
                        <SelectValue placeholder="Choose a project you belong to" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((p) => (
                          <SelectItem key={p.projectId} value={p.projectSlug}>
                            {p.projectSlug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="app-token-scopes">Scopes</Label>
                    <Input
                      id="app-token-scopes"
                      placeholder="workflow:read workflow:run"
                      value={scopesInput}
                      onChange={(e) => setScopesInput(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      The app’s own vocabulary, space-separated (namespace:verb) — e.g.
                      workflow:read workflow:run workflow:files. Add auth:session to let the token
                      be exchanged for a browser session (headless runs).
                    </p>
                    {scopes.length > 0 && (
                      <div className="flex flex-wrap gap-1" data-testid="scope-chips">
                        {scopes.map((s) => (
                          <Badge
                            key={s}
                            variant={SCOPE_PATTERN.test(s) ? 'secondary' : 'destructive'}
                          >
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="app-token-expires">Expires</Label>
                    <Input
                      id="app-token-expires"
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      disabled={neverExpires}
                    />
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="app-token-never-expires"
                        checked={neverExpires}
                        onCheckedChange={(checked) => setNeverExpires(checked === true)}
                      />
                      <Label htmlFor="app-token-never-expires" className="font-normal">
                        Never expires
                      </Label>
                    </div>
                    {neverExpires && (
                      <p className="text-xs text-muted-foreground" data-testid="never-expires-note">
                        For long-lived automation (CI, MCP connectors, headless drivers). The token
                        stays valid until you revoke it — treat it like a password.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter>
                {minted ? (
                  <Button onClick={closeCreate}>Done</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={closeCreate}>
                      Cancel
                    </Button>
                    <Button onClick={handleMint} disabled={isCreating}>
                      {isCreating ? 'Minting…' : 'Mint token'}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!tokens || tokens.length === 0 ? (
          <div className="text-center py-12">
            <KeyRound className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No app tokens yet</h3>
            <p className="text-muted-foreground">
              Mint one to let an agent or a script act as you on a project.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <TableRow key={t.id} className={t.revokedAt ? 'opacity-60' : undefined}>
                  <TableCell className="font-medium">
                    <span className={t.revokedAt ? 'line-through' : undefined}>{t.name}</span>
                    <div className="font-mono text-xs text-muted-foreground">{t.tokenPrefix}…</div>
                    {t.revokedAt && (
                      <div className="text-xs text-muted-foreground">
                        Revoked {fmt(t.revokedAt)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {t.project.owner}/{t.project.name}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} variant="outline">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.kind === 'oauth'
                      ? `OAuth${t.clientId ? ` · ${t.clientId}` : ''}`
                      : 'Personal'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.expiresAt ? fmt(t.expiresAt) : 'Never'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.lastUsedAt ? fmt(t.lastUsedAt) : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    {!t.revokedAt && (
                      <AlertDialog
                        open={revoking === t.id}
                        onOpenChange={(open) => setRevoking(open ? t.id : null)}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Revoke ${t.name}`}
                            onClick={() => setRevoking(t.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke app token</AlertDialogTitle>
                            <AlertDialogDescription>
                              Revoke “{t.name}”? Anything using it will be refused from now on. This
                              cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setRevoking(null)}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRevoke(t.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              disabled={isRevoking}
                            >
                              {isRevoking ? 'Revoking…' : 'Revoke'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
