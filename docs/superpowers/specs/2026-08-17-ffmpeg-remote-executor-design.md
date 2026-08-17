# ffmpeg Remote Executor (Cloud Run reference deployment) — Design Spec

- **Date:** 2026-08-17
- **Status:** proposed (decisions D1–D12 locked with the user in a grilling session; not yet built)
- **Repos:** `bffless/ce` (executor seam, worker image, settings, docs), `bffless/apps` → `apps/studio` (picker), `bffless/docs`
- **Predecessor:** `2026-08-12-ce-ffmpeg-pipeline-handler-design.md` — that spec explicitly deferred "a sidecar/microservice as a later evolution behind the same handler contract". This is that evolution.
- **Published copy:** https://handoff.bffless.dev/tree/specs/ffmpeg-cloud-run · **Epic:** bffless/apps#346

## Why

The CE `ffmpeg_handler` runs ffmpeg **inside the backend container**. That was the right
zero-infrastructure v1, and it works on a 2 GB droplet (bffless.dev) — but it has three
structural limits that bite the moment a real organization uses it:

1. **The work is bursty and the box is rented by the month.** An org that transcribes
   its meetings does nothing for hours, then needs a 2 h recording's audio extracted
   *now*. Sizing the always-on backend for the peak means paying for idle; sizing for
   idle means `FFMPEG_INSUFFICIENT_MEMORY` at the peak (exactly what j5s.dev — 1 GB —
   reports today: `{server:false}`).
2. **ffmpeg competes with the API.** A long encode pins the CPU the admin UI and every
   pipeline share; the 2026-08-13/15 incidents (OOM after a lost compose override; a
   stalled storage socket hanging a post-step) are all "heavy work in the request
   process" failures.
3. **Bytes transit the backend.** Input download → scratch → output upload all flow
   through the same 384 MB–1.5 GB container.

Serverless containers (Cloud Run, and equivalents) bill per 100 ms with scale-to-zero:
a 10-minute job on 8 vCPU / 16 GiB costs on the order of $0.20–0.30 and nothing while
idle. That is the shape of this workload. This spec adds a **remote executor** behind
the *unchanged* `ffmpeg_handler` contract, with Cloud Run as the documented reference
deployment — and keeps Browser (wasm) and Local server as first-class peers, so an
instance can offer all three.

