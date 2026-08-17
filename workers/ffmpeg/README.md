# BFFless ffmpeg Worker

A **dumb argv runner**: CE builds the ffmpeg/ffprobe arguments, signs a GET URL per input
and a PUT URL per output, and posts one job envelope here. The Worker downloads, spawns
exactly the argv it was given, uploads the outputs **only on exit 0**, and wipes its
scratch dir. It has no BFFless knowledge, no database, no auth of its own — adding or
fixing an op needs no Worker release. See
[ADR-0004](../../docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md).

Zero dependencies (Node 20 stdlib only) and no imports from `apps/backend`; the wire
contract in `apps/backend/src/pipelines/ffmpeg/executor/remote/envelope.ts` is the only
coupling.

## API

`POST /jobs` — one envelope in, one result out; the request is held open for the whole job.

```jsonc
{
  "v": 1,
  "id": "job-1",
  "commands": [
    {
      "id": "x",
      "kind": "ffmpeg",
      "argv": ["-nostdin", "-i", "{in:src}", "{out:audio}"],
      "timeoutSeconds": 900,
      "fallbackFor": "copy",
    },
  ],
  "inputs": [{ "name": "src", "url": "https://…signed GET…" }],
  "outputs": [{ "name": "audio", "url": "https://…signed PUT…", "contentType": "audio/wav" }],
  "files": [{ "name": "list.txt", "content": "file 'a.mp4'\n" }],
  "maxSeconds": 3600,
  "limits": { "maxOutputBytes": 2147483648 },
}
```

`{in:NAME}`, `{out:NAME}` and `{file:NAME}` (whole tokens only) resolve to `<scratch>/NAME`;
every other token is passed verbatim. `fallbackFor: "x"` runs the command only if `x`
exited non-zero. Response (always `200` — the _request_ succeeded even when the job did not):

```jsonc
{
  "v": 1,
  "ok": true,
  "commands": [{ "id": "x", "ran": true, "exitCode": 0 }],
  "stdout": "…ffprobe json…",
  "stderrTail": "…last 4 KiB…",
  "outputs": [{ "name": "audio", "bytes": 12345678 }],
  "bytesIn": 0,
  "bytesOut": 0,
  "timings": { "transferInMs": 0, "ffmpegMs": 0, "transferOutMs": 0, "totalMs": 0 },
  "worker": { "version": "0.5.0", "ffmpeg": "ffmpeg version 8.0.1 …" },
}
```

`ok:false` carries `code`: `FFMPEG_FAILED` · `FFMPEG_TIMEOUT` · `INPUT_FETCH_FAILED` ·
`OUTPUT_UPLOAD_FAILED` · `OUTPUT_TOO_LARGE` · `BAD_REQUEST` (also `400`) · `CANCELLED`
(caller disconnected — CE never sees it, its request is gone). One job at a time per
process: a second concurrent `POST /jobs` gets `503 {"code":"BUSY"}`.

`GET /health` → `{ ok, version, ffmpeg, ops:["ffmpeg","ffprobe"], uptimeS }`, `503` when
the ffmpeg binary is missing. `/healthz` is served as an alias, but CE probes `/health`:
on Cloud Run's `*.run.app` domain Google's front door intercepts the literal `/healthz`
(HTML 404 before IAM ever sees the request), so it cannot be the readiness path.

## Env

| Var                     | Default       | Meaning                                                      |
| ----------------------- | ------------- | ------------------------------------------------------------ |
| `PORT`                  | `8080`        | Listen port                                                  |
| `WORKER_VERSION`        | `dev`         | Reported in `/health` and `worker.version` (CE's version)   |
| `WORKER_ALLOW_HTTP`     | unset         | `1` allows plain-`http:` signed URLs (private networks only) |
| `WORKER_SCRATCH_DIR`    | `os.tmpdir()` | Per-job scratch parent; each job dir is wiped in `finally`   |
| `WORKER_MAX_BODY_BYTES` | `1048576`     | Envelope size cap (`413` beyond)                             |

## Run it

```bash
docker build -t ce-ffmpeg-worker workers/ffmpeg && docker run -p 8080:8080 -e WORKER_ALLOW_HTTP=1 ce-ffmpeg-worker
# local dev against CE's compose stack:
docker compose --profile ffmpeg-worker up -d   # then FFMPEG_EXECUTOR=remote FFMPEG_REMOTE_URL=http://ffmpeg-worker:8080 FFMPEG_REMOTE_AUTH=none
node --test workers/ffmpeg/test/*.test.mjs     # or `pnpm test:worker` from the repo root
```

The Worker fetches the signed URLs **itself**, so it must be able to reach the host those
URLs name. With MinIO in compose, CE signs `http://minio:9000/…`, which resolves only
inside `assethost-network` — run the Worker there (the profile above does), not on your laptop.

### Cloud Run (reference deployment)

```bash
gcloud run deploy bffless-ffmpeg --image ghcr.io/bffless/ce-ffmpeg-worker:<ver> --region us-central1 --no-allow-unauthenticated --cpu 8 --memory 16Gi --concurrency 1 --timeout 3600 --max-instances 10 --cpu-boost --port 8080
gcloud iam service-accounts create bffless-ffmpeg-caller
gcloud run services add-iam-policy-binding bffless-ffmpeg --member serviceAccount:bffless-ffmpeg-caller@PROJECT.iam.gserviceaccount.com --role roles/run.invoker
gcloud iam service-accounts keys create key.json --iam-account bffless-ffmpeg-caller@PROJECT.iam.gserviceaccount.com
```

Set `--timeout` at or above CE's `FFMPEG_JOB_MAX_SECONDS`: **`POST /jobs` answers only when the
job is finished**, so the request is held open for the whole encode — every hop in between
(Cloud Run's request timeout, any load balancer or proxy idle timeout) must outlast the longest
job you allow, or the caller sees a transport failure while the Worker is still encoding. CE's
own side is already unbounded: it posts with an undici Agent whose `headersTimeout`/`bodyTimeout`
are 0, bounded instead by the step deadline it aborts on. Output uploads are likewise streamed
with a raw `node:http(s)` request rather than `fetch`, because S3/GCS answer a PUT only once the
whole body has landed and `fetch` gives up after 300 s.

`SIGTERM` stops new requests and lets the in-flight job finish; no `--no-cpu-throttling` is
needed because the request stays open.

## Security

The Worker's guard rail is **who can call it, not what it runs** — argv is CE-authored and
executed verbatim, so anyone who can POST here can run ffmpeg with any arguments against
any URL they sign. Keep it behind Cloud Run IAM (`--no-allow-unauthenticated`, CE mints a
Google ID token per request) or a private network. `WORKER_ALLOW_HTTP=1` is a
private-network switch: never expose a Worker that accepts `http:` URLs to the internet.
