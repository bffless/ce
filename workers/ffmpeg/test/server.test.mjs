import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

const envelope = {
  v: 1,
  id: 'j1',
  commands: [{ id: 'c', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] }],
  inputs: [{ name: 'in.mp4', url: 'http://b/in' }],
  outputs: [{ name: 'out.wav', url: 'http://b/out', contentType: 'audio/wav' }],
  files: [],
  maxSeconds: 60,
  limits: { maxOutputBytes: 1024 },
};

const result = (over = {}) => ({
  v: 1,
  ok: true,
  commands: [{ id: 'c', ran: true, exitCode: 0 }],
  stdout: '',
  stderrTail: '',
  outputs: [{ name: 'out.wav', bytes: 3 }],
  bytesIn: 5,
  bytesOut: 3,
  timings: { transferInMs: 1, ffmpegMs: 2, transferOutMs: 3, totalMs: 6 },
  worker: { version: 't', ffmpeg: 'x' },
  ...over,
});

/** Boots a worker on an ephemeral port; returns its base URL and a stop(). */
async function boot(opts = {}) {
  const logs = [];
  const server = createServer({
    version: 't',
    allowHttp: true,
    log: (line) => logs.push(line),
    ...opts,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    logs,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
const post = (url, body, init = {}) =>
  fetch(`${url}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    ...init,
  });

test('GET /healthz reports the worker version, ffmpeg and ops', async () => {
  const wk = await boot({ ffmpeg: 'ffmpeg version 6.1.2', runJob: async () => result() });
  try {
    const res = await fetch(`${wk.url}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.version, 't');
    assert.equal(body.ffmpeg, 'ffmpeg version 6.1.2');
    assert.deepEqual(body.ops, ['ffmpeg', 'ffprobe']);
    assert.equal(typeof body.uptimeS, 'number');
  } finally {
    await wk.stop();
  }
});

test('GET /healthz is 503 when ffmpeg is missing', async () => {
  const wk = await boot({ ffmpeg: null, runJob: async () => result() });
  try {
    const res = await fetch(`${wk.url}/healthz`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).ok, false);
  } finally {
    await wk.stop();
  }
});

test('POST /jobs rejects unparseable JSON with 400', async () => {
  const wk = await boot({ runJob: async () => result() });
  try {
    const res = await post(wk.url, 'not json');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'BAD_REQUEST');
  } finally {
    await wk.stop();
  }
});

test('POST /jobs rejects an invalid envelope with 400 BAD_REQUEST and never runs it', async () => {
  let ran = 0;
  const wk = await boot({ runJob: async () => (ran++, result()) });
  try {
    const res = await post(wk.url, JSON.stringify({ ...envelope, v: 2 }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_REQUEST');
    assert.match(body.message, /v/);
    assert.equal(ran, 0);
  } finally {
    await wk.stop();
  }
});

test('POST /jobs http URLs are refused unless allowHttp', async () => {
  const wk = await boot({ allowHttp: false, runJob: async () => result() });
  try {
    const res = await post(wk.url, JSON.stringify(envelope));
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /https/);
  } finally {
    await wk.stop();
  }
});

test('POST /jobs runs the job and returns its result, logging one line', async () => {
  const wk = await boot({ runJob: async () => result() });
  try {
    const res = await post(wk.url, JSON.stringify(envelope));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), result());
    assert.equal(wk.logs.length, 1);
    assert.deepEqual(JSON.parse(wk.logs[0]), {
      event: 'job',
      id: 'j1',
      ok: true,
      code: null,
      totalMs: 6,
      bytesIn: 5,
      bytesOut: 3,
    });
  } finally {
    await wk.stop();
  }
});

test('a job-level failure is still HTTP 200 with the code', async () => {
  const wk = await boot({
    runJob: async () => result({ ok: false, code: 'FFMPEG_FAILED', message: 'ffmpeg exited 1' }),
  });
  try {
    const res = await post(wk.url, JSON.stringify(envelope));
    assert.equal(res.status, 200);
    assert.deepEqual([res.status, (await res.json()).code], [200, 'FFMPEG_FAILED']);
  } finally {
    await wk.stop();
  }
});

test('a second concurrent job gets 503 BUSY', async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const wk = await boot({
    runJob: async () => {
      await held;
      return result();
    },
  });
  try {
    const first = post(wk.url, JSON.stringify(envelope));
    await new Promise((r) => setTimeout(r, 50));
    const second = await post(wk.url, JSON.stringify(envelope));
    assert.equal(second.status, 503);
    assert.equal((await second.json()).code, 'BUSY');
    release();
    assert.equal((await first).status, 200);
    // …and the slot is free again once the first job finished.
    assert.equal((await post(wk.url, JSON.stringify(envelope))).status, 200);
  } finally {
    release();
    await wk.stop();
  }
});

test('a client disconnect aborts the running job', async () => {
  let seen;
  const aborted = new Promise((resolve) => {
    seen = resolve;
  });
  const wk = await boot({
    runJob: async (_env, { signal }) => {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      seen(true);
      return result({ ok: false, code: 'CANCELLED', message: 'caller disconnected' });
    },
  });
  const ac = new AbortController();
  try {
    post(wk.url, JSON.stringify(envelope), { signal: ac.signal }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    assert.equal(await aborted, true);
  } finally {
    await wk.stop();
  }
});

test('a body over maxBodyBytes is refused with 413', async () => {
  const wk = await boot({ maxBodyBytes: 64, runJob: async () => result() });
  try {
    const res = await post(wk.url, JSON.stringify({ ...envelope, pad: 'x'.repeat(1024) }));
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, 'BAD_REQUEST');
  } finally {
    await wk.stop();
  }
});

test('unknown routes are 404', async () => {
  const wk = await boot({ runJob: async () => result() });
  try {
    assert.equal((await fetch(`${wk.url}/`)).status, 404);
    assert.equal((await fetch(`${wk.url}/jobs`)).status, 404);
  } finally {
    await wk.stop();
  }
});
