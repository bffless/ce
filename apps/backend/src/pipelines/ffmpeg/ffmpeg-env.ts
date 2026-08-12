import * as os from 'os';
import * as path from 'path';

export interface FfmpegEnvConfig {
  memoryMb: number;
  threads: number;
  queueMax: number;
  maxSeconds: number;
  scratchDir: string;
}

/** '' counts as unset — compose passthrough materializes unconfigured vars as empty strings. */
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readFfmpegEnv(env: NodeJS.ProcessEnv = process.env): FfmpegEnvConfig {
  return {
    memoryMb: num(env.FFMPEG_MEMORY_MB, 1024),
    threads: num(env.FFMPEG_THREADS, Math.max(1, os.cpus().length - 1)),
    queueMax: num(env.FFMPEG_QUEUE_MAX, 8),
    maxSeconds: num(env.FFMPEG_MAX_SECONDS, 1800),
    scratchDir:
      env.FFMPEG_SCRATCH_DIR && env.FFMPEG_SCRATCH_DIR !== ''
        ? env.FFMPEG_SCRATCH_DIR
        : path.join(os.tmpdir(), 'bffless-ffmpeg'),
  };
}
