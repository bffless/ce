/**
 * Minimal HTTP client for the BFFless backend API (Phase 1 live `pull`/`push`/`diff`).
 *
 * Base-URL resolution: `--api-url` flag > `BFFLESS_API_URL` env > `apiUrl` in the nearest
 * `.bffless/config.json`.
 *
 * API-key resolution: `--api-key` flag > `BFFLESS_API_KEY` env — and NOTHING else.
 * The key is deliberately never read from `.bffless/config.json`: that file is meant to be
 * committed to the repo (it carries `apiUrl`/`project`/`ruleSets` for the whole team), so
 * supporting a key there would invite committing credentials. Keys stay in flags/env only.
 *
 * Auth is the backend's `ApiKeyGuard`, which reads the `X-API-Key` request header.
 *
 * The "how to fix it" half of every config/auth error comes from `deps.remediation`, so an
 * embedder that has no flags (the deploy-proxy-rules Action) can name its own knobs instead
 * of the CLI's — see api/remediation.ts.
 *
 * `fetch` is injectable for tests. No retries — a CI drift check or deploy push should fail
 * fast and loudly rather than mask a flaky endpoint.
 */
import { findConfig, type BfflessConfig } from '../config.js';
import { resolveRemediation, type Remediation } from './remediation.js';

/** Error thrown for any failed request; `status` is 0 for network-level failures. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientFlags {
  apiUrl?: string;
  apiKey?: string;
}

export interface ClientDeps {
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
  /** Pre-loaded config (tests / callers that already ran `findConfig`); when absent the
   *  nearest `.bffless/config.json` above `cwd` is used. */
  config?: BfflessConfig | null;
  /** Override the "how to fix it" wording of config/auth errors. Unset fields keep the
   *  CLI's default phrasing — an embedder with no flags should override the ones its user
   *  can actually act on. */
  remediation?: Partial<Remediation>;
}

/** Extract a human-readable message from an error-response body (NestJS `message` field,
 *  which may be a string or an array of validation messages). */
function parseErrorDetail(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const parsed = JSON.parse(bodyText) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.map(String).join('; ');
  } catch {
    // Non-JSON body — fall through to a truncated raw snippet.
  }
  const trimmed = bodyText.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : undefined;
}

export class ApiClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly remediation: Remediation;

  constructor(init: {
    apiUrl: string;
    apiKey: string;
    fetchImpl?: FetchLike;
    remediation?: Partial<Remediation>;
  }) {
    this.base = init.apiUrl.replace(/\/+$/, '');
    this.apiKey = init.apiKey;
    this.fetchImpl = init.fetchImpl ?? ((url, opts) => fetch(url, opts));
    this.remediation = resolveRemediation(init.remediation);
  }

  /** Absolute URL for an API path (path must start with `/`). */
  url(apiPath: string): string {
    return this.base + apiPath;
  }

  /**
   * Perform a JSON request. `lookup` describes what a 404 means for this call so the error
   * says what was looked up (e.g. `rule set "studio" export`), not just the URL.
   */
  private async request<T>(
    method: string,
    apiPath: string,
    opts?: { body?: unknown; lookup?: string },
  ): Promise<T> {
    const url = this.url(apiPath);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          Accept: 'application/json',
          ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApiError(`request failed: ${method} ${url} — ${msg}`, 0, url);
    }

    if (!res.ok) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        // Ignore body-read failures; the status alone still makes a useful error.
      }
      const detail = parseErrorDetail(bodyText);
      const suffix = detail ? ` — ${detail}` : '';
      if (res.status === 401 || res.status === 403) {
        throw new ApiError(
          `HTTP ${res.status} ${method} ${url}: authentication failed${suffix}. ` +
            this.remediation.auth,
          res.status,
          url,
        );
      }
      if (res.status === 404) {
        throw new ApiError(
          `HTTP 404 ${method} ${url}: ${opts?.lookup ?? 'resource'} not found${suffix}`,
          res.status,
          url,
        );
      }
      throw new ApiError(`HTTP ${res.status} ${method} ${url}${suffix}`, res.status, url);
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApiError(`invalid JSON response from ${method} ${url} — ${msg}`, res.status, url);
    }
  }

  get<T>(apiPath: string, lookup?: string): Promise<T> {
    return this.request<T>('GET', apiPath, { lookup });
  }

  put<T>(apiPath: string, body: unknown, lookup?: string): Promise<T> {
    return this.request<T>('PUT', apiPath, { body, lookup });
  }

  post<T>(apiPath: string, body: unknown, lookup?: string): Promise<T> {
    return this.request<T>('POST', apiPath, { body, lookup });
  }
}

/**
 * Build a client from CLI flags + env + config, applying the documented precedence.
 * Throws a plain Error (caller prints it, no stack) naming every source that was tried.
 */
export function createClient(flags: ClientFlags, cwd: string, deps?: ClientDeps): ApiClient {
  const env = deps?.env ?? process.env;
  const config = deps?.config !== undefined ? deps.config : (findConfig(cwd)?.config ?? null);
  const remediation = resolveRemediation(deps?.remediation);

  const apiUrl = flags.apiUrl ?? env.BFFLESS_API_URL ?? config?.apiUrl;
  if (!apiUrl) {
    throw new Error(`no API URL configured — ${remediation.apiUrl}`);
  }

  // Key precedence is flag > env ONLY — never config.json (a committed file; see module doc).
  const apiKey = flags.apiKey ?? env.BFFLESS_API_KEY;
  if (!apiKey) {
    throw new Error(`no API key configured — ${remediation.apiKey}`);
  }

  return new ApiClient({ apiUrl, apiKey, fetchImpl: deps?.fetchImpl, remediation: deps?.remediation });
}
