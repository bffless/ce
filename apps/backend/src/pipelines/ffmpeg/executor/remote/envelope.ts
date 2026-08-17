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
import type { FfmpegJob } from '../ffmpeg-executor.interface';

/** ffmpeg-only global flags: never prompt, never read stdin. Mirrors ffmpeg-runner.service.ts. */
export const FFMPEG_GLOBAL_FLAGS = ['-nostdin', '-hide_banner', '-y'];
/** ffprobe shares only the cmdutils `-hide_banner` option. Mirrors ffmpeg-runner.service.ts. */
export const FFPROBE_GLOBAL_FLAGS = ['-hide_banner'];

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
  inputs: Array<{ name: string; url: string }>;
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
  bytesIn: number;
  bytesOut: number;
  timings: { transferInMs: number; ffmpegMs: number; transferOutMs: number; totalMs: number };
  worker: { version: string; ffmpeg: string };
}

export interface WorkerHealth {
  ok: boolean;
  version: string;
  ffmpeg: string;
  ops: string[];
  uptimeS: number;
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

export async function buildEnvelope(
  job: FfmpegJob,
  urls: SignedUrls,
  env: FfmpegEnvConfig,
): Promise<WorkerEnvelope> {
  const ttl = signedUrlTtlSeconds(env);
  const [inputs, outputs] = await Promise.all([
    Promise.all(
      job.inputs.map(async (input) => ({
        name: input.name,
        url: await urls.getUrl(input.key, ttl),
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
        argv: [...globalFlags, ...cmd.argv],
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
