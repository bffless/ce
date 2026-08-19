// Admin Settings → Infrastructure → Remote connections.
// Named services this instance calls with its own identity (the ffmpeg Remote
// executor and `remote_request` pipeline steps resolve them by name). Fields an
// admin has pinned with REMOTE_CONNECTION_<NAME>_* env vars render read-only,
// and a connection that exists ONLY in the environment has no row to edit or
// delete — it can only be tested.
import { Fragment, useState } from 'react';
import {
  useCreateRemoteConnectionMutation,
  useDeleteRemoteConnectionMutation,
  useListRemoteConnectionsQuery,
  useTestRemoteConnectionMutation,
  useUpdateRemoteConnectionMutation,
  type RemoteConnectionStatus,
  type RemoteConnectionTestResult,
} from '@/services/settingsApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import {
  RemoteConnectionForm,
  isDraftValid,
  toConnectionDraft,
  toTestDraft,
  toUpsertDto,
  type ConnectionDraft,
} from './RemoteConnectionForm';
import { TestResultLine, authLabel, errorMessage, hostOf } from './shared';

const IN_USE_BY_FFMPEG = 'In use by the ffmpeg Remote executor';

/** What identity a call would use, given what the API is willing to tell us. */
function credentialLabel(c: RemoteConnectionStatus): string {
  if (c.hasCredential) return 'Key stored';
  return c.auth === 'none' ? '—' : 'ADC';
}

function usageLabel(c: RemoteConnectionStatus): string {
  const parts: string[] = [];
  if (c.usedBy.ffmpegExecutor) parts.push('ffmpeg executor');
  if (c.usedBy.rules > 0) parts.push(`${c.usedBy.rules} rule${c.usedBy.rules === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function RemoteConnectionsSettings() {
  const { toast } = useToast();
  const { data: connections, isLoading, error } = useListRemoteConnectionsQuery();
  const [create, { isLoading: creating }] = useCreateRemoteConnectionMutation();
  const [update, { isLoading: updating }] = useUpdateRemoteConnectionMutation();
  const [remove] = useDeleteRemoteConnectionMutation();
  const [test, { isLoading: testing }] = useTestRemoteConnectionMutation();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RemoteConnectionStatus | undefined>(undefined);
  const [draft, setDraft] = useState<ConnectionDraft>(() => toConnectionDraft());
  const [dialogTest, setDialogTest] = useState<RemoteConnectionTestResult | null>(null);
  /** Per-row "Test" results, keyed by connection name. */
  const [rowTests, setRowTests] = useState<Record<string, RemoteConnectionTestResult>>({});

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load remote connections.</AlertDescription>
      </Alert>
    );
  }

  const openDialog = (connection?: RemoteConnectionStatus) => {
    setEditing(connection);
    setDraft(toConnectionDraft(connection));
    setDialogTest(null);
    setOpen(true);
  };

  // ONE predicate decides both the DTO shape and the mutation: an env-only
  // connection has no row to PATCH, so diffing it like an edit and then POSTing
  // that diff to create() would drop the fields the create needs.
  const existing = editing?.id ? editing : undefined;
  const dto = toUpsertDto(existing, draft);
  const saveDisabled =
    !isDraftValid(draft) || creating || updating || (!!existing && Object.keys(dto).length === 0);

  const onSave = async () => {
    try {
      if (existing?.id) await update({ id: existing.id, body: dto }).unwrap();
      else await create(dto).unwrap();
      toast({ title: existing ? 'Connection updated' : 'Connection created' });
      setOpen(false);
    } catch (err) {
      toast({
        title: 'Failed to save the connection',
        description: errorMessage(err),
        variant: 'destructive',
      });
    }
  };

  const onDialogTest = async () => {
    setDialogTest(null);
    try {
      setDialogTest(await test(toTestDraft(editing, draft)).unwrap());
    } catch (err) {
      toast({ title: 'Test failed', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const onRowTest = async (c: RemoteConnectionStatus) => {
    try {
      // Saved connections test by identity: the server fills in every field
      // (above all the credential, which this UI can never send back).
      const result = await test(c.id ? { id: c.id } : { name: c.name }).unwrap();
      setRowTests((prev) => ({ ...prev, [c.name]: result }));
    } catch (err) {
      toast({ title: 'Test failed', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const onDelete = async (c: RemoteConnectionStatus) => {
    if (!c.id) return;
    if (
      !window.confirm(`Delete the connection '${c.name}'? Anything still calling it will fail.`)
    ) {
      return;
    }
    try {
      await remove({ id: c.id }).unwrap();
      toast({ title: 'Connection deleted' });
    } catch (err) {
      toast({
        title: 'Failed to delete the connection',
        description: errorMessage(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Remote connections</CardTitle>
          <CardDescription>
            Named services this instance calls with its own identity (Cloud Run reference). Used by
            the ffmpeg Remote executor and <code>remote_request</code> pipeline steps.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={() => openDialog()}>
          <Plus className="mr-1 h-4 w-4" />
          Add connection
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !connections || connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No connections yet. Add one to call a service (an ffmpeg Worker, a renderer) with this
            instance&apos;s identity.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>In-flight</TableHead>
                <TableHead>Used by</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((c) => (
                <Fragment key={c.name}>
                  <TableRow data-testid={`connection-row-${c.name}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{c.name}</span>
                        {c.envOnly && (
                          <Badge variant="secondary" className="text-[10px]">
                            Env
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{hostOf(c.url)}</TableCell>
                    <TableCell>
                      <Badge variant={c.auth === 'none' ? 'destructive' : 'outline'}>
                        {authLabel(c.auth)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{credentialLabel(c)}</TableCell>
                    <TableCell className="text-xs">{c.maxInflight}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{usageLabel(c)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Test ${c.name}`}
                        disabled={testing}
                        onClick={() => onRowTest(c)}
                      >
                        Test
                      </Button>
                      {/* No DB row = nothing to edit or delete; the env owns it. */}
                      {c.id && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${c.name}`}
                            onClick={() => openDialog(c)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${c.name}`}
                            disabled={c.usedBy.ffmpegExecutor}
                            title={c.usedBy.ffmpegExecutor ? IN_USE_BY_FFMPEG : undefined}
                            onClick={() => onDelete(c)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                  {rowTests[c.name] && (
                    <TableRow data-testid={`connection-test-${c.name}`}>
                      <TableCell colSpan={7}>
                        <TestResultLine result={rowTests[c.name]} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit connection' : 'Add connection'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Only the fields you change are sent; fields pinned by environment variables are read-only.'
                : 'A name rules and the ffmpeg executor can point at, plus how to reach and authenticate to the service.'}
            </DialogDescription>
          </DialogHeader>
          <RemoteConnectionForm
            key={editing?.id ?? 'new'}
            draft={draft}
            existing={editing}
            onChange={setDraft}
            onTest={onDialogTest}
            testing={testing}
            testResult={dialogTest}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={onSave} disabled={saveDisabled}>
              {creating || updating ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
