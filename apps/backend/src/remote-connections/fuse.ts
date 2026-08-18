import { RemoteBusyError } from './remote-errors';

/**
 * Per-connection in-flight ceiling (spec D5). One shared instance per process:
 * the ffmpeg remote executor and every remote_request step naming the same
 * connection draw from the same counter. Fail-fast, no queueing — the remote
 * service scales; the fuse only protects this process's sockets.
 */
export class InflightFuse {
  private readonly counts = new Map<string, number>();

  inflight(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  /** Throws RemoteBusyError at capacity; otherwise returns an idempotent release(). */
  acquire(name: string, max: number): () => void {
    const current = this.inflight(name);
    if (current >= max) {
      throw new RemoteBusyError(`connection '${name}' at capacity (${max} in flight)`);
    }
    this.counts.set(name, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.counts.set(name, Math.max(0, this.inflight(name) - 1));
    };
  }
}
