/**
 * The HTTP transport every remote connection shares: one request method, one
 * health probe, and the one retry policy CE is allowed to have.
 *
 * A remote call is NOT assumed idempotent (the ffmpeg Worker re-encodes and
 * re-uploads), so this client only ever retries a request the remote
 * demonstrably never started — a fetch that threw before any response byte, or
 * an explicit "come back later" (429 / 503, which on Cloud Run is the front end,
 * not the container). Every other non-2xx is NOT an error here: `request()`
 * resolves with `ok: false` and the caller decides what that status means.
 * Anything the caller aborted is never retried and is rethrown untouched.
 *
 * The transport is undici's `fetch` with header/body timeouts disabled: a job POST
 * stays open for the WHOLE job (see JOB_AGENT_OPTIONS). `probe()` shares it but
 * bounds itself with its own 5 s AbortController.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §2.4.
 */

import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { IdTokenMinter, NoAuth, type AuthHeaderProvider } from './auth/id-token';
import { RemoteResponseTooLargeError, RemoteUnavailableError } from './remote-errors';

/** Pause between the single retry attempt. */
const RETRY_DELAY_MS = 500;
/**
 * The ffmpeg Worker answers a job POST only when the job is DONE — it sends no
 * header until then — so the transport must not police the wait. undici (which is
 * what Node's global `fetch` is) defaults `headersTimeout`/`bodyTimeout` to 300 s,
 * and a job over five minutes therefore died with UND_ERR_HEADERS_TIMEOUT and was
 * retried once. 0 disables both; the bound on a call is CE's own step deadline
 * (`opts.signal`) plus the remote's own job-wide limit, never a socket timer.
 */
export const JOB_AGENT_OPTIONS = { headersTimeout: 0, bodyTimeout: 0 } as const;
const HEALTH_TIMEOUT_MS = 5_000;
/** Statuses that mean "the remote never took this request" — the only retryable ones. */
export const RETRYABLE_STATUSES = new Set([429, 503]);
/** Default cap on a response CE will buffer (a remote answers with JSON, not a file). */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** The remote could not be talked to, or answered a retryable status twice. */
export class RemoteTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RemoteTransportError';
  }
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

/** Bodies of failed responses are surfaced in the error message; keep them log-sized. */
async function errorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Reads a response body under a byte cap: `content-length` is trusted to refuse
 * early, and the decoded text is re-checked because a chunked response declares
 * no length. JSON is parsed when the remote says so; an unparsable "JSON" body is
 * handed back as raw text rather than thrown, so the caller sees what arrived.
 */
async function readBody(res: Response, maxResponseBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    throw new RemoteResponseTooLargeError(
      `response is ${declared} bytes, over the ${maxResponseBytes} byte limit`,
    );
  }
  const text = await res.text();
  if (Buffer.byteLength(text) > maxResponseBytes) {
    throw new RemoteResponseTooLargeError(
      `response is ${Buffer.byteLength(text)} bytes, over the ${maxResponseBytes} byte limit`,
    );
  }
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * The default transport: undici's own `fetch` pinned to a no-timeout Agent.
 * Both seams exist for tests — production always calls this with no arguments.
 */
export function createJobFetch(
  underlying: typeof undiciFetch = undiciFetch,
  makeDispatcher: () => Dispatcher = () => new Agent(JOB_AGENT_OPTIONS),
): typeof fetch {
  const dispatcher = makeDispatcher();
  return ((input: unknown, init: Record<string, unknown> = {}) =>
    underlying(input as never, { ...init, dispatcher } as never)) as unknown as typeof fetch;
}

/** One Agent (and its connection pool) for the whole process, built on first use. */
let sharedJobFetch: typeof fetch | undefined;
export function jobFetch(): typeof fetch {
  return (sharedJobFetch ??= createJobFetch());
}

export interface RemoteRequestOpts {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  maxResponseBytes?: number;
  /** Default true. False for a call the caller knows must not be repeated. */
  retry?: boolean;
}

export interface RemoteResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: unknown;
  attempts: 1 | 2;
}

export interface RemoteProbeResult {
  status: number;
  ok: boolean;
  body: unknown;
  latencyMs: number;
}

export class RemoteClient {
  constructor(
    protected readonly baseUrl: string,
    protected readonly auth: AuthHeaderProvider,
    protected readonly fetchImpl: typeof fetch = jobFetch(),
    protected readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /**
   * One request to the remote. Resolves for ANY status the remote answered with —
   * deciding what a 404 or a 422 means is the caller's job. It throws only when
   * there is no answer to hand back: a transport fault, a 429/503 that survived
   * the retry (RemoteTransportError, `retryable: true`), or a body over the cap
   * (RemoteResponseTooLargeError). The caller's AbortError is rethrown as-is.
   */
  async request(opts: RemoteRequestOpts): Promise<RemoteResponse> {
    const url = `${this.baseUrl}${opts.path}`;
    for (let attempt = 0; ; attempt++) {
      const canRetry = opts.retry !== false && attempt === 0 && !opts.signal.aborted;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: opts.method,
          // Auth is applied last on purpose: a caller can add headers but can
          // never override the Authorization the connection is configured with.
          headers: {
            ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...opts.headers,
            ...(await this.auth.headers(url)),
          },
          ...(opts.body !== undefined ? { body: opts.body } : {}),
          signal: opts.signal,
        });
      } catch (error) {
        // An abort is the caller's decision, not a transport fault: hand it back as-is.
        if (isAbort(error) || opts.signal.aborted) throw error;
        if (canRetry) {
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new RemoteTransportError(`request to ${url} failed: ${message}`, undefined, true);
      }

      if (RETRYABLE_STATUSES.has(res.status)) {
        if (canRetry) {
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        // Still "come back later" after the retry: there is no answer to return.
        throw new RemoteTransportError(
          `remote responded ${res.status}: ${await errorBody(res)}`,
          res.status,
          true,
        );
      }

      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        body: await readBody(res, opts.maxResponseBytes),
        attempts: (attempt + 1) as 1 | 2,
      };
    }
  }

  /**
   * Liveness, for readiness and the settings "Test connection" button. Never
   * retried, always bounded by its own timeout, and it does NOT judge the body —
   * the caller knows what shape its remote answers with.
   */
  async probe(
    opts: { path?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<RemoteProbeResult> {
    // The ffmpeg default is `/health`, NOT `/healthz`: on Cloud Run's *.run.app
    // domain Google's front door intercepts the literal `/healthz` with an HTML 404
    // before the request reaches the service, so a `/healthz` probe would report
    // every Cloud Run worker as unreachable.
    const url = `${this.baseUrl}${opts.path ?? '/health'}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? HEALTH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const startedAt = Date.now();
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: await this.auth.headers(url),
        signal: controller.signal,
      });
      const body = await readBody(res);
      return { status: res.status, ok: res.ok, body, latencyMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof RemoteTransportError || error instanceof RemoteResponseTooLargeError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new RemoteTransportError(`health request to ${url} failed: ${message}`);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * The auth mode a connection stores → the provider that signs its requests.
 * An unknown mode is a misconfigured connection, not a transport failure, so it
 * surfaces as RemoteUnavailableError (the same shape a caller already handles).
 */
export function authProviderFor(auth: string, credential: string | null): AuthHeaderProvider {
  switch (auth) {
    case 'none':
      return new NoAuth();
    case 'google_id_token':
      return new IdTokenMinter(credential);
    default:
      throw new RemoteUnavailableError(`unsupported remote connection auth mode '${auth}'`);
  }
}
