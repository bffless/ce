// The Add/Edit form for one remote connection, plus the draft ⇄ DTO helpers.
//
// Two rules drive the DTO helpers:
//  - the API is a PARTIAL update that REFUSES any env-pinned field PRESENT in
//    the body, so an edit must send only the fields that actually changed, and
//    never a field the environment pins;
//  - the credential is write-only: undefined = keep, null = clear, string = replace.
import {
  type RemoteConnectionAuth,
  type RemoteConnectionStatus,
  type RemoteConnectionTestDraft,
  type RemoteConnectionTestResult,
  type UpsertRemoteConnectionDto,
} from '@/services/settingsApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { WriteOnlySecretField } from './WriteOnlySecretField';
import { EnvBadge, TestResultLine, envVarFor } from './shared';

export interface ConnectionDraft {
  name: string;
  url: string;
  auth: RemoteConnectionAuth;
  /** Pasted credential; '' = nothing to send. */
  credential: string;
  /** "Remove key" clicked → send credential: null on save. */
  removeCredential: boolean;
  maxInflight: number;
  /** '' = no probe (sent as null). */
  healthPath: string;
}

const DEFAULT_MAX_INFLIGHT = 8;
const DEFAULT_HEALTH_PATH = '/health';
const MAX_INFLIGHT_CEILING = 64;
/** Mirrors CONNECTION_NAME_RE server-side. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidConnectionName(name: string): boolean {
  return NAME_RE.test(name.trim());
}

export function toConnectionDraft(c?: RemoteConnectionStatus): ConnectionDraft {
  return {
    name: c?.name ?? '',
    url: c?.url ?? '',
    auth: (c?.auth as RemoteConnectionAuth) ?? 'google_id_token',
    credential: '',
    removeCredential: false,
    maxInflight: c?.maxInflight ?? DEFAULT_MAX_INFLIGHT,
    healthPath: c ? (c.healthPath ?? '') : DEFAULT_HEALTH_PATH,
  };
}

/** '' = "no probe" → null, and anything else keeps its text (the server roots it at '/'). */
function healthPathOf(d: ConnectionDraft): string | null {
  return d.healthPath.trim() === '' ? null : d.healthPath.trim();
}

/** undefined = keep, null = clear, string = replace. */
function credentialOf(d: ConnectionDraft): string | null | undefined {
  if (d.removeCredential) return null;
  return d.credential.trim() ? d.credential.trim() : undefined;
}

/** Everything for a create; only what changed (and is not env-pinned) for an edit. */
export function toUpsertDto(
  existing: RemoteConnectionStatus | undefined,
  d: ConnectionDraft,
): UpsertRemoteConnectionDto {
  const credential = credentialOf(d);
  if (!existing) {
    return {
      name: d.name.trim(),
      url: d.url.trim(),
      auth: d.auth,
      ...(credential === undefined ? {} : { credential }),
      maxInflight: d.maxInflight,
      healthPath: healthPathOf(d),
    };
  }
  const out: UpsertRemoteConnectionDto = {};
  const fromEnv = existing.source;
  if (d.name.trim() !== existing.name) out.name = d.name.trim();
  if (fromEnv.url !== 'env' && d.url.trim() !== existing.url) out.url = d.url.trim();
  if (fromEnv.auth !== 'env' && d.auth !== existing.auth) out.auth = d.auth;
  if (fromEnv.credential !== 'env' && credential !== undefined) out.credential = credential;
  if (fromEnv.maxInflight !== 'env' && d.maxInflight !== existing.maxInflight) {
    out.maxInflight = d.maxInflight;
  }
  if (fromEnv.healthPath !== 'env' && healthPathOf(d) !== existing.healthPath) {
    out.healthPath = healthPathOf(d);
  }
  return out;
}

/**
 * What "Test connection" runs against. The credential is only sent when the
 * admin actually typed (or cleared) one — otherwise the server falls back to
 * the stored one via `id`.
 */
export function toTestDraft(
  existing: RemoteConnectionStatus | undefined,
  d: ConnectionDraft,
): RemoteConnectionTestDraft {
  const credential = credentialOf(d);
  return {
    ...(existing?.id ? { id: existing.id } : {}),
    url: d.url.trim(),
    auth: d.auth,
    ...(credential === undefined ? {} : { credential }),
    healthPath: healthPathOf(d),
  };
}

/** Client-side gate for the Save button; the server owns the rest of the rules. */
export function isDraftValid(d: ConnectionDraft): boolean {
  if (!isValidConnectionName(d.name)) return false;
  if (!d.url.trim()) return false;
  if (!Number.isInteger(d.maxInflight) || d.maxInflight < 1) return false;
  if (d.maxInflight > MAX_INFLIGHT_CEILING) return false;
  return true;
}

