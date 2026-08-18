// Admin Settings → Features → Server video ops → Executor.
// Configures WHICH executor runs ffmpeg jobs: Local server (ffmpeg in this
// backend) and/or Remote (a Worker CE calls over HTTPS; Cloud Run is the
// reference deployment). Fields pinned by env vars render read-only.
//
// Since Plan 4 this panel no longer owns the Worker's URL, auth mode or
// service-account key: it POINTS AT a remote connection, and those fields are
// edited once, in Infrastructure → Remote connections. All this panel decides
// is which connection the Remote executor calls.
import { useEffect, useMemo, useState } from 'react';
import {
  useGetFfmpegExecutorSettingsQuery,
  useTestFfmpegExecutorConnectionMutation,
  useUpdateFfmpegExecutorSettingsMutation,
  type FfmpegExecutorName,
  type FfmpegExecutorStatus,
  type FfmpegExecutorTestResult,
  type UpdateFfmpegExecutorDto,
} from '@/services/settingsApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Cloud, Server, XCircle } from 'lucide-react';
import { EnvBadge, authLabel, errorMessage, hostOf } from './remote-connections/shared';

/** Both spellings pin the selection, and an admin needs to know which to edit. */
const CONNECTION_ENV_VARS = 'FFMPEG_REMOTE_CONNECTION / FFMPEG_REMOTE_URL';
/** An env-only connection has no DB row, so the executor row cannot point at it. */
const ENV_ONLY_HINT = ' (env — select with FFMPEG_REMOTE_CONNECTION)';

interface Draft {
  localEnabled: boolean;
  remoteEnabled: boolean;
  /** A remote connection NAME; '' = none selected. */
  remoteConnection: string;
  defaultExecutor: FfmpegExecutorName;
}

function toDraft(s: FfmpegExecutorStatus): Draft {
  return {
    localEnabled: s.localEnabled,
    remoteEnabled: s.remoteEnabled,
    remoteConnection: s.remoteConnection?.name ?? '',
    defaultExecutor: s.defaultExecutor,
  };
}

/** Only the fields that differ from the saved status (the API is partial-update). */
function diff(s: FfmpegExecutorStatus, d: Draft): UpdateFfmpegExecutorDto {
  const out: UpdateFfmpegExecutorDto = {};
  if (d.localEnabled !== s.localEnabled) out.localEnabled = d.localEnabled;
  if (d.remoteEnabled !== s.remoteEnabled) out.remoteEnabled = d.remoteEnabled;
  if (d.remoteConnection !== (s.remoteConnection?.name ?? '')) {
    out.remoteConnection = d.remoteConnection || null;
  }
  if (d.defaultExecutor !== s.defaultExecutor) out.defaultExecutor = d.defaultExecutor;
  return out;
}

/**
 * Keep the draft's default executor selectable: turning an executor off (or
 * clearing the connection) would otherwise leave a default the server rejects
 * with a 400 on save. Moves to the other executor when that one is selectable;
 * if neither is, leave it and let the server's message surface in the toast.
 * An env-pinned default (FFMPEG_EXECUTOR) is never moved — the radio group is
 * disabled and the server ignores the field, so auto-moving it here would
 * just produce a phantom defaultExecutor change in the diff.
 */
function withSelectableDefault(d: Draft, localAvailable: boolean, defaultPinned: boolean): Draft {
  if (defaultPinned) return d;
  const localSelectable = d.localEnabled && localAvailable;
  const remoteSelectable = d.remoteEnabled && d.remoteConnection !== '';
  if (d.defaultExecutor === 'remote' && !remoteSelectable && localSelectable) {
    return { ...d, defaultExecutor: 'local' };
  }
  if (d.defaultExecutor === 'local' && !localSelectable && remoteSelectable) {
    return { ...d, defaultExecutor: 'remote' };
  }
  return d;
}

/** What identity a call would use, given what the status is willing to tell us. */
function credentialLabel(c: NonNullable<FfmpegExecutorStatus['remoteConnection']>): string {
  if (c.hasCredential) return 'Key stored';
  return c.auth === 'none' ? 'No auth' : 'ADC';
}

