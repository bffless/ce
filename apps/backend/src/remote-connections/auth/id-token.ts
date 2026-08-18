/**
 * Auth headers for a remote ffmpeg Worker request.
 *
 * The reference deployment is a private Cloud Run service, which authenticates
 * callers with a Google-signed **ID token** whose audience is the service URL —
 * so the header depends on the URL, not just on the credential. That is the whole
 * reason this is a provider interface rather than a static header bag.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §2.3.
 */

import { GoogleAuth } from 'google-auth-library';
import { RemoteUnavailableError } from '../remote-errors';

export interface AuthHeaderProvider {
  headers(url: string): Promise<Record<string, string>>;
}

/** `FFMPEG_REMOTE_AUTH=none` — a Worker on a trusted network, or a local dev worker. */
export class NoAuth implements AuthHeaderProvider {
  async headers(_url?: string): Promise<Record<string, string>> {
    return {};
  }
}

/** The narrow slice of google-auth-library this file uses, so it can be faked in tests. */
export interface IdTokenClientLike {
  getRequestHeaders(url?: string): Promise<Record<string, string> | Headers>;
}
export interface AuthLike {
  getIdTokenClient(audience: string): Promise<IdTokenClientLike>;
}

/**
 * A malformed credential reaches here from env (`REMOTE_CONNECTION_<NAME>_CREDENTIAL_JSON`
 * / legacy `FFMPEG_REMOTE_SA_KEY_JSON`) unguarded — the write paths validate JSON at
 * save time, but env is applied on every read. `JSON.parse` on bad input throws a
 * SyntaxError that QUOTES a prefix of the offending string, which would put private-key
 * bytes into a step error / pipeline response / log line. Never let that escape.
 */
export function defaultAuthFactory(saKeyJson: string | null): AuthLike {
  if (!saKeyJson) return new GoogleAuth({}) as unknown as AuthLike;
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(saKeyJson) as Record<string, unknown>;
  } catch {
    throw new RemoteUnavailableError('connection credential is not valid JSON');
  }
  return new GoogleAuth({ credentials }) as unknown as AuthLike;
}

function flatten(headers: Record<string, string> | Headers): Record<string, string> {
  // google-auth-library v9 returns a plain record; v10 returns a WHATWG Headers.
  if (headers instanceof Headers) {
    const flat: Record<string, string> = {};
    headers.forEach((value, key) => {
      flat[key] = value;
    });
    return flat;
  }
  return headers;
}

/**
 * Mints `Authorization: Bearer <Google ID token>` for the Worker.
 *
 * The audience is the URL's **origin** (Cloud Run signs tokens for the service
 * URL, not per-path), so `/jobs` and `/health` share one client. The client is
 * created lazily — a CE instance that never runs a remote job never touches ADC —
 * and cached per audience because `IdTokenClient` refreshes its own token ~5 min
 * before expiry; caching the *token* here would fight it.
 */
export class IdTokenMinter implements AuthHeaderProvider {
  private auth?: AuthLike;
  private readonly clients = new Map<string, Promise<IdTokenClientLike>>();

  /** @param saKeyJson raw service-account JSON, or null to fall back to ADC. */
  constructor(
    private readonly saKeyJson: string | null,
    private readonly authFactory: (saKeyJson: string | null) => AuthLike = defaultAuthFactory,
  ) {}

  async headers(url: string): Promise<Record<string, string>> {
    const audience = new URL(url).origin;
    let client = this.clients.get(audience);
    if (!client) {
      this.auth ??= this.authFactory(this.saKeyJson);
      client = this.auth.getIdTokenClient(audience);
      // Only a *successful* client is cached: ADC / metadata-server discovery can
      // fail transiently, and a cached rejected promise would rethrow that stale
      // error on every later job until the process restarts.
      client.catch(() => this.clients.delete(audience));
      this.clients.set(audience, client);
    }
    return flatten(await (await client).getRequestHeaders(url));
  }
}
