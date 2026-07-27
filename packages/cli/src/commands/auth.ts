/**
 * `bffless login` / `logout` / `auth status` / `auth token` — the paste-a-key
 * credential flow over api/credentials.ts.
 *
 * The API URL identifies WHICH instance to act on and resolves exactly like the
 * client's base URL: `--api-url` flag > `BFFLESS_API_URL` env > nearest
 * `.bffless/config.json`. So inside an app repo clone, `bffless login` /
 * `auth token` need no arguments at all.
 *
 * `login` validates the pasted key with a real call (`GET /api/projects` — cheap,
 * key-only) BEFORE storing: a typo'd key should fail at login time, not on the
 * first `rules push` a week later.
 */
import { findConfig } from '../config.js';
import { ApiClient, type FetchLike } from '../api/client.js';
import {
  credentialsPath,
  getStoredKey,
  normalizeApiUrl,
  readCredentialsFile,
  removeKey,
  storeKey,
} from '../api/credentials.js';

export interface AuthDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  /** Override the credential-store file path (tests). */
  credentialsFile?: string;
  /** Override the interactive secret prompt (tests). */
  promptSecret?: (question: string) => Promise<string>;
  /** Override instruction output (tests). Default: console.log. */
  log?: (message: string) => void;
}

export interface AuthStatusRow {
  apiUrl: string;
  keyPrefix: string;
  valid: boolean;
}

const API_URL_REMEDIATION =
  'pass --api-url, set BFFLESS_API_URL, or run from a repo with "apiUrl" in .bffless/config.json';

/** Same base-URL precedence as createClient: flag > env > config walk-up. */
function resolveApiUrl(
  opts: { apiUrl?: string },
  cwd: string,
  env: Record<string, string | undefined>,
): string | undefined {
  return opts.apiUrl ?? env.BFFLESS_API_URL ?? findConfig(cwd)?.config.apiUrl ?? undefined;
}

/** Read a secret from the terminal (masked) or from piped stdin (first line). */
export function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (c: Buffer) => chunks.push(c));
      process.stdin.on('end', () =>
        resolve(Buffer.concat(chunks).toString('utf8').split('\n')[0].trim()),
      );
      process.stdin.on('error', reject);
    });
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '') {
          // Ctrl-C
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export async function runLogin(
  opts: { apiUrl?: string },
  cwd: string,
  deps?: AuthDeps,
): Promise<{ ok: true; apiUrl: string } | { ok: false; error: string }> {
  const env = deps?.env ?? process.env;
  const log = deps?.log ?? console.log;
  const rawUrl = resolveApiUrl(opts, cwd, env);
  if (!rawUrl) return { ok: false, error: `no API URL configured — ${API_URL_REMEDIATION}` };

  let apiUrl: string;
  try {
    apiUrl = normalizeApiUrl(rawUrl);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  log(`Logging in to ${apiUrl}`);
  log(`Create an API key in the BFFless admin UI (${apiUrl} → Settings → API Keys), then paste it below.`);
  const key = (await (deps?.promptSecret ?? promptSecret)('API key: ')).trim();
  if (key.length === 0) return { ok: false, error: 'empty API key — nothing stored' };

  const client = new ApiClient({ apiUrl, apiKey: key, fetchImpl: deps?.fetchImpl });
  try {
    await client.get('/api/projects', 'project list');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `key validation failed — nothing stored.\n${msg}` };
  }

  storeKey(apiUrl, key, deps?.credentialsFile);
  return { ok: true, apiUrl };
}

export function runLogout(
  opts: { apiUrl?: string },
  cwd: string,
  deps?: AuthDeps,
): { ok: true; apiUrl: string; removed: boolean } | { ok: false; error: string } {
  const env = deps?.env ?? process.env;
  const rawUrl = resolveApiUrl(opts, cwd, env);
  if (!rawUrl) return { ok: false, error: `no API URL configured — ${API_URL_REMEDIATION}` };
  const apiUrl = normalizeApiUrl(rawUrl);
  return { ok: true, apiUrl, removed: removeKey(apiUrl, deps?.credentialsFile) };
}

export async function runAuthStatus(deps?: AuthDeps): Promise<AuthStatusRow[]> {
  const file = deps?.credentialsFile ?? credentialsPath(deps?.env ?? process.env);
  const store = readCredentialsFile(file);
  if (!store) return [];
  const rows: AuthStatusRow[] = [];
  for (const [apiUrl, entry] of Object.entries(store.credentials).sort(([a], [b]) => a.localeCompare(b))) {
    const client = new ApiClient({ apiUrl, apiKey: entry.apiKey, fetchImpl: deps?.fetchImpl });
    let valid = true;
    try {
      await client.get('/api/projects', 'project list');
    } catch {
      valid = false;
    }
    rows.push({ apiUrl, keyPrefix: `${entry.apiKey.slice(0, 8)}…`, valid });
  }
  return rows;
}

export function runAuthToken(
  opts: { apiUrl?: string },
  cwd: string,
  deps?: AuthDeps,
): { ok: true; token: string } | { ok: false; error: string } {
  const env = deps?.env ?? process.env;
  const rawUrl = resolveApiUrl(opts, cwd, env);
  if (!rawUrl) return { ok: false, error: `no API URL configured — ${API_URL_REMEDIATION}` };
  const apiUrl = normalizeApiUrl(rawUrl);
  const token = getStoredKey(apiUrl, deps?.credentialsFile);
  if (!token) {
    return {
      ok: false,
      error:
        `no stored credentials for ${apiUrl} — run \`bffless login\` once on this machine, ` +
        'or set BFFLESS_API_KEY',
    };
  }
  return { ok: true, token };
}
