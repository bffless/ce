/**
 * Builds the JSON envelope CE sends a remote ffmpeg Worker: signed URLs for every
 * input/output plus argv exactly as ffmpeg-args.ts wrote it (global flags prepended,
 * placeholders left verbatim — the Worker resolves `{in:NAME}` etc. itself, unlike the
 * local executor which resolves them to scratch paths before spawning).
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §1.1 and
 * docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md.
 */

import type { FfmpegEnvConfig } from '../../ffmpeg-env';
// The SAME arrays the local runner prepends — one source, so local and remote
// argv can never drift apart.
import { FFMPEG_GLOBAL_FLAGS, FFPROBE_GLOBAL_FLAGS } from '../../ffmpeg-runner.service';
import type { FfmpegJob } from '../ffmpeg-executor.interface';

export { FFMPEG_GLOBAL_FLAGS, FFPROBE_GLOBAL_FLAGS };

export interface WorkerEnvelope {
  v: 1;
  id: string;
  commands: Array<{
    id: string;
    kind: 'ffmpeg' | 'ffprobe';
    argv: string[];
    timeoutSeconds?: number;
    fallbackFor?: string;
  }>;
  /**
   * `stream: true` (#796): the Worker does NOT download this input — `{in:NAME}`
   * resolves to `url` itself and ffmpeg reads it with range requests. Only ever
   * sent to a Worker whose /health reports `protocol >= STREAM_INPUTS_MIN_WORKER_PROTOCOL`;
   * absent means "download", which is what every Worker has always done.
   */
  inputs: Array<{ name: string; url: string; stream?: true }>;
  outputs: Array<{ name: string; url: string; contentType: string }>;
  files: Array<{ name: string; content: string }>;
  maxSeconds: number;
  limits: { maxOutputBytes: number };
}

export type WorkerErrorCode =
  | 'FFMPEG_FAILED'
  | 'FFMPEG_TIMEOUT'
  | 'INPUT_FETCH_FAILED'
  | 'OUTPUT_UPLOAD_FAILED'
  | 'OUTPUT_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'CANCELLED';

export interface WorkerResponse {
  v: 1;
  ok: boolean;
  code?: WorkerErrorCode;
  message?: string;
  commands: Array<{ id: string; ran: boolean; exitCode: number | null }>;
  stdout: string;
  stderrTail: string;
  outputs: Array<{ name: string; bytes: number }>;
  /** Size of every input, downloaded or streamed (a streamed input's size comes from its first response). */
  bytesIn: number;
  /** The part of `bytesIn` read in place from a signed URL instead of downloaded. Absent on older Workers. */
  bytesStreamed?: number;
  bytesOut: number;
  timings: { transferInMs: number; ffmpegMs: number; transferOutMs: number; totalMs: number };
  worker: { version: string; ffmpeg: string };
}

export interface WorkerHealth {
  ok: boolean;
  version: string;
  /** First line of `ffmpeg -version`, or null when the Worker has no ffmpeg binary (ok:false). */
  ffmpeg: string | null;
  ops: string[];
  uptimeS: number;
  /**
   * The envelope features this Worker build understands, owned by the Worker
   * (workers/ffmpeg/job.mjs `WORKER_PROTOCOL`) rather than read off `version`:
   * image versions are CE tags (`v0.4.59`, `preview-2026-09-12-<sha>`, `dev`) and
   * only some of them are semver. Absent = 1 (download-only Workers).
   */
  protocol?: number;
}

/** First Worker protocol that accepts `inputs[].stream` (#796). */
export const STREAM_INPUTS_MIN_WORKER_PROTOCOL = 2;

/** Does this Worker accept streamed inputs? Anything unknown is "no" — it keeps downloading. */
export function workerSupportsStreamInputs(health: Pick<WorkerHealth, 'protocol'> | undefined) {
  return (
    typeof health?.protocol === 'number' && health.protocol >= STREAM_INPUTS_MIN_WORKER_PROTOCOL
  );
}

/**
 * Input options for an input ffmpeg reads over HTTP(S) for the whole encode:
 * without them one dropped connection mid-job fails the step. They are
 * protocol options, so they are only ever sent for a streamed input — on a
 * local scratch path ffmpeg rejects them.
 */
