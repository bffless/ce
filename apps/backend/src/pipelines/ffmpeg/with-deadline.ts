import { FfmpegStepTimeoutError } from './ffmpeg-errors';

/**
 * Bound an await that has no timeout of its own. On breach the step fails
 * with FFMPEG_JOB_TIMEOUT naming the phase; the abandoned work is left to
 * settle on its own (its `finally` still cleans up, and orphaned scratch
 * dirs are swept hourly) — the point is that the STEP always settles.
 *
 * `onTimeout` fires once, just before the rejection, so the caller can signal
 * the abandoned work (a remote executor cancels its job; the local one has
 * nothing to cancel).
 */
export function withDeadline<T>(
  work: Promise<T>,
  seconds: number,
  phase: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // The abandoned work may reject later with nobody listening.
      work.catch(() => undefined);
      onTimeout?.();
      reject(
        new FfmpegStepTimeoutError(
          `ffmpeg_handler ${phase} exceeded ${seconds}s and was abandoned`,
        ),
      );
    }, seconds * 1000);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
