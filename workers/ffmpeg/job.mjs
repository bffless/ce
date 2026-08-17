/**
 * Job execution for the BFFless ffmpeg Worker: fetch signed-URL inputs into a scratch
 * dir, substitute `{in|out|file:NAME}` placeholders, spawn the argv CE authored, then
 * PUT the outputs back — and never anything else. See
 * docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md.
 *
 * Zero dependencies, no imports from apps/backend: the wire contract
 * (apps/backend/src/pipelines/ffmpeg/executor/remote/envelope.ts) is the only coupling.
 */

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Whole-token placeholders only — byte-identical to the local executor's PLACEHOLDER. */
const PLACEHOLDER = /^\{(in|out|file):([^}]+)\}$/;
const KINDS = new Set(['ffmpeg', 'ffprobe']);
const STDERR_TAIL_BYTES = 4096;
const STDOUT_CAP_BYTES = 1024 * 1024;

/** A job-level failure: reported as `{ ok:false, code }` in the response, never thrown out of runJob. */
class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Names address files inside the scratch dir, so they must be plain file names. */
function assertSafeName(name) {
  if (
    typeof name !== 'string' ||
    name === '' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..')
  ) {
    throw new JobError('BAD_REQUEST', `unsafe name "${name}"`);
  }
  return name;
}

export function substituteArgv(argv, names, scratchDir) {
  return argv.map((token) => {
    const match = PLACEHOLDER.exec(token);
    if (!match) return token;
    const name = match[2];
    assertSafeName(name);
    if (!names.has(name)) throw new JobError('BAD_REQUEST', `unknown placeholder ${token}`);
    return path.join(scratchDir, name);
  });
}

function assertUrl(url, allowHttp, what) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new JobError('BAD_REQUEST', `${what} url is not a URL`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && allowHttp) return;
  throw new JobError(
    'BAD_REQUEST',
    `${what} url must be https (set WORKER_ALLOW_HTTP=1 for private networks)`,
  );
}

export function validateEnvelope(envelope, { allowHttp }) {
  if (typeof envelope !== 'object' || envelope === null)
    throw new JobError('BAD_REQUEST', 'envelope must be an object');
  if (envelope.v !== 1)
    throw new JobError('BAD_REQUEST', `unsupported envelope v ${envelope.v} (want 1)`);
  const inputs = envelope.inputs ?? [];
  const outputs = envelope.outputs ?? [];
  const files = envelope.files ?? [];
  for (const [what, list] of [
    ['inputs', inputs],
    ['outputs', outputs],
    ['files', files],
  ]) {
    if (!Array.isArray(list)) throw new JobError('BAD_REQUEST', `${what} must be an array`);
  }
  if (!Array.isArray(envelope.commands) || envelope.commands.length === 0) {
    throw new JobError('BAD_REQUEST', 'commands must be a non-empty array');
  }

  const names = new Set();
  for (const entry of [...inputs, ...outputs, ...files]) {
    assertSafeName(entry?.name);
    if (names.has(entry.name)) throw new JobError('BAD_REQUEST', `duplicate name "${entry.name}"`);
    names.add(entry.name);
  }
  for (const input of inputs) assertUrl(input.url, allowHttp, `input "${input.name}"`);
  for (const output of outputs) {
    assertUrl(output.url, allowHttp, `output "${output.name}"`);
    if (typeof output.contentType !== 'string' || output.contentType === '') {
      throw new JobError('BAD_REQUEST', `output "${output.name}" needs a contentType`);
    }
  }
  for (const file of files) {
    if (typeof file.content !== 'string')
      throw new JobError('BAD_REQUEST', `file "${file.name}" content must be a string`);
  }

  const ids = new Set();
  for (const cmd of envelope.commands) {
    if (typeof cmd?.id !== 'string' || cmd.id === '')
      throw new JobError('BAD_REQUEST', 'each command needs an id');
    if (ids.has(cmd.id)) throw new JobError('BAD_REQUEST', `duplicate command id "${cmd.id}"`);
    if (!KINDS.has(cmd.kind))
      throw new JobError('BAD_REQUEST', `unsupported command kind "${cmd.kind}"`);
    if (!Array.isArray(cmd.argv) || cmd.argv.some((t) => typeof t !== 'string')) {
      throw new JobError('BAD_REQUEST', `command "${cmd.id}" argv must be an array of strings`);
    }
    if (cmd.fallbackFor !== undefined && !ids.has(cmd.fallbackFor)) {
      throw new JobError(
        'BAD_REQUEST',
        `command "${cmd.id}" fallbackFor "${cmd.fallbackFor}" is not an earlier command`,
      );
    }
    substituteArgv(cmd.argv, names, '/scratch'); // placeholder resolvability only
    ids.add(cmd.id);
  }

  if (typeof envelope.maxSeconds !== 'number' || !(envelope.maxSeconds > 0)) {
    throw new JobError('BAD_REQUEST', 'maxSeconds must be a positive number');
  }
  const maxOutputBytes = envelope.limits?.maxOutputBytes;
  if (typeof maxOutputBytes !== 'number' || !(maxOutputBytes > 0)) {
    throw new JobError('BAD_REQUEST', 'limits.maxOutputBytes must be a positive number');
  }
}