export const STREAM_RECONNECT_FLAGS = [
  '-reconnect',
  '1',
  '-reconnect_on_network_error',
  '1',
  '-reconnect_delay_max',
  '5',
] as const;

const IN_PLACEHOLDER = /^\{in:([^}]+)\}$/;

/**
 * Inserts STREAM_RECONNECT_FLAGS before each `-i` whose very next token is the
 * whole-token `{in:NAME}` of a streamed input. ffmpeg-args.ts always emits
 * `'-i', <input>` adjacently, so this is an exact token match; a streamed
 * placeholder anywhere else (ffprobe's positional input) is left alone.
 */
export function insertReconnectFlags(argv: string[], streamed: ReadonlySet<string>): string[] {
  if (streamed.size === 0) return argv;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    const match = argv[i] === '-i' && next !== undefined ? IN_PLACEHOLDER.exec(next) : null;
    if (match && streamed.has(match[1])) out.push(...STREAM_RECONNECT_FLAGS);
    out.push(argv[i]);
  }
  return out;
}

export interface SignedUrls {
  getUrl(key: string, ttlSeconds: number): Promise<string>;
  putUrl(key: string, ttlSeconds: number, maxBytes: number): Promise<string>;
}

/** Signed URLs must outlive the whole job, so tie the TTL to the job ceiling — floored at 15 minutes. */
export function signedUrlTtlSeconds(env: Pick<FfmpegEnvConfig, 'jobMaxSeconds'>): number {
  return Math.max(env.jobMaxSeconds, 900);
}

/**
 * The Worker's own watchdog, kept below the job ceiling so CE observes a Worker-reported
 * timeout instead of racing its own step-level deadline. Floored at 60s.
 */
export function envelopeMaxSeconds(
  env: Pick<FfmpegEnvConfig, 'maxSeconds' | 'jobMaxSeconds'>,
): number {
  return Math.max(60, Math.min(env.maxSeconds, env.jobMaxSeconds - 60));
}

/**
 * `opts.streamInputs`: the target Worker accepts `inputs[].stream` (see
 * workerSupportsStreamInputs). Off → every input is downloaded and argv is
 * byte-identical to what it has always been, whatever the job asked for.
 */
export async function buildEnvelope(
  job: FfmpegJob,
  urls: SignedUrls,
  env: FfmpegEnvConfig,
  opts: { streamInputs?: boolean } = {},
): Promise<WorkerEnvelope> {
  const ttl = signedUrlTtlSeconds(env);
  const streamed = new Set(
    opts.streamInputs ? job.inputs.filter((i) => i.stream === true).map((i) => i.name) : [],
  );
  const [inputs, outputs] = await Promise.all([
    Promise.all(
      job.inputs.map(async (input) => ({
        name: input.name,
        url: await urls.getUrl(input.key, ttl),
        ...(streamed.has(input.name) ? { stream: true as const } : {}),
      })),
    ),
    Promise.all(
      job.outputs.map(async (output) => ({
        name: output.name,
        url: await urls.putUrl(output.key, ttl, env.maxOutputBytes),
        contentType: output.contentType,
      })),
    ),
  ]);
  return {
    v: 1,
    id: job.id,
    commands: job.commands.map((cmd) => {
      const globalFlags = cmd.kind === 'ffmpeg' ? FFMPEG_GLOBAL_FLAGS : FFPROBE_GLOBAL_FLAGS;
      return {
        id: cmd.id,
        kind: cmd.kind,
        argv: [...globalFlags, ...insertReconnectFlags(cmd.argv, streamed)],
        ...(cmd.timeoutSeconds !== undefined ? { timeoutSeconds: cmd.timeoutSeconds } : {}),
        ...(cmd.fallbackFor !== undefined ? { fallbackFor: cmd.fallbackFor } : {}),
      };
    }),
    inputs,
    outputs,
    files: job.files,
    maxSeconds: envelopeMaxSeconds(env),
    limits: { maxOutputBytes: env.maxOutputBytes },
  };
}