export function FfmpegExecutorSettings() {
  const { toast } = useToast();
  const { data: status, isLoading, error } = useGetFfmpegExecutorSettingsQuery();
  const [update, { isLoading: saving }] = useUpdateFfmpegExecutorSettingsMutation();
  const [testConnection, { isLoading: testing }] = useTestFfmpegExecutorConnectionMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testResult, setTestResult] = useState<FfmpegExecutorTestResult | null>(null);

  useEffect(() => {
    if (status) setDraft(toDraft(status));
  }, [status]);

  const changes = useMemo(() => (status && draft ? diff(status, draft) : {}), [status, draft]);
  const dirty = Object.keys(changes).length > 0;
  // The server refuses Remote-on-without-a-connection outright ("Remote executor
  // needs a connection"), so don't offer the round trip.
  const incomplete = !!draft?.remoteEnabled && !draft.remoteConnection;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load executor settings.</AlertDescription>
      </Alert>
    );
  }
  if (isLoading || !draft || !status) return <Skeleton className="h-40 w-full" />;

  const set = (patch: Partial<Draft>) => {
    // A test result describes the connection it was run against — picking a
    // different one makes it stale.
    if ('remoteConnection' in patch) setTestResult(null);
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      // The server refuses `remoteConnection: null` while Remote is on
      // ("Remote executor needs a connection"), so clearing the selection turns
      // Remote off in the same draft rather than producing a save that 400s.
      if (next.remoteEnabled && next.remoteConnection === '' && d.remoteConnection !== '') {
        next.remoteEnabled = false;
      }
      return withSelectableDefault(
        next,
        status.localAvailable,
        status.envManaged.defaultExecutor,
      );
    });
  };
  const localSelectable = draft.localEnabled && status.localAvailable;
  const remoteSelectable = draft.remoteEnabled && draft.remoteConnection !== '';
  const selectedOption = status.connections.find((c) => c.name === draft.remoteConnection);
  // The status only carries the URL/credential of the SAVED selection, so the
  // full summary is only truthful while the draft still points at it.
  const savedConnection =
    status.remoteConnection && status.remoteConnection.name === draft.remoteConnection
      ? status.remoteConnection
      : null;

  const onSave = async () => {
    try {
      await update(changes).unwrap();
      toast({ title: 'Executor settings saved' });
      setTestResult(null);
    } catch (err) {
      toast({
        title: 'Failed to save executor settings',
        description: errorMessage(err),
        variant: 'destructive',
      });
    }
  };

  const onTest = async () => {
    setTestResult(null);
    try {
      const res = await testConnection({ remoteConnection: draft.remoteConnection }).unwrap();
      setTestResult(res);
    } catch (err) {
      toast({ title: 'Test failed', description: errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="ml-8 space-y-4 rounded-lg border border-dashed p-4">
      <div>
        <Label className="text-sm font-medium">Executor</Label>
        <p className="text-xs text-muted-foreground">
          Where ffmpeg jobs run. Enable Local, Remote, or both, then pick the default. Steps can
          still name an executor explicitly.
        </p>
      </div>

      {/* Local server */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <Label htmlFor="ffmpeg-local" className="text-sm font-medium">
              Local server
            </Label>
            <p className="text-xs text-muted-foreground">
              {status.localAvailable ? (
                <>
                  ffmpeg spawned by this backend · {status.localVersion} · memory floor: see Sizing
                  in the docs
                </>
              ) : (
                'ffmpeg is not installed on this server — the Local executor cannot be enabled'
              )}
            </p>
          </div>
        </div>
        <Switch
          id="ffmpeg-local"
          aria-label="Local server"
          checked={draft.localEnabled}
          disabled={!status.localAvailable}
          onCheckedChange={(v) => set({ localEnabled: v })}
        />
      </div>

      {/* Remote (Worker) */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <Label htmlFor="ffmpeg-remote" className="text-sm font-medium">
              Remote (Worker)
            </Label>
            <p className="text-xs text-muted-foreground">
              {status.storagePresignable
                ? 'A Worker CE calls over HTTPS — bytes move bucket ↔ Worker via signed URLs and never touch this server. Cloud Run is the reference deployment.'
                : 'Needs bucket storage (S3, GCS, MinIO, Azure) — the Worker moves bytes through signed URLs, which local filesystem storage cannot provide.'}
            </p>
          </div>
        </div>
        {/* An env-pinned connection forces Remote on server-side (resolveWith), so
            the switch is read-only rather than a toggle that snaps back. */}
        <Switch
          id="ffmpeg-remote"
          aria-label="Remote"
          checked={draft.remoteEnabled}
          disabled={!status.storagePresignable || status.envManaged.remoteConnection}
          onCheckedChange={(v) => set({ remoteEnabled: v })}
        />
      </div>

      {draft.remoteEnabled && (
        <div className="ml-7 space-y-3">
          {status.connections.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No remote connections yet — add one under Infrastructure → Remote connections.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="ffmpeg-remote-connection" className="text-xs">
                    Connection
                  </Label>
                  {status.envManaged.remoteConnection && <EnvBadge name={CONNECTION_ENV_VARS} />}
                </div>
                <Select
                  value={draft.remoteConnection}
                  disabled={status.envManaged.remoteConnection}
                  onValueChange={(v) => set({ remoteConnection: v })}
                >
                  <SelectTrigger id="ffmpeg-remote-connection" aria-label="Connection" className="w-72">
                    <SelectValue placeholder="Select a connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {status.connections.map((c) => (
                      // An env-only connection has no row for the executor's FK
                      // to point at — it can only be chosen from the environment.
                      <SelectItem key={c.name} value={c.name} disabled={c.envOnly}>
                        {c.name}
                        {c.envOnly ? ENV_ONLY_HINT : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedOption ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {savedConnection && (
                      <span className="font-mono">{hostOf(savedConnection.url)}</span>
                    )}
                    <span>{authLabel(selectedOption.auth)}</span>
                    {savedConnection ? (
                      <Badge variant="outline" className="text-[10px]">
                        {credentialLabel(savedConnection)}
                      </Badge>
                    ) : (
                      <span>URL and credential are shown once this selection is saved.</span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Remote needs a connection — pick the service this instance calls.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onTest}
                  disabled={testing || !draft.remoteConnection}
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </Button>
                {testResult && (
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      {testResult.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span>
                        {testResult.worker && (
                          <>
                            Worker {testResult.worker.version} ·{' '}
                            {testResult.worker.ffmpeg ?? 'no ffmpeg'} · ops{' '}
                            {testResult.worker.ops.join(', ')}
                            {testResult.latencyMs !== null && <> · {testResult.latencyMs} ms</>}
                          </>
                        )}
                        {/* A reachable Worker can still report an error (e.g. a bad key). */}
                        {testResult.error && (
                          <>
                            {testResult.worker ? ' · ' : ''}
                            {testResult.error}
                          </>
                        )}
                        {!testResult.worker && !testResult.error && 'No response from the Worker.'}
                      </span>
                    </div>
                    <div
                      className={
                        testResult.readiness.ok ? 'text-muted-foreground' : 'text-destructive'
                      }
                    >
                      {testResult.readiness.ok
                        ? 'Ready'
                        : `Not ready: ${testResult.readiness.reason ?? 'unknown reason'}`}
                    </div>
                    <div className="text-muted-foreground">
                      {testResult.credential === 'adc' &&
                        'Using Application Default Credentials (no key stored) — this works when CE runs on GCP; elsewhere paste a service-account key.'}
                      {testResult.credential === 'sa_key' && 'Using the stored service-account key.'}
                      {testResult.credential === 'none' && 'No auth.'}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Plain anchor, not a router Link: this panel is also rendered in
              tests and stories that have no Router above it. */}
          <a
            href="/admin/settings/infrastructure"
            className="inline-block text-xs text-muted-foreground underline underline-offset-2"
          >
            Manage connections in Infrastructure →
          </a>
        </div>
      )}

      {/* Default executor */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Default executor</Label>
          {status.envManaged.defaultExecutor && <EnvBadge name="FFMPEG_EXECUTOR" />}
        </div>
        <RadioGroup
          value={draft.defaultExecutor}
          disabled={status.envManaged.defaultExecutor}
          onValueChange={(v) => set({ defaultExecutor: v as FfmpegExecutorName })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem
              id="ffmpeg-default-local"
              value="local"
              disabled={!localSelectable}
              aria-label="local"
            />
            <Label htmlFor="ffmpeg-default-local" className="text-xs font-normal">
              Local server
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem
              id="ffmpeg-default-remote"
              value="remote"
              disabled={!remoteSelectable}
              aria-label="remote"
            />
            <Label htmlFor="ffmpeg-default-remote" className="text-xs font-normal">
              Remote
            </Label>
          </div>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">Only enabled executors can be the default.</p>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || incomplete || saving}>
          {saving ? 'Saving…' : 'Save executor settings'}
        </Button>
      </div>
    </div>
  );
}
