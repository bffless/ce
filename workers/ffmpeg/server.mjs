/**
 * HTTP surface of the BFFless ffmpeg Worker: `POST /jobs` (one envelope in, one
 * WorkerResponse out) and `GET /health` (alias `/healthz`). Everything interesting lives in job.mjs —
 * this file is routing, body limits, the one-job-at-a-time fuse and the disconnect →
 * cancel rule.
 *
 * The Worker has no auth of its own (ADR-0004, D4): reachability is the control —
 * Cloud Run IAM in front, or a private network.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runJob as defaultRunJob, validateEnvelope } from './job.mjs';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, body) {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Reads the request body, refusing anything over `maxBodyBytes`. */
function readBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        const error = new Error(`request body exceeds ${maxBodyBytes} bytes`);
        error.tooLarge = true;
        req.pause();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.once('error', reject);
  });
}

export function createServer({
  runJob = defaultRunJob,
  allowHttp = false,
  version = 'dev',
  ffmpeg = null,
  scratchRoot = tmpdir(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  log = console.log,
} = {}) {
  // One job at a time per process: Cloud Run runs --concurrency=1, this is the safety
  // net elsewhere. 503 is what CE retries once.
  let busy = false;

  const server = http.createServer((req, res) => {
    // A client that vanishes mid-response surfaces as an 'error' on req/res; without a
    // listener that would be an unhandled error event and take the process down.
    req.on('error', () => {});
    res.on('error', () => {});
    const url = new URL(req.url, 'http://worker');
    // `/health` is the path CE probes. `/healthz` is kept as an alias for local docker/k8s
    // conventions, but on Cloud Run's *.run.app domain Google's front door intercepts the
    // literal `/healthz` (HTML 404 before IAM), so it must never be the only route.
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      sendJson(res, ffmpeg ? 200 : 503, {
        ok: Boolean(ffmpeg),
        version,
        ffmpeg,
        ops: ['ffmpeg', 'ffprobe'],
        uptimeS: Math.round(process.uptime()),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/jobs') {
      handleJob(req, res).catch((error) => {
        console.error(JSON.stringify({ event: 'handler_error', message: error.message }));
        sendJson(res, 500, { ok: false, message: 'worker error' });
      });
      return;
    }
    sendJson(res, 404, {
      ok: false,
      code: 'BAD_REQUEST',
      message: `no route for ${req.method} ${url.pathname}`,
    });
  });

  async function handleJob(req, res) {
    if (busy) {
      sendJson(res, 503, { ok: false, code: 'BUSY', message: 'worker is already running a job' });
      req.resume();
      return;
    }
    busy = true;
    try {
      let raw;
      try {
        raw = await readBody(req, maxBodyBytes);
      } catch (error) {
        if (error.tooLarge) {
          const payload = JSON.stringify({
            ok: false,
            code: 'BAD_REQUEST',
            message: error.message,
          });
          res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
          res.end(payload, () => req.destroy());
          return;
        }
        return; // client vanished mid-upload; nothing to answer
      }

      let envelope;
      try {
        envelope = JSON.parse(raw);
        validateEnvelope(envelope, { allowHttp });
      } catch (error) {
        sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message });
        return;
      }

      // Disconnect → cancel: whoever asked for this job is the only reason to run it.
      const controller = new AbortController();
      let answered = false;
      const abort = () => {
        if (!answered) controller.abort();
      };
      req.on('close', abort);
      res.on('close', abort);

      let result;
      try {
        result = await runJob(envelope, {
          signal: controller.signal,
          scratchRoot,
          version,
          ffmpegVersion: ffmpeg ?? '',
        });
      } catch (error) {
        // runJob only throws when the worker itself is broken, never for a job-level
        // failure: 500 tells CE the executor is unavailable instead of blaming the step.
        answered = true;
        console.error(
          JSON.stringify({ event: 'job_error', id: envelope.id, message: error.message }),
        );
        sendJson(res, 500, { ok: false, message: `worker error: ${error.message}` });
        return;
      }
      answered = true;
      log(
        JSON.stringify({
          event: 'job',
          id: envelope.id,
          ok: result.ok,
          code: result.code ?? null,
          totalMs: result.timings?.totalMs ?? null,
          bytesIn: result.bytesIn,
          bytesOut: result.bytesOut,
        }),
      );
      sendJson(res, 200, result);
    } finally {
      busy = false;
    }
  }

  server.isBusy = () => busy;
  return server;
}

/** First line of `ffmpeg -version`, or null when the binary is missing. */
export function detectFfmpeg(bin = 'ffmpeg') {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(bin, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.once('error', () => resolve(null));
    child.once('close', (code) => resolve(code === 0 ? out.split('\n')[0].trim() || null : null));
  });
}

async function main() {
  const port = Number(process.env.PORT ?? 8080);
  const ffmpeg = await detectFfmpeg();
  const server = createServer({
    allowHttp: process.env.WORKER_ALLOW_HTTP === '1',
    version: process.env.WORKER_VERSION ?? 'dev',
    ffmpeg,
    scratchRoot: process.env.WORKER_SCRATCH_DIR || tmpdir(),
    maxBodyBytes: Number(process.env.WORKER_MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES),
  });
  server.listen(port, () => {
    console.log(
      JSON.stringify({
        event: 'listening',
        port,
        version: process.env.WORKER_VERSION ?? 'dev',
        ffmpeg,
      }),
    );
  });
  // Cloud Run sends SIGTERM then waits ~10s: stop accepting, let the in-flight job finish
  // (its own maxSeconds still applies). No --no-cpu-throttling needed: the request is open.
  process.on('SIGTERM', () => {
    console.log(JSON.stringify({ event: 'sigterm', busy: server.isBusy() }));
    server.close(() => process.exit(0));
    server.closeIdleConnections(); // keep-alive sockets from CE must not hold shutdown open
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
