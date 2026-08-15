/** Typed failures the handler maps 1:1 onto StepResult error codes. */
export class FfmpegBusyError extends Error {
  readonly code = 'FFMPEG_BUSY';
}
export class FfmpegInsufficientMemoryError extends Error {
  readonly code = 'FFMPEG_INSUFFICIENT_MEMORY';
}
export class FfmpegInsufficientDiskError extends Error {
  readonly code = 'FFMPEG_INSUFFICIENT_DISK';
}
export class FfmpegTimeoutError extends Error {
  readonly code = 'FFMPEG_TIMEOUT';
}
/**
 * A whole step (queue wait + storage transfers + ffmpeg) blew its ceiling —
 * distinct from FFMPEG_TIMEOUT, which is the watchdog killing the process.
 * Its job is to make a wedged async job FAIL rather than hang silently: the
 * step settles, the pipeline's follow-up steps run, and the job row a client
 * is polling flips to error instead of staying 'running' forever (#669).
 */
export class FfmpegStepTimeoutError extends Error {
  readonly code = 'FFMPEG_JOB_TIMEOUT';
}
export class FfmpegProcessError extends Error {
  readonly code = 'FFMPEG_FAILED';
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(message);
  }
}
