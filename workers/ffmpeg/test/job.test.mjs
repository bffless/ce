import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { substituteArgv, validateEnvelope, runJob, httpPut } from '../job.mjs';

test('substituteArgv maps {in|out|file:NAME} to scratch paths and rejects unknown/unsafe names', () => {
  assert.deepEqual(
    substituteArgv(['-i', '{in:a.mp4}', '{out:b.wav}', '-x'], new Set(['a.mp4', 'b.wav']), '/s'),
    ['-i', '/s/a.mp4', '/s/b.wav', '-x'],
  );
  assert.throws(() => substituteArgv(['{in:zzz}'], new Set(['a']), '/s'), /unknown placeholder/);
  assert.throws(() => substituteArgv(['{in:../etc}'], new Set(['../etc']), '/s'), /unsafe/);
});

const okEnvelope = (over = {}) => ({
  v: 1,
  id: 'j',
  commands: [{ id: 'c', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] }],
  inputs: [{ name: 'in.mp4', url: 'https://b/in' }],
  outputs: [{ name: 'out.wav', url: 'https://b/out', contentType: 'audio/wav' }],
  files: [],
  maxSeconds: 60,
  limits: { maxOutputBytes: 1024 },
  ...over,
});

test('validateEnvelope accepts v1 and rejects http URLs unless allowed, bad kinds, duplicates', () => {
  assert.doesNotThrow(() => validateEnvelope(okEnvelope(), { allowHttp: false }));
  assert.throws(
    () =>
      validateEnvelope(okEnvelope({ inputs: [{ name: 'in.mp4', url: 'http://b/in' }] }), {
        allowHttp: false,
      }),
    /https/,
  );
  assert.doesNotThrow(() =>
    validateEnvelope(okEnvelope({ inputs: [{ name: 'in.mp4', url: 'http://b/in' }] }), {
      allowHttp: true,
    }),
  );
  assert.throws(
    () =>
      validateEnvelope(okEnvelope({ commands: [{ id: 'c', kind: 'sh', argv: [] }] }), {
        allowHttp: false,
      }),
    /kind/,
  );
  assert.throws(
    () =>
      validateEnvelope(
        okEnvelope({ outputs: [{ name: 'in.mp4', url: 'https://b/o', contentType: 'x' }] }),
        { allowHttp: false },
      ),
    /duplicate/,
  );
  assert.throws(() => validateEnvelope(okEnvelope({ v: 2 }), { allowHttp: false }), /v/);
});

/** Fake spawn: writes the last argv token as a file, exits with `code` after `delayMs`; ignores SIGKILL unless `killable`. */
function fakeSpawn({ code = 0, delayMs = 0, stderr = 'err', killable = true } = {}) {
  const calls = [];
  const impl = (bin, argv, opts) => {
    calls.push({ bin, argv, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      if (killable) {
        clearTimeout(t);
        child.emit('close', null, 'SIGKILL');
      }
    };
    const t = setTimeout(async () => {
      if (code === 0) await writeFile(argv[argv.length - 1], 'OUT');
      child.stderr.end(stderr);
      child.stdout.end('{"format":{}}');
      child.emit('close', code, null);
    }, delayMs);
    return child;
  };
  return { impl, calls };
}
/** Fake fetch: GET returns `inputBytes`, PUT records the body and returns `putStatus`. */
function fakeFetch({ getStatus = 200, putStatus = 200, inputBytes = 'INPUT' } = {}) {
  const puts = [];
  const impl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'PUT') {
      let n = 0;
      for await (const chunk of init.body) n += chunk.length;
      puts.push({ url, headers: init.headers, bytes: n });
      return new Response('', { status: putStatus });
    }
    return new Response(getStatus === 200 ? inputBytes : 'nope', { status: getStatus });
  };
  return { impl, puts };
}
const scratchRoot = () => mkdtemp(path.join(tmpdir(), 'wk-'));

