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
