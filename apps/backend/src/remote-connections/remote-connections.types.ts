export type RemoteConnectionAuth = 'google_id_token' | 'none';
export type FieldSource = 'db' | 'env';

/** Lower-case slug; `-` only (env names map `_`→`-`, so `_` would be ambiguous). */
export const CONNECTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function isValidConnectionName(name: unknown): name is string {
  return typeof name === 'string' && CONNECTION_NAME_RE.test(name);
}
/** `pdf-renderer` → `PDF_RENDERER` (the <NAME> segment of REMOTE_CONNECTION_<NAME>_URL). */
export function envNameFor(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}
/** `PDF_RENDERER` → `pdf-renderer`. */
export function nameFromEnv(envName: string): string {
  return envName.toLowerCase().replace(/_/g, '-');
}

/** The effective connection: DB row with env fields applied, credential decrypted (in memory only). */
export interface ResolvedConnection {
  /** null for an env-only connection (no DB row). */
  id: string | null;
  name: string;
  url: string;
  auth: RemoteConnectionAuth | string;
  credential: string | null;
  maxInflight: number;
  healthPath: string | null;
  source: {
    url: FieldSource;
    auth: FieldSource;
    credential: FieldSource | null;
    maxInflight: FieldSource;
    healthPath: FieldSource;
    envOnly: boolean;
  };
}