test('happy path: downloads, substitutes, runs, uploads only on exit 0, reports bytes + timings', async () => {
  const sp = fakeSpawn();
  const f = fakeFetch();
  const res = await runJob(okEnvelope(), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.equal(res.ok, true);
  assert.equal(sp.calls[0].bin, 'ffmpeg');
  assert.match(sp.calls[0].argv[1], /in\.mp4$/);
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].headers['content-type'], 'audio/wav');
  assert.deepEqual(res.outputs, [{ name: 'out.wav', bytes: 3 }]);
  assert.equal(res.bytesIn, 5);
  assert.equal(res.bytesOut, 3);
  assert.deepEqual(res.commands, [{ id: 'c', ran: true, exitCode: 0 }]);
  for (const k of ['transferInMs', 'ffmpegMs', 'transferOutMs', 'totalMs'])
    assert.equal(typeof res.timings[k], 'number');
});
test('input 404 → INPUT_FETCH_FAILED, nothing spawned', async () => {
  const sp = fakeSpawn();
  const f = fakeFetch({ getStatus: 404 });
  const res = await runJob(okEnvelope(), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.deepEqual([res.ok, res.code], [false, 'INPUT_FETCH_FAILED']);
  assert.equal(sp.calls.length, 0);
});
test('non-zero exit → FFMPEG_FAILED with stderr tail, no upload', async () => {
  const sp = fakeSpawn({ code: 1, stderr: 'Conversion failed!' });
  const f = fakeFetch();
  const res = await runJob(okEnvelope(), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_FAILED']);
  assert.match(res.stderrTail, /Conversion failed/);
  assert.equal(f.puts.length, 0);
});
test('fallbackFor runs the fallback only after its target fails', async () => {
  let n = 0;
  const sp = fakeSpawn();
  const first = sp.impl;
  const impl = (bin, argv, opts) =>
    n++ === 0 ? fakeSpawn({ code: 1 }).impl(bin, argv, opts) : first(bin, argv, opts);
  const f = fakeFetch();
  const env = okEnvelope({
    commands: [
      { id: 'copy', kind: 'ffmpeg', argv: ['{out:out.wav}'] },
      { id: 're', kind: 'ffmpeg', argv: ['{out:out.wav}'], fallbackFor: 'copy' },
    ],
  });
  const res = await runJob(env, {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: impl,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.commands, [
    { id: 'copy', ran: true, exitCode: 1 },
    { id: 're', ran: true, exitCode: 0 },
  ]);
});
test('maxSeconds → SIGKILL → FFMPEG_TIMEOUT', async () => {
  const sp = fakeSpawn({ delayMs: 5_000 });
  const f = fakeFetch();
  const res = await runJob(okEnvelope({ maxSeconds: 0.05 }), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_TIMEOUT']);
});
test('abort signal (client disconnect) kills the child and reports FFMPEG_TIMEOUT-like cancel', async () => {
  const sp = fakeSpawn({ delayMs: 5_000 });
  const f = fakeFetch();
  const ac = new AbortController();
  const p = runJob(okEnvelope(), {
    signal: ac.signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  setTimeout(() => ac.abort(), 20);
  const res = await p;
  assert.equal(res.ok, false);
  assert.equal(res.code, 'CANCELLED');
});
test('output over maxOutputBytes → OUTPUT_TOO_LARGE; upload non-2xx → OUTPUT_UPLOAD_FAILED', async () => {
  const f1 = fakeFetch();
  const r1 = await runJob(okEnvelope({ limits: { maxOutputBytes: 2 } }), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f1.impl,
    uploadImpl: f1.impl,
    spawnImpl: fakeSpawn().impl,
  });
  assert.equal(r1.code, 'OUTPUT_TOO_LARGE');
  assert.equal(f1.puts.length, 0);
  const f2 = fakeFetch({ putStatus: 403 });
  const r2 = await runJob(okEnvelope(), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f2.impl,
    uploadImpl: f2.impl,
    spawnImpl: fakeSpawn().impl,
  });
  assert.equal(r2.code, 'OUTPUT_UPLOAD_FAILED');
  assert.match(r2.message, /403/);
});
test('the scratch dir is removed afterwards', async () => {
  const root = await scratchRoot();
  const f = fakeFetch();
  await runJob(okEnvelope(), {
    signal: new AbortController().signal,
    scratchRoot: root,
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: fakeSpawn().impl,
  });
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(root), []);
});

// --- added cases (beyond the brief) -----------------------------------------

test('files are written to scratch and {file:NAME} resolves to them', async () => {
  const sp = fakeSpawn();
  const f = fakeFetch();
  let listContent = null;
  // Read the list file while the job still owns its scratch dir (it is wiped afterwards).
  const spawnImpl = (bin, argv, opts) => {
    listContent = readFileSync(argv[3], 'utf8');
    return sp.impl(bin, argv, opts);
  };
  const env = okEnvelope({
    commands: [
      { id: 'c', kind: 'ffmpeg', argv: ['-f', 'concat', '-i', '{file:list.txt}', '{out:out.wav}'] },
    ],
    inputs: [],
    files: [{ name: 'list.txt', content: "file 'a.mp4'\n" }],
  });
  const res = await runJob(env, {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl,
  });
  assert.equal(res.ok, true);
  assert.match(sp.calls[0].argv[3], /\/list\.txt$/);
  assert.equal(listContent, "file 'a.mp4'\n");
  assert.equal(res.bytesIn, 0);
});

test('ffprobe commands run the ffprobe binary and return its stdout', async () => {
  const sp = fakeSpawn();
  const f = fakeFetch();
  const env = okEnvelope({
    commands: [{ id: 'p', kind: 'ffprobe', argv: ['-show_format', '{in:in.mp4}'] }],
    outputs: [],
  });
  const res = await runJob(env, {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.equal(res.ok, true);
  assert.equal(sp.calls[0].bin, 'ffprobe');
  assert.equal(res.stdout, '{"format":{}}');
  assert.equal(f.puts.length, 0);
});

test('a declared output the command never wrote → FFMPEG_FAILED', async () => {
  const f = fakeFetch();
  // The fake writes its last argv token: this command rewrites the input, never out.wav.
  const env = okEnvelope({
    commands: [{ id: 'c', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '{in:in.mp4}'] }],
  });
  const res = await runJob(env, {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: fakeSpawn().impl,
  });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_FAILED']);
  assert.match(res.message, /out\.wav/);
  assert.equal(f.puts.length, 0);
});

test('a fallback is skipped (ran:false) when its target succeeded', async () => {
  const sp = fakeSpawn();
  const f = fakeFetch();
  const env = okEnvelope({
    commands: [
      { id: 'copy', kind: 'ffmpeg', argv: ['{out:out.wav}'] },
      { id: 're', kind: 'ffmpeg', argv: ['{out:out.wav}'], fallbackFor: 'copy' },
    ],
  });
  const res = await runJob(env, {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.commands, [
    { id: 'copy', ran: true, exitCode: 0 },
    { id: 're', ran: false, exitCode: null },
  ]);
  assert.equal(sp.calls.length, 1);
});

test('validateEnvelope rejects unresolvable placeholders, empty commands and maxSeconds <= 0', () => {
  assert.throws(
    () => validateEnvelope(okEnvelope({ commands: [] }), { allowHttp: false }),
    /commands/,
  );
  assert.throws(
    () => validateEnvelope(okEnvelope({ maxSeconds: 0 }), { allowHttp: false }),
    /maxSeconds/,
  );
  assert.throws(
    () =>
      validateEnvelope(
        okEnvelope({ commands: [{ id: 'c', kind: 'ffmpeg', argv: ['{in:nope}'] }] }),
        { allowHttp: false },
      ),
    /unknown placeholder/,
  );
  assert.throws(
    () =>
      validateEnvelope(
        okEnvelope({ commands: [{ id: 'c', kind: 'ffmpeg', argv: 'not-an-array' }] }),
        { allowHttp: false },
      ),
    /argv/,
  );
  try {
    validateEnvelope(okEnvelope({ v: 2 }), { allowHttp: false });
    assert.fail('expected a throw');
  } catch (error) {
    assert.equal(error.code, 'BAD_REQUEST');
  }
});

/** Fake fetch whose `hangOn` method never settles until its signal aborts. */
function hangingFetch({ hangOn = 'GET' } = {}) {
  const started = { GET: 0, PUT: 0 };
  const impl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    started[method] += 1;
    if (method === hangOn) {
      await new Promise((_, reject) => {
        init.signal.addEventListener(
          'abort',
          () =>
            reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
          { once: true },
        );
      });
    }
    if (method === 'PUT') {
      for await (const chunk of init.body) void chunk;
      return new Response('', { status: 200 });
    }
    return new Response('INPUT', { status: 200 });
  };
  return { impl, started };
}

test('the deadline is job-wide: a hung input download → FFMPEG_TIMEOUT, nothing spawned, scratch wiped', async () => {
  const sp = fakeSpawn();
  const f = hangingFetch({ hangOn: 'GET' });
  const root = await scratchRoot();
  const res = await runJob(okEnvelope({ maxSeconds: 0.05 }), {
    signal: new AbortController().signal,
    scratchRoot: root,
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_TIMEOUT']);
  assert.match(res.message, /maxSeconds/);
  assert.equal(sp.calls.length, 0);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(root), []);
});

test('the deadline aborts a hung upload → FFMPEG_TIMEOUT, not OUTPUT_UPLOAD_FAILED', async () => {
  const sp = fakeSpawn();
  const f = hangingFetch({ hangOn: 'PUT' });
  const res = await runJob(okEnvelope({ maxSeconds: 0.1 }), {
    signal: new AbortController().signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_TIMEOUT']);
  assert.equal(sp.calls.length, 1);
  assert.equal(f.started.PUT, 1);
  assert.deepEqual(res.outputs, []);
});

test('a caller abort during a hung download is still CANCELLED, not FFMPEG_TIMEOUT', async () => {
  const sp = fakeSpawn();
  const f = hangingFetch({ hangOn: 'GET' });
  const ac = new AbortController();
  const p = runJob(okEnvelope(), {
    signal: ac.signal,
    scratchRoot: await scratchRoot(),
    fetchImpl: f.impl,
    uploadImpl: f.impl,
    spawnImpl: sp.impl,
  });
  setTimeout(() => ac.abort(), 20);
  const res = await p;
  assert.deepEqual([res.ok, res.code], [false, 'CANCELLED']);
  assert.equal(sp.calls.length, 0);
});

/** A one-shot http server that records the PUT it receives and answers `status`. */
async function putServer(status = 200, body = '') {
  const http = await import('node:http');
  const received = { bytes: 0, headers: null, method: null };
  const server = http.createServer((req, res) => {
    received.method = req.method;
    received.headers = req.headers;
    req.on('data', (chunk) => {
      received.bytes += chunk.length;
    });
    req.on('end', () => {
      res.writeHead(status);
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { received, url: `http://127.0.0.1:${server.address().port}/o.wav`, server };
}

test('httpPut streams the file to a real server with no socket timeout, and reports the status', async () => {
  const src = path.join(await mkdtemp(path.join(tmpdir(), 'put-')), 'o.wav');
  await writeFile(src, 'wav-bytes');

  const ok = await putServer(200);
  const res = await httpPut(ok.url, {
    headers: { 'content-type': 'audio/wav', 'content-length': '9' },
    body: createReadStream(src),
    signal: new AbortController().signal,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(ok.received.method, 'PUT');
  assert.equal(ok.received.bytes, 9);
  assert.equal(ok.received.headers['content-type'], 'audio/wav');
  ok.server.close();

  const denied = await putServer(403, 'AccessDenied');
  const bad = await httpPut(denied.url, { body: createReadStream(src) });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 403);
  assert.equal(await bad.text(), 'AccessDenied');
  denied.server.close();
});

test('httpPut destroys the request when the job deadline aborts it', async () => {
  const src = path.join(await mkdtemp(path.join(tmpdir(), 'put-')), 'o.wav');
  await writeFile(src, 'wav-bytes');
  // A server that never answers: only the abort can settle this.
  const http = await import('node:http');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const ac = new AbortController();
  const p = httpPut(`http://127.0.0.1:${server.address().port}/o.wav`, {
    body: createReadStream(src),
    signal: ac.signal,
  });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (error) => error.name === 'AbortError');
  server.close();
});
