/**
 * The ffmpeg half of the remote transport: POST /jobs, GET /health, and the
 * WorkerResponse/WorkerHealth shape checks that turn a generic HTTP answer into
 * something the executor can trust.
 *
 * Everything below the shapes — the single retry policy, the no-timeout undici
 * Agent, the abort handling — lives in the shared `RemoteClient` this extends,
 * so `remote_request` and the ffmpeg executor cannot drift apart. `RemoteClient`
 * resolves for any status; the "a non-2xx is fatal for a job" rule is ffmpeg's
 * own, and is applied here.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §2.4.
 */

import {
  RemoteClient,
  RETRYABLE_STATUSES,
  RemoteTransportError as WorkerTransportError,
} from '../../../../remote-connections/remote-client';
import type { WorkerEnvelope, WorkerHealth, WorkerResponse } from './envelope';
import { isWorkerResponse } from './result-mapping';

export {
  RemoteTransportError as WorkerTransportError,
  JOB_AGENT_OPTIONS,
  createJobFetch,
  jobFetch,
} from '../../../../remote-connections/remote-client';

/** Failed-response bodies are surfaced in the error message; keep them log-sized. */
function snippet(body: unknown): string {
  return (typeof body === 'string' ? body : (JSON.stringify(body) ?? '')).slice(0, 500);
}

export class WorkerClient extends RemoteClient {
  /**
   * Runs the job on the Worker. Non-2xx → WorkerTransportError (status), 2xx that
   * is not a WorkerResponse → WorkerTransportError (a broken worker, or something
   * else answering on that URL, is never a silent success). The caller's
   * AbortError comes back untouched.
   */
  async postJob(envelope: WorkerEnvelope, opts: { signal: AbortSignal }): Promise<WorkerResponse> {
    const res = await this.request({
      path: '/jobs',
      method: 'POST',
      body: JSON.stringify(envelope),
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new WorkerTransportError(
        `worker responded ${res.status}: ${snippet(res.body)}`,
        res.status,
        RETRYABLE_STATUSES.has(res.status),
      );
    }
    if (!isWorkerResponse(res.body)) {
      throw new WorkerTransportError('worker response was not a WorkerResponse', res.status);
    }
    return res.body;
  }

  /** Liveness + version, for readiness and the settings "Test connection" button. Never retried. */
  async health(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<WorkerHealth> {
    const res = await this.probe({ path: '/health', ...opts });
    if (!res.ok) {
      throw new WorkerTransportError(
        `worker health responded ${res.status}: ${snippet(res.body)}`,
        res.status,
        RETRYABLE_STATUSES.has(res.status),
      );
    }
    const body = res.body as WorkerHealth;
    if (typeof body?.ok !== 'boolean' || typeof body?.version !== 'string') {
      throw new WorkerTransportError('worker health response was not a WorkerHealth', res.status);
    }
    return body;
  }
}
