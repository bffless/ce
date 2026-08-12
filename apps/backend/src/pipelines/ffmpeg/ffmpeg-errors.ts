/** Typed failures the handler maps 1:1 onto StepResult error codes. */
export class FfmpegInsufficientDiskError extends Error {
  readonly code = 'FFMPEG_INSUFFICIENT_DISK';
}
