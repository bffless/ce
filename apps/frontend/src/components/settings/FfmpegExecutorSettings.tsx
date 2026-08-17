// Admin Settings → Features → Server video ops → Executor.
// Configures WHICH executor runs ffmpeg jobs: Local server (ffmpeg in this
// backend) and/or Remote (a Worker CE calls over HTTPS; Cloud Run is the
// reference deployment). Fields pinned by env vars render read-only.
// The service-account key is write-only: the API only ever says whether one
// is stored, so this form has a "replace" flow rather than a value.
import { useEffect, useMemo, useState } from 'react';
import {
  useGetFfmpegExecutorSettingsQuery,
  useTestFfmpegExecutorConnectionMutation,
  useUpdateFfmpegExecutorSettingsMutation,
  type FfmpegExecutorName,
  type FfmpegExecutorStatus,
  type FfmpegExecutorTestResult,
  type FfmpegRemoteAuth,
  type UpdateFfmpegExecutorDto,
} from '@/services/settingsApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Cloud, Server, XCircle } from 'lucide-react';

interface Draft {
  localEnabled: boolean;
  remoteEnabled: boolean;
  remoteUrl: string;
  remoteAuth: FfmpegRemoteAuth;
  defaultExecutor: FfmpegExecutorName;
  /** Textarea contents; '' = nothing to send. */
  saKeyJson: string;
  /** "Remove key" clicked → send saKeyJson: null on save. */
  removeKey: boolean;
}

function toDraft(s: FfmpegExecutorStatus): Draft {
  return {
    localEnabled: s.localEnabled,
    remoteEnabled: s.remoteEnabled,
    remoteUrl: s.remoteUrl ?? '',
    remoteAuth: s.remoteAuth,
    defaultExecutor: s.defaultExecutor,
    saKeyJson: '',
    removeKey: false,
  };
}

/** Only the fields that differ from the saved status (the API is partial-update). */
function diff(s: FfmpegExecutorStatus, d: Draft): UpdateFfmpegExecutorDto {
  const out: UpdateFfmpegExecutorDto = {};
  if (d.localEnabled !== s.localEnabled) out.localEnabled = d.localEnabled;
  if (d.remoteEnabled !== s.remoteEnabled) out.remoteEnabled = d.remoteEnabled;
  if (d.remoteUrl.trim() !== (s.remoteUrl ?? '')) out.remoteUrl = d.remoteUrl.trim() || null;
  if (d.remoteAuth !== s.remoteAuth) out.remoteAuth = d.remoteAuth;
  if (d.defaultExecutor !== s.defaultExecutor) out.defaultExecutor = d.defaultExecutor;
  if (d.removeKey) out.saKeyJson = null;
  else if (d.saKeyJson.trim()) out.saKeyJson = d.saKeyJson.trim();
  return out;
}

/**
 * Keep the draft's default executor selectable: turning an executor off (or
 * clearing the Worker URL) would otherwise leave a default the server rejects
 * with a 400 on save. Moves to the other executor when that one is selectable;
 * if neither is, leave it and let the server's message surface in the toast.
 * An env-pinned default (FFMPEG_EXECUTOR) is never moved — the radio group is
 * disabled and the server ignores the field, so auto-moving it here would
 * just produce a phantom defaultExecutor change in the diff.
 */
function withSelectableDefault(d: Draft, localAvailable: boolean, defaultPinned: boolean): Draft {
  if (defaultPinned) return d;
  const localSelectable = d.localEnabled && localAvailable;
  const remoteSelectable = d.remoteEnabled && d.remoteUrl.trim() !== '';
  if (d.defaultExecutor === 'remote' && !remoteSelectable && localSelectable) {
    return { ...d, defaultExecutor: 'local' };
  }
  if (d.defaultExecutor === 'local' && !localSelectable && remoteSelectable) {
    return { ...d, defaultExecutor: 'remote' };
  }
  return d;
}

function EnvBadge({ name }: { name: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      Managed by {name}
    </Badge>
  );
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'data' in err
    ? (err as { data?: { message?: string } }).data?.message || 'An error occurred'
    : 'An error occurred';
}

