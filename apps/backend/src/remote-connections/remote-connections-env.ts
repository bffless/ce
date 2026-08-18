import { nameFromEnv, type RemoteConnectionAuth } from './remote-connections.types';

/** Fields an env var can pin. `credential: null` / `healthPath: null` are explicit "none". */
export interface EnvConnectionFields {
  url?: string;
  auth?: RemoteConnectionAuth;
  credential?: string | null;
  maxInflight?: number;
  healthPath?: string | null;
}

const FIELD_RE = /^REMOTE_CONNECTION_(.+)_(URL|AUTH|CREDENTIAL_JSON|MAX_INFLIGHT|HEALTH_PATH)$/;
/** Legacy Plan-1/2 names → (connection, field). Explicit REMOTE_CONNECTION_FFMPEG_* wins. */
const LEGACY: Record<string, keyof EnvConnectionFields> = {
  FFMPEG_REMOTE_URL: 'url',
  FFMPEG_REMOTE_AUTH: 'auth',
  FFMPEG_REMOTE_SA_KEY_JSON: 'credential',
  FFMPEG_REMOTE_MAX_INFLIGHT: 'maxInflight',
};

function str(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  return t === '' ? null : t;
}
function url(raw: string | undefined): string | null {
  const s = str(raw);
  return s === null ? null : s.endsWith('/') ? s.slice(0, -1) : s;
}

function apply(
  target: EnvConnectionFields,
  field: keyof EnvConnectionFields,
  raw: string | undefined,
) {
  switch (field) {
    case 'url': {
      const v = url(raw);
      if (v) target.url = v;
      break;
    }
    case 'auth': {
      const v = str(raw);
      if (v === 'google_id_token' || v === 'none') target.auth = v;
      break;
    }
    case 'credential': {
      const v = str(raw);
      if (v) target.credential = v;
      break;
    }
    case 'maxInflight': {
      const v = str(raw);
      const n = v === null ? NaN : Number(v);
      if (Number.isFinite(n) && n > 0) target.maxInflight = Math.floor(n);
      break;
    }
    case 'healthPath': {
      const v = str(raw);
      if (v === 'none') target.healthPath = null;
      else if (v) target.healthPath = v.startsWith('/') ? v : `/${v}`;
      break;
    }
  }
}

const FIELD_BY_SUFFIX: Record<string, keyof EnvConnectionFields> = {
  URL: 'url',
  AUTH: 'auth',
  CREDENTIAL_JSON: 'credential',
  MAX_INFLIGHT: 'maxInflight',
  HEALTH_PATH: 'healthPath',
};

/** Every env-pinned connection field, keyed by connection name. Legacy aliases first so explicit vars overwrite. */
export function readRemoteConnectionsEnv(
  env: NodeJS.ProcessEnv = process.env,
): Map<string, EnvConnectionFields> {
  const out = new Map<string, EnvConnectionFields>();
  const get = (name: string) => {
    let f = out.get(name);
    if (!f) {
      f = {};
      out.set(name, f);
    }
    return f;
  };
  for (const [key, field] of Object.entries(LEGACY)) apply(get('ffmpeg'), field, env[key]);
  for (const key of Object.keys(env)) {
    const m = FIELD_RE.exec(key);
    if (!m) continue;
    apply(get(nameFromEnv(m[1])), FIELD_BY_SUFFIX[m[2]], env[key]);
  }
  for (const [name, f] of out) if (Object.keys(f).length === 0) out.delete(name);
  return out;
}
