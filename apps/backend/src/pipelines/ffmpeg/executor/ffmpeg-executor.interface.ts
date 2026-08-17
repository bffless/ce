/**
 * The ffmpeg executor seam. An `FfmpegJob` is the unit of work CE hands to an
 * executor: named scratch files plus a list of argv commands to run over one
 * scratch dir. CE authors every argv (ffmpeg-args.ts) and never learns where
 * the files physically live — that is what lets the same job run in-process
 * (LocalFfmpegExecutor) or on a remote worker.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §1.1
 * and docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md.
 */

export type FfmpegExecutorName = 'local' | 'remote';

/** A scratch-relative filename → storage key. `name` is the literal file name inside the job's scratch dir. */
export interface FfmpegJobInput {
  name: string;
  key: string;
}
export interface FfmpegJobOutput {
  name: string;
  key: string;
  contentType: string;
}
/** Small text files CE authors (concat list). Also materialised as `<scratch>/<name>`. */
export interface FfmpegJobFile {
  name: string;
  content: string;
}

/**
 * One binary invocation. `argv` is CE-authored (ffmpeg-args.ts) and refers to scratch files ONLY through
 * placeholders `{in:NAME}` `{out:NAME}` `{file:NAME}` (all resolve to `<scratch>/<NAME>`); the executor
 * substitutes real paths. Global flags (-nostdin/-hide_banner/-y) are NOT in argv — executors add them.
 * `fallbackFor`: run this command only if the named earlier command exited non-zero (FFMPEG_FAILED);
 * a killed/timed-out command aborts the whole job instead. (concat's re-encode fallback.)
 */
export interface FfmpegJobCommand {
  id: string;
  kind: 'ffmpeg' | 'ffprobe';
  argv: string[];
  timeoutSeconds?: number;
  fallbackFor?: string;
}

export interface FfmpegJob {
  /** Correlation only (step id / name). */
  id: string;
  commands: FfmpegJobCommand[];
  inputs: FfmpegJobInput[];
  outputs: FfmpegJobOutput[];
  files: FfmpegJobFile[];
}

export interface FfmpegJobTimings {
  /**
   * Time spent waiting before the job started running. Always 0 for the local
   * executor: its queue wait happens inside FfmpegRunnerService.run and is
   * therefore counted in `ffmpegMs`.
   */
  queueMs: number;
  transferInMs: number;
  ffmpegMs: number;
  transferOutMs: number;
  totalMs: number;
}
export const EMPTY_TIMINGS: FfmpegJobTimings = {
  queueMs: 0,
  transferInMs: 0,
  ffmpegMs: 0,
  transferOutMs: 0,
  totalMs: 0,
};

export interface FfmpegJobResult {
  executor: FfmpegExecutorName;
  /** stdout of the LAST command that ran (ffprobe json for probe). */
  stdout: string;
  stderrTail: string;
  commands: Array<{ id: string; ran: boolean; exitCode: number | null }>;
  outputs: Array<{ name: string; key: string; bytes: number }>;
  bytesIn: number;
  bytesOut: number;
  timings: FfmpegJobTimings;
  worker?: { version: string; ffmpeg: string };
}

export interface FfmpegExecutorReadiness {
  ok: boolean;
  reason?: string;
  version?: string;
}

export interface FfmpegExecutor {
  readonly name: FfmpegExecutorName;
  /** `-threads` value CE should bake into argv for this executor (local: FFMPEG_THREADS; remote: 0 = auto). */
  argvThreads(): number;
  ready(): Promise<FfmpegExecutorReadiness>;
  /** Throws the typed ffmpeg-errors (FfmpegBusyError, FfmpegProcessError, …) — the handler maps them. */
  run(job: FfmpegJob, opts: { signal: AbortSignal }): Promise<FfmpegJobResult>;
}
