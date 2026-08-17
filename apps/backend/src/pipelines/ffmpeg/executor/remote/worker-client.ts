/**
 * The HTTP half of the remote executor: POST /jobs, GET /healthz, and the one
 * retry policy CE is allowed to have.
 *
 * A remote ffmpeg job is NOT idempotent (it re-encodes and re-uploads), so this
 * client only ever retries a request the Worker demonstrably never started —
 * a fetch that threw before any response byte, or an explicit "come back later"
 * (429 / 503, which on Cloud Run is the front end, not the container). Every
 * other non-2xx is final. Anything the caller aborted is never retried.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §2.4.
 */

import type { WorkerEnvelope, WorkerHealth, WorkerResponse } from './envelope';
import type { AuthHeaderProvider } from './id-token';
import { isWorkerResponse } from './result-mapping';

/** Pause between the single retry attempt. */
const RETRY_DELAY_MS = 500;
const HEALTH_TIMEOUT_MS = 5_000;
/** Statuses that mean "the Worker never took this job" — the only retryable ones. */
const RETRYABLE_STATUSES = new Set([429, 503]);

/** The Worker could not be talked to, or answered something that is not a WorkerResponse. */
export class WorkerTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'WorkerTransportError';
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

export class WorkerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthHeaderProvider,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Runs the job on the Worker. Throws WorkerTransportError, or the caller's AbortError untouched. */
  async postJob(envelope: WorkerEnvelope, opts: { signal: AbortSignal }): Promise<WorkerResponse> {
    const url = `${this.baseUrl}/jobs`;
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt === 0 && !opts.signal.aborted;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await this.auth.headers(url)) },
          body: JSON.stringify(envelope),
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
        throw new WorkerTransportError(`request to ${url} failed: ${message}`, undefined, true);
      }

      if (!res.ok) {
        const retryable = RETRYABLE_STATUSES.has(res.status);
        if (retryable && canRetry) {
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new WorkerTransportError(
          `worker responded ${res.status}: ${await errorBody(res)}`,
          res.status,
          retryable,
        );
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorkerTransportError(`worker response was not JSON: ${message}`, res.status);
      }
      // A 2xx that is not a WorkerResponse is a broken worker (or something else
      // answering on that URL) — never a silent success.
      if (!isWorkerResponse(body)) {
        throw new WorkerTransportError('worker response was not a WorkerResponse', res.status);
      }
      return body;
    }
  }

  /** Liveness + version, for readiness and the settings "Test connection" button. Never retried. */
  async health(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<WorkerHealth> {
    const url = `${this.baseUrl}/healthz`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? HEALTH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: await this.auth.headers(url),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new WorkerTransportError(
          `worker healthz responded ${res.status}: ${await errorBody(res)}`,
          res.status,
          RETRYABLE_STATUSES.has(res.status),
        );
      }
      const body = (await res.json()) as WorkerHealth;
      if (typeof body?.ok !== 'boolean' || typeof body?.version !== 'string') {
        throw new WorkerTransportError(
          'worker healthz response was not a WorkerHealth',
          res.status,
        );
      }
      return body;
    } catch (error) {
      if (error instanceof WorkerTransportError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkerTransportError(`healthz request to ${url} failed: ${message}`);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}
