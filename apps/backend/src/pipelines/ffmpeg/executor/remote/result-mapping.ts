/**
 * Maps a remote Worker's JSON response back onto the same `FfmpegJobResult` / typed-error
 * contract the local executor uses, so FfmpegHandler never has to know which executor ran
 * the job. See executor/ffmpeg-executor.interface.ts and executor/local-ffmpeg.executor.ts.
 */

import {
  FfmpegExecutorUnavailableError,
  FfmpegProcessError,
  FfmpegTimeoutError,
} from '../../ffmpeg-errors';
import type { FfmpegJob, FfmpegJobResult } from '../ffmpeg-executor.interface';
import type { WorkerResponse } from './envelope';

function lastRanExitCode(commands: WorkerResponse['commands']): number | null {
  const ran = [...commands].reverse().find((c) => c.ran);
  return ran ? ran.exitCode : null;
}

export function mapWorkerResponse(res: WorkerResponse, job: FfmpegJob): FfmpegJobResult {
  if (!res.ok) {
    const message = res.message ?? res.code ?? 'remote ffmpeg worker reported failure';
    const exitCode = lastRanExitCode(res.commands);
    switch (res.code) {
      case 'FFMPEG_TIMEOUT':
        throw new FfmpegTimeoutError(message);
      case 'INPUT_FETCH_FAILED':
        throw Object.assign(new Error(message), { code: 'FILE_NOT_FOUND' });
      case 'FFMPEG_FAILED':
      case 'OUTPUT_UPLOAD_FAILED':
      case 'OUTPUT_TOO_LARGE':
        throw new FfmpegProcessError(message, exitCode, res.stderrTail);
      case 'BAD_REQUEST':
      case 'CANCELLED':
      default:
        // BAD_REQUEST: the Worker rejected our envelope — a CE bug, not a job failure.
        // CANCELLED / anything unrecognised: no useful job result to report either.
        throw new FfmpegExecutorUnavailableError(message);
    }
  }

  const bytesByName = new Map(res.outputs.map((o) => [o.name, o.bytes]));
  const outputs = job.outputs.map((output) => {
    const bytes = bytesByName.get(output.name);
    if (bytes === undefined) {
      throw new FfmpegProcessError(
        `remote ffmpeg worker reported success but did not return output "${output.name}"`,
        lastRanExitCode(res.commands),
        res.stderrTail,
      );
    }
    return { name: output.name, key: output.key, bytes };
  });

  return {
    executor: 'remote',
    stdout: res.stdout,
    stderrTail: res.stderrTail,
    commands: res.commands,
    outputs,
    bytesIn: res.bytesIn,
    bytesOut: res.bytesOut,
    timings: { queueMs: 0, ...res.timings },
    worker: res.worker,
  };
}

export function isWorkerResponse(x: unknown): x is WorkerResponse {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.ok === 'boolean' &&
    Array.isArray(r.commands) &&
    typeof r.stdout === 'string' &&
    typeof r.stderrTail === 'string' &&
    Array.isArray(r.outputs) &&
    typeof r.bytesIn === 'number' &&
    typeof r.bytesOut === 'number' &&
    typeof r.timings === 'object' &&
    r.timings !== null &&
    typeof r.worker === 'object' &&
    r.worker !== null
  );
}
