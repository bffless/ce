import * as os from 'os';
import * as path from 'path';

export type FfmpegExecutorSetting = 'local' | 'remote';
export type FfmpegRemoteAuth = 'google_id_token' | 'none';

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
  /** Operator switch for the Local executor (DB-backed; env has no knob → always true here). */
  localEnabled: boolean;
  /** Operator switch for the Remote executor. From env alone: on iff FFMPEG_REMOTE_URL is set. */
  remoteEnabled: boolean;
  /** Which executor runs a step unless the step says otherwise. */
  executor: FfmpegExecutorSetting;
  /** Worker base URL (https), trimmed and trailing-slash-stripped. Setting this enables the remote executor. */
  remoteUrl: string | null;
  /** How CE authenticates to the Worker. */
  remoteAuth: FfmpegRemoteAuth;
  /** Service-account JSON key (raw string; parsed lazily by the caller). */
  remoteSaKeyJson: string | null;
  /** Max concurrent remote jobs from this instance. */
  remoteMaxInflight: number;
  /** Refuse Workers older than this CE version (semver). Unset = any. */
  workerMinVersion: string | null;
  /** Cap on a single output object (signed single-request PUT). */
  maxOutputBytes: number;
}

/** '' counts as unset — compose passthrough materializes unconfigured vars as empty strings. */
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** '' counts as unset, like `num()`. Trims whitespace and strips a single trailing '/'. */
function str(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function readFfmpegEnv(env: NodeJS.ProcessEnv = process.env): FfmpegEnvConfig {
  const maxSeconds = num(env.FFMPEG_MAX_SECONDS, 1800);
  const remoteUrl = str(env.FFMPEG_REMOTE_URL);
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
    executor: env.FFMPEG_EXECUTOR === 'remote' ? 'remote' : 'local',
    localEnabled: true,
    remoteEnabled: remoteUrl !== null,
    remoteUrl,
    remoteAuth: env.FFMPEG_REMOTE_AUTH === 'none' ? 'none' : 'google_id_token',
    remoteSaKeyJson: str(env.FFMPEG_REMOTE_SA_KEY_JSON),
    remoteMaxInflight: num(env.FFMPEG_REMOTE_MAX_INFLIGHT, 8),
    workerMinVersion: str(env.FFMPEG_WORKER_MIN_VERSION),
    maxOutputBytes: num(env.FFMPEG_MAX_OUTPUT_BYTES, 2 * 1024 ** 3),
  };
}