export function FfmpegExecutorSettings() {
  const { toast } = useToast();
  const { data: status, isLoading, error } = useGetFfmpegExecutorSettingsQuery();
  const [update, { isLoading: saving }] = useUpdateFfmpegExecutorSettingsMutation();
  const [testConnection, { isLoading: testing }] = useTestFfmpegExecutorConnectionMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [replacingKey, setReplacingKey] = useState(false);
  const [testResult, setTestResult] = useState<FfmpegExecutorTestResult | null>(null);

  useEffect(() => {
    if (status) {
      setDraft(toDraft(status));
      setReplacingKey(false);
    }
  }, [status]);

  const changes = useMemo(() => (status && draft ? diff(status, draft) : {}), [status, draft]);
  const dirty = Object.keys(changes).length > 0;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load executor settings.</AlertDescription>
      </Alert>
    );
  }
  if (isLoading || !draft || !status) return <Skeleton className="h-40 w-full" />;

  const set = (patch: Partial<Draft>) => {
    // A test result describes the draft it was run against — any edit to the
    // connection fields makes it stale.
    if ('remoteUrl' in patch || 'remoteAuth' in patch || 'saKeyJson' in patch) setTestResult(null);
    setDraft((d) =>
      d
        ? withSelectableDefault(
            { ...d, ...patch },
            status.localAvailable,
            status.envManaged.defaultExecutor,
          )
        : d,
    );
  };
  const localSelectable = draft.localEnabled && status.localAvailable;
  const remoteSelectable = draft.remoteEnabled && draft.remoteUrl.trim() !== '';
  const showKeyEditor = !status.hasSaKey || replacingKey;

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
      const res = await testConnection({
        remoteUrl: draft.remoteUrl.trim() || null,
        remoteAuth: draft.remoteAuth,
        ...(draft.removeKey
          ? { saKeyJson: null }
          : draft.saKeyJson.trim()
            ? { saKeyJson: draft.saKeyJson.trim() }
            : {}),
      }).unwrap();
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
        {/* An env-pinned Worker URL forces Remote on server-side (resolveWith), so
            the switch is read-only rather than a toggle that snaps back. */}
        <Switch
          id="ffmpeg-remote"
          aria-label="Remote"
          checked={draft.remoteEnabled}
          disabled={!status.storagePresignable || status.envManaged.remoteUrl}
          onCheckedChange={(v) => set({ remoteEnabled: v })}
        />
      </div>

      {draft.remoteEnabled && (
        <div className="ml-7 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="ffmpeg-remote-url" className="text-xs">
                Worker URL
              </Label>
              {status.envManaged.remoteUrl && <EnvBadge name="FFMPEG_REMOTE_URL" />}
            </div>
            <Input
              id="ffmpeg-remote-url"
              placeholder="https://bffless-ffmpeg-xxxx-uc.a.run.app"
              value={draft.remoteUrl}
              disabled={status.envManaged.remoteUrl}
              onChange={(e) => set({ remoteUrl: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Auth</Label>
              {status.envManaged.remoteAuth && <EnvBadge name="FFMPEG_REMOTE_AUTH" />}
            </div>
            <RadioGroup
              value={draft.remoteAuth}
              disabled={status.envManaged.remoteAuth}
              onValueChange={(v) => set({ remoteAuth: v as FfmpegRemoteAuth })}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ffmpeg-auth-idtoken" value="google_id_token" />
                <Label htmlFor="ffmpeg-auth-idtoken" className="text-xs font-normal">
                  Google ID token (Cloud Run IAM)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ffmpeg-auth-none" value="none" />
                <Label htmlFor="ffmpeg-auth-none" className="text-xs font-normal">
                  None (private network only)
                </Label>
              </div>
            </RadioGroup>
            {draft.remoteAuth === 'none' && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  No authentication: anyone who can reach the Worker URL can run jobs on it. Only
                  use on a private network (docker compose profile, VPC).
                </AlertDescription>
              </Alert>
            )}
          </div>

          {draft.remoteAuth === 'google_id_token' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="ffmpeg-sa-key" className="text-xs">
                  Service-account key (JSON)
                </Label>
                {status.envManaged.saKey && <EnvBadge name="FFMPEG_REMOTE_SA_KEY_JSON" />}
                {status.hasSaKey && !status.envManaged.saKey && (
                  <Badge variant="outline" className="text-[10px]">
                    Key stored
                  </Badge>
                )}
              </div>
              {status.envManaged.saKey ? (
                <p className="text-xs text-muted-foreground">
                  Provided by the environment; not editable here.
                </p>
              ) : showKeyEditor ? (
                <>
                  <Textarea
                    id="ffmpeg-sa-key"
                    rows={4}
                    placeholder='{"type": "service_account", ...}'
                    className="font-mono text-xs"
                    value={draft.saKeyJson}
                    onChange={(e) => set({ saKeyJson: e.target.value, removeKey: false })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Leave empty to use Application Default Credentials (works when CE
                    itself runs on GCP). The key is stored encrypted and never shown again.
                  </p>
                  {replacingKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReplacingKey(false);
                        set({ saKeyJson: '' });
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReplacingKey(true);
                      set({ removeKey: false });
                    }}
                  >
                    Replace key
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set({ removeKey: !draft.removeKey, saKeyJson: '' })}
                  >
                    {draft.removeKey ? 'Keep key' : 'Remove key'}
                  </Button>
                  {draft.removeKey && (
                    <span className="text-xs text-destructive">
                      Key will be removed on save (ADC will be used).
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onTest}
              disabled={testing || !draft.remoteUrl.trim()}
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
                <div className={testResult.readiness.ok ? 'text-muted-foreground' : 'text-destructive'}>
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
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save executor settings'}
        </Button>
      </div>
    </div>
  );
}