## Locked decisions

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Unit of offload | **Remote executor behind the existing `ffmpeg_handler`.** Same 4 ops (`probe`, `extract_audio`, `slice`, `concat`), same config / output / error-code contract, same `/api/uploads/*` path forms. Apps do not change to benefit. The worker envelope is shaped so a `transcribe` (Whisper) kind can be added later — **transcription is out of scope here.** |
| D2 | Execution model | **Cloud Run *Service*, one synchronous HTTP request per job**, held open until the result and bounded by the existing `FFMPEG_JOB_MAX_SECONDS`. Not Cloud Run Jobs (execution IDs + polling + cleanup buy nothing for minutes-scale ops; Cloud Run's 60-min request ceiling is not a real limit for these ops). |
| D3 | Byte movement | **Signed URLs; bytes never touch CE.** Envelope carries signed GET URLs for inputs and a signed PUT URL for the output (`IStorageAdapter.getUrl` / `getPresignedUploadUrl`). The remote executor is therefore **bucket-storage-only** (S3/GCS/MinIO/Azure); it refuses to enable on the local-FS adapter with a settings-time error. |
| D4 | Auth CE → worker | **Cloud Run IAM (`--no-allow-unauthenticated`) + Google ID token** minted per request with `audience = worker URL` (`google-auth-library`, already a transitive dep). Credential = an SA JSON key pasted into Admin Settings (encrypted at rest, never readable back), or ambient ADC when CE runs on GCP. The worker has **no auth code**. |
| D5 | Pre-flight + concurrency | **Executor-owned.** Capability = Features toggle ON **and** `executor.ready()`. Local: memory/disk pre-flight + 1 slot (unchanged). Remote: no memory/disk pre-flight; a CE-side in-flight fuse `FFMPEG_REMOTE_MAX_INFLIGHT` (default 8 → `FFMPEG_BUSY`); real parallelism = Cloud Run `--max-instances` × `--concurrency=1`. **One new error code:** `FFMPEG_EXECUTOR_UNAVAILABLE`. |
| D6 | Who chooses | **Layered.** Admin enables executors (Local and/or Remote) + picks the default. Probe reports additive `executors` / `defaultExecutor`. Step config gets optional, expression-capable `executor`. Studio's per-browser override widens to `browser \| server \| remote`. |
| D7 | Worker home + deploy | **`workers/ffmpeg/` in the CE repo**, image `ghcr.io/bffless/ffmpeg-worker:<ce-version>` published by CE's release workflow; **one documented `gcloud run deploy`**; stateless (per-job scratch wiped). No Terraform in this issue. |
| D8 | Worker shape | **Dumb argv runner.** CE keeps building args (`ffmpeg-args.ts` is the single source of truth). Envelope `kind` (`ffmpeg` \| `ffprobe`, later `whisper`) is the extension point. Adding/fixing an op needs no worker release. |
| D9 | Deadlines / cancel / retry | Nested deadlines: Cloud Run `--timeout` ≥ `FFMPEG_JOB_MAX_SECONDS` > envelope `maxSeconds`. CE deadline breach → abort request; worker treats disconnect as cancel (SIGKILL). Worker uploads **only on exit 0**. CE confirms success with its own `getMetadata`. **One retry, only on connection-level failure before any response byte** (ECONNRESET / 429 / 503 from the front door). Never on ffmpeg failure or timeout. |
| D10 | Naming | Executor is **`remote`** with `auth: google_id_token \| none`; Cloud Run is the *reference deployment*, not the name. `none` is for private networks (local dev via `docker compose --profile ffmpeg-worker`, CI, an org's own box) and shows a red warning in the UI. Worker refuses non-`https` URLs unless `WORKER_ALLOW_HTTP=1`. |
| D11 | Observability | Additive step-output fields `executor`, `timings{queueMs,transferInMs,ffmpegMs,transferOutMs,totalMs}`, `bytesIn`, `bytesOut` on every op; one structured log event `ffmpeg_remote_job`; settings UI shows last `/healthz` + worker version. **No cost dashboard in CE** — GCP billing is the source of truth. |
| D12 | Scope split + proof | CE epic (this spec) + a small apps issue (Studio picker). Live verification on **bffless.dev** with a worker in the user's GCP project; then j5s.dev (1 GB) demonstrates `server:true` with no local ffmpeg. |

## Glossary additions

See `CONTEXT.md` → *Server video ops*. Short form: **Browser** (wasm in the user's tab),
**Local server** (ffmpeg spawned by the CE backend), **Remote** (ffmpeg run by a **Worker**
CE calls over HTTPS; Cloud Run is the reference deployment). "Server video ops" = Local +
Remote together. **Executor** = the CE-side strategy that runs a job (`local` \| `remote`).
**Job envelope** = the one request body CE sends a Worker.

## Part 1 — CE

### 1.1 Executor seam (pure refactor first)

```ts
interface FfmpegExecutor {
  readonly name: 'local' | 'remote';
  ready(): Promise<{ ok: boolean; reason?: string; version?: string }>;
  run(job: FfmpegJob, opts: { deadlineMs: number; signal: AbortSignal }): Promise<FfmpegJobResult>;
}
```

- `FfmpegJob` is what the handler already assembles today before spawning: resolved
  input storage keys, resolved output key, argv (from `ffmpeg-args.ts`), extra files
  (concat list), `kind`.
- Task 1 extracts today's spawn/scratch/pre-flight code into `LocalFfmpegExecutor`
  with **zero behaviour change** (existing unit + integration suites stay green untouched).
- The handler picks the executor: `step.config.executor` (evaluated) → admin default →
  `FFMPEG_EXECUTOR_UNAVAILABLE` if the chosen one is not enabled/ready.

### 1.2 Remote executor

- `RemoteFfmpegExecutor.run` = build envelope → mint ID token (cached until ~5 min before
  expiry; skipped when `auth: none`) → `POST {workerUrl}/jobs` with `AbortSignal` →
  parse result → `getMetadata(outputKey)` → map to `StepResult` (existing codes +
  `FFMPEG_EXECUTOR_UNAVAILABLE`).
- Signed URL TTLs: `max(FFMPEG_JOB_MAX_SECONDS, 900)` seconds. Output uses
  `getPresignedUploadUrl(key, ttl, maxBytes = FFMPEG_MAX_OUTPUT_BYTES)`.
- In-flight fuse: an atomic counter; `>= FFMPEG_REMOTE_MAX_INFLIGHT` → `FFMPEG_BUSY`
  immediately (no queueing — Cloud Run scales; the fuse only protects CE's own sockets).
- Retry policy per D9, implemented at the fetch layer with a single re-attempt.
- `ready()` = config present + storage adapter presigns (`getPresignedUploadUrl` exists)
  + last `/healthz` (cached 60 s) OK. Version mismatch (worker `< FFMPEG_WORKER_MIN_VERSION`)
  → `ready:false`, reason shown in the settings UI.

### 1.3 Job envelope (wire contract, v1)

> **As built:** the envelope carries `commands: [{id, kind, argv, timeoutSeconds?, fallbackFor?}]`
> instead of a single top-level `kind`/`argv` — slice+audioOutput and concat's re-encode
> fallback are two invocations over one scratch dir; the Worker stays a dumb argv runner (it
> loops). The response mirrors it with `commands: [{id, ran, exitCode}]`. The published image
> is `ghcr.io/bffless/ce-ffmpeg-worker`.

`POST /jobs` — `Content-Type: application/json`

```jsonc
{
  "v": 1,
  "id": "step-uuid",                 // for log correlation only
  "kind": "ffmpeg",                  // "ffmpeg" | "ffprobe"   (later: "whisper")
  "argv": ["-nostdin","-y","-i","{in:src}","-vn","-acodec","libmp3lame","{out:audio}"],
  "inputs":  [{ "name": "src",   "url": "https://…signed GET…" }],
  "outputs": [{ "name": "audio", "url": "https://…signed PUT…", "contentType": "audio/mpeg" }],
  "files":   [{ "name": "list.txt", "content": "file 'a.mp4'\nfile 'b.mp4'\n" }],
  "maxSeconds": 1700,
  "limits": { "maxOutputBytes": 2147483648 }
}
```

- `{in:NAME}`, `{out:NAME}`, `{file:NAME}` placeholders in `argv` are substituted with
  scratch paths by the worker. Anything else in `argv` is passed verbatim. **The pipeline
  surface stays curated (ops, never raw args)** — argv is *CE-authored*, and only CE can
  reach the worker (D4). See ADR-0004.
- `ffprobe` kind: `stdout` (JSON) is returned; no outputs.

Response `200`:

```jsonc
{
  "v": 1, "ok": true, "exitCode": 0,
  "stdout": "…ffprobe json or ''…", "stderrTail": "…last 4 KiB…",
  "outputs": [{ "name": "audio", "bytes": 12345678 }],
  "timings": { "transferInMs": 8100, "ffmpegMs": 41200, "transferOutMs": 2300, "totalMs": 51900 },
  "worker": { "version": "0.5.0", "ffmpeg": "7.0.2" }
}
```

Non-zero exit → `200` with `ok:false`, `exitCode`, `stderrTail`, `code` ∈
`FFMPEG_FAILED | FFMPEG_TIMEOUT | INPUT_FETCH_FAILED | OUTPUT_UPLOAD_FAILED | OUTPUT_TOO_LARGE`.
CE maps `INPUT_FETCH_FAILED` → `FILE_NOT_FOUND`, upload/size failures → `FFMPEG_FAILED`
with the worker message. Transport-level non-2xx / unreachable → `FFMPEG_EXECUTOR_UNAVAILABLE`.

`GET /healthz` → `{ ok, version, ffmpeg, ops:["ffmpeg","ffprobe"], uptimeS }`.

### 1.4 Worker (`workers/ffmpeg/`)

- Node 20, no framework, ~150–200 lines: `server.mjs` (routes, disconnect → abort),
  `job.mjs` (fetch inputs → write files → substitute → spawn → upload). Streams downloads
  and uploads (no buffering), enforces `maxSeconds` (SIGKILL) and `maxOutputBytes`.
- Dockerfile: `alpine` + `apk add ffmpeg` (same package line as `docker/backend.Dockerfile`
  so flags/versions match); `USER node`; `PORT` honoured; scratch under `/tmp/<jobId>`
  wiped in `finally`.
- Local dev: `docker-compose.yml` gains `profiles: [ffmpeg-worker]` service on `:8790`;
  `.env.example` documents `FFMPEG_EXECUTOR=remote FFMPEG_REMOTE_URL=http://ffmpeg-worker:8790
  FFMPEG_REMOTE_AUTH=none` and `WORKER_ALLOW_HTTP=1` for MinIO's plain-http presigned URLs.
- Release: `release.yml` builds + pushes `ghcr.io/bffless/ffmpeg-worker:{version,latest}`
  next to the backend image; the worker's `/healthz.version` is CE's version.

### 1.5 Settings + capability

- **Admin Settings → Features → Server Video Ops** gains an **Executor** section:
  - Local: on/off (existing toggle semantics; shows binary version / memory floor).
  - Remote: on/off, `Worker URL`, `Auth: Google ID token | None (private network)`,
    `Service-account key (JSON)` (write-only; "replace" flow), **Test connection**
    (calls `/healthz`, shows version + ops + latency; explains ADC when no key is set),
    red banner for `none`.
  - Default executor radio (only enabled ones selectable).
  - Setting storage: existing admin-settings table (encrypted value for the key), env
    overrides `FFMPEG_EXECUTOR`, `FFMPEG_REMOTE_URL`, `FFMPEG_REMOTE_AUTH`,
    `FFMPEG_REMOTE_SA_KEY_JSON` (or file), `FFMPEG_REMOTE_MAX_INFLIGHT`,
    `FFMPEG_WORKER_MIN_VERSION` — env wins over DB (matches `FFMPEG_HANDLER_ENABLED`).
- **Probe (no `input`)** output becomes
  `{ server, ops, version, executors: ['local','remote'], defaultExecutor: 'remote', remote?: { version } }`
  — additive; `server` = at least one executor ready.
- `FfmpegHandlerConfig` gains `executor?: 'local' | 'remote' | string /* expression */`.
  Surfaces to update in lockstep (the 4-place rule from One-Shot): handler + TSDoc,
  `mcp/tools/proxy-rules.tools.ts`, `frontend/.../FfmpegHandlerConfig.tsx`, spec files.

### 1.6 Tests

- Unit: executor selection matrix (config × admin default × ready), envelope builder
  (placeholder substitution, TTLs, `maxSeconds` derivation), result mapping (all worker
  codes → CE codes), retry-once policy, ID-token caching, in-flight fuse.
- Worker unit: substitution, disconnect → SIGKILL, upload-only-on-success, size cap.
- Integration (binary-gated like today's `pnpm test:integration -- ffmpeg`): CE ↔ real
  worker container via compose profile, all 4 ops round-tripped through MinIO with
  `auth: none`; asserts step outputs and `ffmpeg_remote_job` log line.
- **Rules-level smoke** (lesson from One-Shot): a scratch project + one `extract_audio`
  rule pushed and executed against the compose worker in CI.

### 1.7 Docs (`bffless/docs` → Features → Server Video Ops → *Remote executor*)

- Concept (three modes, when to use which), the one-command Cloud Run deploy:

  ```bash
  gcloud run deploy bffless-ffmpeg --image ghcr.io/bffless/ffmpeg-worker:<ver> --region us-central1 --no-allow-unauthenticated --cpu 8 --memory 16Gi --concurrency 1 --timeout 3600 --max-instances 10 --cpu-boost --port 8080
  gcloud iam service-accounts create bffless-ffmpeg-caller
  gcloud run services add-iam-policy-binding bffless-ffmpeg --member serviceAccount:bffless-ffmpeg-caller@PROJECT.iam.gserviceaccount.com --role roles/run.invoker
  gcloud iam service-accounts keys create key.json --iam-account bffless-ffmpeg-caller@PROJECT.iam.gserviceaccount.com
  ```
- Sizing table (2 h 1080p input → 16 Gi / 8 vCPU; 1 h 720p → 4 Gi / 4 vCPU), cost example,
  bucket-only note (+ CORS not needed: worker → bucket is server-to-server), `auth: none`
  private-network recipe, troubleshooting (`FFMPEG_EXECUTOR_UNAVAILABLE` decision tree,
  version mismatch, 403 = missing `run.invoker`).

## Part 2 — apps (Studio) — separate small issue

- `videoBackend` override: `browser | server | remote` (`server` keeps meaning "let CE pick
  its default"; `remote`/`local` force via `executor` in the request body → rule passes
  `executor: "{{request.body.executor}}"`).
- Capability probe reader: show which executors exist in the prep UI's backend badge.
- Persist `executor` + `timings.totalMs` from job outputs into `studio_jobs` rows; show in
  the job list. Headless status line prints them.
- No change to job/polling contract; ce#662 (`stepErrors`) remains the failure-detail path.

## Non-goals (explicit)

- Whisper / transcription hosting (future `kind: 'whisper'`; separate spec).
- Cloud Run **Jobs**, GPUs, Terraform/Helm packaging of the worker, Platform per-workspace
  worker provisioning.
- Per-project executor overrides / quotas (instance-level only in v1).
- A CE cost/usage dashboard.
- Local-FS storage support for the remote executor.
- Any change to the browser (wasm) path.

## Risks / open questions

- **Signed PUT + object size:** GCS V4 signed PUT is single-request; a >5 GiB output would
  need resumable — capped by `maxOutputBytes` (2 GiB default) and documented.
- **Azure adapter presign parity:** verify `getPresignedUploadUrl` exists for Azure/S3/MinIO
  (it does for the adapters Studio's direct upload uses); the remote executor's `ready()`
  simply reports the gap otherwise.
- **ID-token minting on droplets** requires outbound access to `oauth2.googleapis.com` —
  documented; failure surfaces as `FFMPEG_EXECUTOR_UNAVAILABLE` with the Google error.
- **Egress:** input from a non-GCP bucket → Cloud Run is cross-cloud egress; the docs
  cost example must say so.
- **Presigned PUT headers (settled):** the integration suite
  (`apps/backend/src/pipelines/__tests__/integration/ffmpeg.remote.spec.ts`) proved against a
  real MinIO that a SigV4 query-signed PUT accepts the Worker's unsigned `content-type` and
  `content-length` headers and persists the content type on the object. S3 and GCS V4 signed
  PUTs behave the same way for unsigned headers; only a provider that pins
  `SignedHeaders=content-type` would need CE to sign it into the URL instead.

## Rollout

1. CE PR(s): seam refactor → remote executor + worker + settings + docs, behind the
   Features toggle (default executor stays `local`; nothing changes for existing
   instances until an admin turns Remote on).
2. Release; user deploys the worker to their GCP project; enable on bffless.dev; live
   Studio run with `?videoBackend=remote`; verify `ffmpeg_remote_job` + job row.
3. apps PR (Studio picker); catalog update.
4. j5s.dev: enable Remote → `server:true` on a 1 GB droplet (the demo).