/** Collects a child stream, keeping either the head (stdout, capped) or the tail (stderr). */
function collect(stream, { tail = false, cap } = {}) {
  const state = { buf: Buffer.alloc(0), done: false };
  const ended = new Promise((resolve) => {
    if (!stream) return resolve();
    stream.on('data', (chunk) => {
      if (!tail && state.buf.length >= cap) return; // head-capped: the rest is noise
      const next = Buffer.concat([state.buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      state.buf = tail ? next.subarray(Math.max(0, next.length - cap)) : next.subarray(0, cap);
    });
    stream.once('end', resolve);
    stream.once('error', resolve);
  });
  state.text = () => state.buf.toString('utf8');
  state.ended = ended;
  return state;
}

async function downloadInput(input, dest, fetchImpl, signal) {
  let res;
  try {
    res = await fetchImpl(input.url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new JobError(
      'INPUT_FETCH_FAILED',
      `input "${input.name}" fetch failed: ${error.message}`,
    );
  }
  if (!res.ok)
    throw new JobError(
      'INPUT_FETCH_FAILED',
      `input "${input.name}" fetch failed: HTTP ${res.status}`,
    );
  if (res.body) await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  else await writeFile(dest, '');
  return (await stat(dest)).size;
}

async function uploadOutput(output, src, size, fetchImpl, signal) {
  let res;
  try {
    res = await fetchImpl(output.url, {
      method: 'PUT',
      headers: { 'content-type': output.contentType, 'content-length': String(size) },
      body: Readable.toWeb(createReadStream(src)),
      duplex: 'half',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new JobError(
      'OUTPUT_UPLOAD_FAILED',
      `output "${output.name}" upload failed: ${error.message}`,
    );
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    throw new JobError(
      'OUTPUT_UPLOAD_FAILED',
      `output "${output.name}" upload failed: HTTP ${res.status} ${body}`.trim(),
    );
  }
}

/**
 * Runs one job envelope to completion. Job-level failures come back as `{ ok:false, code }`;
 * only programmer errors (and unexpected I/O faults) throw.
 */
export async function runJob(
  envelope,
  {
    signal,
    scratchRoot,
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
    fetchImpl = fetch,
    spawnImpl = spawn,
    version = 'dev',
    ffmpegVersion = '',
  },
) {
  const startedAt = Date.now();
  const timings = { transferInMs: 0, ffmpegMs: 0, transferOutMs: 0, totalMs: 0 };
  const commandResults = [];
  const outputResults = [];
  let stdout = '';
  let stderrTail = '';
  let bytesIn = 0;
  let bytesOut = 0;

  const done = (extra) => ({
    v: 1,
    ok: true,
    commands: commandResults,
    stdout,
    stderrTail,
    outputs: outputResults,
    bytesIn,
    bytesOut,
    timings: { ...timings, totalMs: Date.now() - startedAt },
    worker: { version, ffmpeg: ffmpegVersion },
    ...extra,
  });

  const scratch = await mkdtemp(path.join(scratchRoot, 'job-'));
  let child = null;
  let timedOut = false;
  const kill = () => child?.kill('SIGKILL');
  const deadline = setTimeout(() => {
    timedOut = true;
    kill();
  }, envelope.maxSeconds * 1000);
  signal.addEventListener('abort', kill, { once: true });

  try {
    const inputs = envelope.inputs ?? [];
    const outputs = envelope.outputs ?? [];
    const files = envelope.files ?? [];
    const names = new Set([...inputs, ...outputs, ...files].map((e) => e.name));

    const inStart = Date.now();
    try {
      for (const input of inputs) {
        bytesIn += await downloadInput(
          input,
          path.join(scratch, assertSafeName(input.name)),
          fetchImpl,
          signal,
        );
      }
      for (const file of files) {
        await writeFile(path.join(scratch, assertSafeName(file.name)), file.content);
      }
    } finally {
      timings.transferInMs = Date.now() - inStart;
    }

    const runStart = Date.now();
    const failed = new Set();
    try {
      for (const cmd of envelope.commands) {
        if (cmd.fallbackFor && !failed.has(cmd.fallbackFor)) {
          commandResults.push({ id: cmd.id, ran: false, exitCode: null });
          continue;
        }
        const argv = substituteArgv(cmd.argv, names, scratch);
        const bin = cmd.kind === 'ffprobe' ? ffprobeBin : ffmpegBin;
        const perCommand =
          cmd.timeoutSeconds > 0
            ? setTimeout(() => {
                timedOut = true;
                kill();
              }, cmd.timeoutSeconds * 1000)
            : null;
        let exit;
        try {
          child = spawnImpl(bin, argv, { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] });
          const out = collect(child.stdout, { cap: STDOUT_CAP_BYTES });
          const err = collect(child.stderr, { tail: true, cap: STDERR_TAIL_BYTES });
          exit = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, killSignal) => resolve({ code, killSignal }));
          });
          // A killed child leaves its pipes hanging; only a clean exit has more to say.
          if (exit.killSignal === null) await Promise.all([out.ended, err.ended]);
          stdout = out.text();
          stderrTail = err.text();
        } catch (error) {
          throw new JobError('FFMPEG_FAILED', `failed to run ${bin}: ${error.message}`);
        } finally {
          clearTimeout(perCommand);
          child = null;
        }

        if (exit.killSignal !== null || exit.code === null) {
          if (signal.aborted) throw new JobError('CANCELLED', 'caller disconnected');
          if (timedOut)
            throw new JobError(
              'FFMPEG_TIMEOUT',
              `command "${cmd.id}" exceeded its deadline and was killed`,
            );
          throw new JobError(
            'FFMPEG_FAILED',
            `command "${cmd.id}" was killed by ${exit.killSignal}`,
          );
        }
        commandResults.push({ id: cmd.id, ran: true, exitCode: exit.code });
        if (exit.code !== 0) {
          if (!envelope.commands.some((c) => c.fallbackFor === cmd.id)) {
            throw new JobError('FFMPEG_FAILED', `ffmpeg exited ${exit.code}`);
          }
          failed.add(cmd.id);
        }
      }
    } finally {
      timings.ffmpegMs = Date.now() - runStart;
    }

    const outStart = Date.now();
    try {
      for (const output of outputs) {
        const file = path.join(scratch, assertSafeName(output.name));
        let size;
        try {
          size = (await stat(file)).size;
        } catch {
          throw new JobError('FFMPEG_FAILED', `command produced no ${output.name}`);
        }
        if (size > envelope.limits.maxOutputBytes) {
          throw new JobError(
            'OUTPUT_TOO_LARGE',
            `output "${output.name}" is ${size} bytes (max ${envelope.limits.maxOutputBytes})`,
          );
        }
        await uploadOutput(output, file, size, fetchImpl, signal);
        outputResults.push({ name: output.name, bytes: size });
        bytesOut += size;
      }
    } finally {
      timings.transferOutMs = Date.now() - outStart;
    }

    return done();
  } catch (error) {
    if (signal.aborted && !(error instanceof JobError && error.code === 'FFMPEG_TIMEOUT')) {
      return done({ ok: false, code: 'CANCELLED', message: 'caller disconnected' });
    }
    if (error instanceof JobError)
      return done({ ok: false, code: error.code, message: error.message });
    throw error;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', kill);
    await rm(scratch, { recursive: true, force: true });
  }
}