export interface RemoteConnectionFormProps {
  draft: ConnectionDraft;
  /** The saved connection being edited; absent when creating. */
  existing?: RemoteConnectionStatus;
  onChange: (d: ConnectionDraft) => void;
  onTest: () => void;
  testing: boolean;
  testResult: RemoteConnectionTestResult | null;
}

export function RemoteConnectionForm({
  draft,
  existing,
  onChange,
  onTest,
  testing,
  testResult,
}: RemoteConnectionFormProps) {
  const set = (patch: Partial<ConnectionDraft>) => onChange({ ...draft, ...patch });
  const pinned = (field: 'url' | 'auth' | 'credential' | 'maxInflight' | 'healthPath') =>
    existing?.source[field] === 'env';
  const envVar = (field: 'url' | 'auth' | 'credential' | 'maxInflight' | 'healthPath') =>
    envVarFor(existing?.name ?? draft.name, field);
  // Renaming is refused server-side while anything points at the old name, and
  // while the env vars (which are keyed BY NAME) pin any field on this row.
  const nameLocked =
    !!existing &&
    (existing.usedBy.ffmpegExecutor ||
      existing.usedBy.rules > 0 ||
      Object.values(existing.source).some((s) => s === 'env'));
  const nameInvalid = draft.name.trim() !== '' && !isValidConnectionName(draft.name);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="rc-name" className="text-xs">
          Name
        </Label>
        <Input
          id="rc-name"
          placeholder="pdf-renderer"
          value={draft.name}
          disabled={nameLocked}
          onChange={(e) => set({ name: e.target.value })}
        />
        <p className={`text-xs ${nameInvalid ? 'text-destructive' : 'text-muted-foreground'}`}>
          {nameLocked
            ? 'Locked: this name is referenced by the ffmpeg executor, by rules, or by environment variables.'
            : 'lower-case letters, digits and dashes; rules reference this name'}
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label htmlFor="rc-url" className="text-xs">
            URL
          </Label>
          {pinned('url') && <EnvBadge name={envVar('url')} />}
        </div>
        <Input
          id="rc-url"
          placeholder="https://my-service-xxxx-uc.a.run.app"
          value={draft.url}
          disabled={pinned('url')}
          onChange={(e) => set({ url: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Auth</Label>
          {pinned('auth') && <EnvBadge name={envVar('auth')} />}
        </div>
        <RadioGroup
          value={draft.auth}
          disabled={pinned('auth')}
          onValueChange={(v) => set({ auth: v as RemoteConnectionAuth })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="rc-auth-idtoken" value="google_id_token" />
            <Label htmlFor="rc-auth-idtoken" className="text-xs font-normal">
              Google ID token (Cloud Run IAM)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="rc-auth-none" value="none" />
            <Label htmlFor="rc-auth-none" className="text-xs font-normal">
              None (private network only)
            </Label>
          </div>
        </RadioGroup>
        {draft.auth === 'none' && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              No authentication: anyone who can reach this URL can call the service. Only use on a
              private network (docker compose profile, VPC).
            </AlertDescription>
          </Alert>
        )}
      </div>

      {draft.auth === 'google_id_token' && (
        <WriteOnlySecretField
          id="rc-credential"
          label="Service-account key (JSON)"
          stored={existing?.hasCredential ?? false}
          envManagedBy={pinned('credential') ? envVar('credential') : null}
          value={draft.credential}
          remove={draft.removeCredential}
          onChange={(patch) =>
            set({
              ...(patch.value === undefined ? {} : { credential: patch.value }),
              ...(patch.remove === undefined ? {} : { removeCredential: patch.remove }),
            })
          }
          placeholder='{"type": "service_account", ...}'
          help="Optional. Leave empty to use Application Default Credentials (works when CE itself runs on GCP). The key is stored encrypted and never shown again."
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="rc-max-inflight" className="text-xs">
              Max in-flight
            </Label>
            {pinned('maxInflight') && <EnvBadge name={envVar('maxInflight')} />}
          </div>
          <Input
            id="rc-max-inflight"
            type="number"
            min={1}
            max={MAX_INFLIGHT_CEILING}
            value={String(draft.maxInflight)}
            disabled={pinned('maxInflight')}
            onChange={(e) => set({ maxInflight: Number.parseInt(e.target.value, 10) || 0 })}
          />
          <p className="text-xs text-muted-foreground">
            1–{MAX_INFLIGHT_CEILING} concurrent calls to this connection.
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="rc-health-path" className="text-xs">
              Health path
            </Label>
            {pinned('healthPath') && <EnvBadge name={envVar('healthPath')} />}
          </div>
          <Input
            id="rc-health-path"
            placeholder="/health"
            value={draft.healthPath}
            disabled={pinned('healthPath')}
            onChange={(e) => set({ healthPath: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">empty = no probe</p>
        </div>
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={testing || !draft.url.trim()}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {testResult && <TestResultLine result={testResult} />}
      </div>
    </div>
  );
}
