import * as os from 'os';
import * as path from 'path';

export interface FfmpegEnvConfig {
  memoryMb: number;
  threads: number;
  queueMax: number;
  maxSeconds: number;
  /**
   * Ceiling for a whole handler step — queue wait, storage transfers and the
   * ffmpeg run together — not just the spawned process (that's `maxSeconds`).
   * Defaults to 2x the process watchdog so it can only ever fire on work the
   * watchdog does not cover. Doubles as the queue-wait ceiling and as the
   * "this slot holder is gone" threshold in FfmpegRunnerService.
   */
  jobMaxSeconds: number;
  /** Ceiling for a single storage call (metadata, download, upload). */
  ioMaxSeconds: number;
  scratchDir: string;
}

/** '' counts as unset — compose passthrough materializes unconfigured vars as empty strings. */
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readFfmpegEnv(env: NodeJS.ProcessEnv = process.env): FfmpegEnvConfig {
  const maxSeconds = num(env.FFMPEG_MAX_SECONDS, 1800);
  return {
    memoryMb: num(env.FFMPEG_MEMORY_MB, 1024),
    threads: num(env.FFMPEG_THREADS, Math.max(1, os.cpus().length - 1)),
    queueMax: num(env.FFMPEG_QUEUE_MAX, 8),
    maxSeconds,
    jobMaxSeconds: num(env.FFMPEG_JOB_MAX_SECONDS, 2 * maxSeconds),
    ioMaxSeconds: num(env.FFMPEG_IO_MAX_SECONDS, 900),
    scratchDir:
      env.FFMPEG_SCRATCH_DIR && env.FFMPEG_SCRATCH_DIR !== ''
        ? env.FFMPEG_SCRATCH_DIR
        : path.join(os.tmpdir(), 'bffless-ffmpeg'),
  };
}
