// Pieces shared by the Remote connections card and (from Plan 4 on) the ffmpeg
// executor panel: the "managed by <env var>" badge, the env-var naming rules,
// the RTK error unwrapper, and the "Test connection" result line.
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { RemoteConnectionTestResult } from '@/services/settingsApi';

/** The editable fields of a connection, in the order the form renders them. */
export type ConnectionField = 'url' | 'auth' | 'credential' | 'maxInflight' | 'healthPath';

const ENV_SUFFIX: Record<ConnectionField, string> = {
  url: 'URL',
  auth: 'AUTH',
  credential: 'CREDENTIAL_JSON',
  maxInflight: 'MAX_INFLIGHT',
  healthPath: 'HEALTH_PATH',
};

/** Plan-1/2 aliases that still pin the `ffmpeg` connection — named so an admin can find them. */
const LEGACY_FFMPEG_VAR: Partial<Record<ConnectionField, string>> = {
  url: 'FFMPEG_REMOTE_URL',
  auth: 'FFMPEG_REMOTE_AUTH',
  credential: 'FFMPEG_REMOTE_SA_KEY_JSON',
  maxInflight: 'FFMPEG_REMOTE_MAX_INFLIGHT',
};

/** `pdf-renderer` + `url` → `REMOTE_CONNECTION_PDF_RENDERER_URL` (mirrors envNameFor server-side). */
export function envVarFor(connectionName: string, field: ConnectionField): string {
  const envName = connectionName.toUpperCase().replace(/-/g, '_');
  const primary = `REMOTE_CONNECTION_${envName}_${ENV_SUFFIX[field]}`;
  const legacy = connectionName === 'ffmpeg' ? LEGACY_FFMPEG_VAR[field] : undefined;
  return legacy ? `${primary} (or ${legacy})` : primary;
}

export function EnvBadge({ name }: { name: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      Managed by {name}
    </Badge>
  );
}

/** Hosts are what an admin recognises; the scheme and path are noise in a summary. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The wire carries a free string — an instance can run an auth mode this build doesn't know. */
export function authLabel(auth: string): string {
  if (auth === 'google_id_token') return 'Google ID token';
  if (auth === 'none') return 'None';
  return auth;
}

export function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'data' in err
    ? (err as { data?: { message?: string } }).data?.message || 'An error occurred'
    : 'An error occurred';
}

/** `200 · 42 ms · v1.2.3`, the error on its own line, and what identity was used. */
export function TestResultLine({ result }: { result: RemoteConnectionTestResult }) {
  const facts = [
    result.status !== null ? String(result.status) : null,
    result.latencyMs !== null ? `${result.latencyMs} ms` : null,
    result.version ? `v${result.version}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        {result.ok ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        )}
        {facts.length > 0 && <span>{facts.join(' · ')}</span>}
        {/* A reachable service can still report an error (a bad key, a 503). */}
        {result.error && <span className="text-destructive">{result.error}</span>}
        {facts.length === 0 && !result.error && <span>No response.</span>}
      </div>
      <div className="text-muted-foreground">
        {result.credential === 'adc' &&
          'Using Application Default Credentials (no key stored) — this works when CE runs on GCP; elsewhere paste a service-account key.'}
        {result.credential === 'sa_key' && 'Using the stored service-account key.'}
        {result.credential === 'none' && 'No auth.'}
      </div>
    </div>
  );
}
