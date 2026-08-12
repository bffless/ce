# CE ffmpeg Pipeline Handler + Studio Server-Side Video Ops — Design Spec

- **Date:** 2026-08-12
- **Status:** proposed (decisions locked with the user; spec under review)
- **Repos:** `bffless/ce` (the handler), `bffless/apps` → `apps/studio` (first consumer)
- **Motivating incident:** the Studio headless CI runs of 2026-08-11/12 — browser
  (wasm) ffmpeg took 15+ minutes to cut one 232-second scene single-threaded,
  and the multithreaded wasm core hangs in headless browsers
  (runs 31547724192, 31550836845, 31551738868).

## Why

Studio's video work — audio extraction, per-scene slicing, per-scene assembly,
final stitch — runs entirely in the browser via ffmpeg.wasm. That was the right
no-backend default, but it is the bottleneck everywhere that matters now:

- **wasm x264 is ~5–10× slower than native ffmpeg**, and headless CI is forced
  onto the *single-threaded* wasm build (the MT core deadlocks in headless
  Firefox; Chrome MT is suspect too). A 232s scene cut: 15+ wasm-minutes vs
  roughly 10–30 native seconds.
- **The bytes travel wrong.** The browser must hold the source video to cut it:
  CI downloads the full recording, then uploads every clip back. Server-side
  ops read and write the bucket directly — the video never leaves the backend.
- **Interactive users win too:** no 3 GiB wasm heap, no cross-origin-isolation
  requirement for speed, faster exports on modest laptops.
- A CE-native handler makes this a **platform capability** (per the workspace's
  "enhancing CE is first-class" policy): any app on any CE ≥ the shipping
  version gets server video ops — Recall's indexing is an obvious second
  consumer.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Execution home (v1) | **In-backend child process** — the CE backend spawns `ffmpeg` as a managed child with strict resource guards. No new containers. A sidecar/microservice is a later *evolution behind the same handler contract*, not v1. |
| Async model | **Studio's existing fire-and-poll pattern (story 03f)**: an enqueue rule writes a job row and returns `{ jobId }` immediately; the heavy step runs in the pipeline's **postSteps**; the client polls the job row to a terminal status. Proven for multi-minute work by `/api/transcribe` (WhisperX). CE core gains no new job framework. |
| Studio scope (v1) | **All video ops**: audio extract (prep) + slice/assemble (build) + stitch (export) go server-side when the capability exists, with the wasm path kept as fallback. Contact sheets stay in-browser (canvas image composition, not an ffmpeg op). |
| API surface | **Curated operations, never raw ffmpeg args** (security: no arg injection, no arbitrary file access). |

## Part 1 — CE: the `ffmpeg_handler`

A new pipeline handler type, sibling to `file_upload_handler` / `replicate` /
`function_handler`. Config declares one curated operation; inputs and outputs
are **storage paths** (the bytes never enter a request body — same rule the
`replicate` handler honors by reading bucket objects itself).

### Curated operations

| `operation` | Config | Does (exact invocations ported from Studio's `src/lib/export/*` — keep the wasm-proven flag sets, they encode hard-won handling of variable-fps screen recordings) |
| --- | --- | --- |
| `extract_audio` | `input`, `output` | `-i <in> -vn -ac 1 -ar 16000 -f wav <out>` — the 16 kHz mono WAV transcription contract (story 01b). |
| `slice` | `input`, `spans: [{start, end}...]`, `output`, `audioOutput?` | Cut the kept spans from a source and concat them into one clip (x264, `-preset veryfast -crf` per the current wasm settings), optionally emitting the clip's WAV alongside — one job covers both Studio's per-scene *cut* and *assemble*. |
| `concat` | `inputs: [path...]`, `output` | Final stitch. **Stream-copy first** (`-f concat -c copy`) since the inputs are this handler's own uniformly-encoded outputs — near-instant; re-encode only on stream-mismatch failure. |
| `probe` | `input` | `ffprobe -print_format json` essentials (duration, streams) — cheap sync sanity op, also the capability self-test. |

Validation: numeric spans (0 ≤ start < end ≤ duration), storage paths resolved
through the storage adapter within the project's prefix (no filesystem paths in
configs), outputs written only to handler-config-declared destinations.
Template resolution (`request.body.*`, `steps.*`) works as in other handlers.

### Execution & the fire-and-poll wiring

The handler itself is synchronous ("run this op to completion") — **placement
in postSteps is what makes it async**, exactly like the Replicate calls today.
The canonical rule shape (authored by apps, not baked into CE):

1. `POST /api/video/slice` → `data_create` a job row (`status: pending`, kind,
   params) → `response_handler` returns `{ jobId }` → **postSteps:**
   `data_update` (status running) → `ffmpeg_handler` → `data_update`
   (status done + output paths | status error + message).
2. `GET /api/video/jobs?id=` → `data_query` the row (the existing
   `getStudioJob` poll shape).

Storage flow inside the handler: adapter **stream** → temp file → ffmpeg →
temp file → adapter stream upload → delete temps (streaming both ways; never
buffer whole objects in the backend heap — the file-serve OOM lesson).

### Resource containment (the "can this crash a droplet?" section — yes, unguarded it can; these guards are requirements, not suggestions)

Three failure modes on a small droplet, each with its guard:

- **OOM.** An x264 encode wants 200–400 MB at 1080p; CE backend containers run
  with caps as low as 384 MB, and a cgroup OOM kill can take the *backend*
  down, not just ffmpeg (the app-install OOM incident).
  - Spawn ffmpeg with an explicit address-space cap
    (`prlimit --as`, env `FFMPEG_MEMORY_MB`, default 1024) so ffmpeg — not the
    backend — is what dies on breach; the handler catches the exit and fails
    the job with a clear message.
  - **Pre-flight check:** read the container's own cgroup memory limit; if
    `limit − currentRSS < FFMPEG_MEMORY_MB + headroom`, refuse the job with
    `"insufficient memory for server video ops — raise the backend memory cap
    or lower FFMPEG_MEMORY_MB"` rather than gambling.
  - Docs state the sizing rule: server video ops want the backend container at
    **≥ 1.5–2 GB** (or a swap-backed droplet); below that the capability
    should stay off.
- **CPU starvation.** ffmpeg defaults to all cores at normal priority; on a
  1–2 vCPU droplet the API, nginx, and health checks starve — which presents
  as a crashed box.
  - `nice(10)` + `-threads max(1, cores − 1)` (env `FFMPEG_THREADS` override).
  - **Global concurrency 1** (per-instance semaphore) with a bounded queue
    (env `FFMPEG_QUEUE_MAX`, default 8); enqueue beyond depth → job fails fast
    with a "server busy" status the client can back off on.
- **Disk fill.** Temp transcodes of GB-scale sources on a small volume.
  - Temps under one bounded scratch dir; pre-flight `statvfs` requires free
    space ≥ 2× estimated output (input size as proxy); always-cleanup in
    `finally`, plus orphan sweep on boot.
- Plus: a **watchdog kill** (env `FFMPEG_MAX_SECONDS`, default 1800) for
  wedged processes, and a master switch `FFMPEG_HANDLER_ENABLED` (default on
  when the binary exists — see capability below).

### Capability discovery & packaging

- Boot probe: `ffmpeg -version` + `ffprobe` present → capability flag; exposed
  to apps via a cheap authored rule (`GET /api/video/capabilities` →
  `{ server: boolean, ops: [...] }` — a `function_handler` reading an env the
  backend sets, or the `probe` op). Apps fall back to wasm when absent.
- CE backend Docker image adds the `ffmpeg` apt package (a few tens of MB).
  Local-dev (non-Docker) uses the host binary; capability follows presence.
- Umbrel/appliance and k8s workspace images inherit the same Dockerfile change.

## Part 2 — Studio adoption (all video ops, wasm fallback)

Swap-don't-rewrite: every server op returns the same *contract* the wasm path
produces today — storage URLs for clip / audio / stitched output — so scene
state, Auto Build, and the UI don't change shape at all.

- **Rules** (authored under `.bffless/proxy-rules/studio/`): `/api/video/slice`,
  `/api/video/concat`, `/api/video/extract-audio`, `/api/video/jobs`,
  `/api/video/capabilities` — enqueue + postSteps + poll per Part 1, writing
  job rows to the existing `studio_jobs`-style table with new `kind` values.
- **Client**: `lib/export/` gains a server backend chosen once per session by
  the capability probe. `sliceScene` / `assemble` / `stitch` / `extractAudio`
  become "server when capable, wasm otherwise". The auto-build scheduler's
  ffmpeg lane (capacity 1) maps 1:1 onto the server's concurrency-1 queue —
  no scheduler change. MSW mocks for every new endpoint, same shapes.
- **Prep ordering already fits**: upload (bucket) happens before extract, so
  server-side `extract_audio` just reads what upload wrote. Contact sheets
  remain browser-side (canvas), explicitly out of scope.
- **Fallback matrix**: older CE / no ffmpeg → wasm path, identical to today.
  Catalog manifest: keep `ceMin` as-is (the app runs everywhere); docs note
  the CE version that unlocks server ops.
- **Headless runner**: zero changes — the same clicks get fast. The
  ubuntu-latest free runner becomes permanently sufficient; the `ffmpeg_mt` /
  browser experiments become irrelevant for speed (keep Chrome input for
  automation robustness).

## Rollout

1. CE PR: handler + guards + Dockerfile + docs (+ unit tests with a tiny
   fixture; integration test gated on binary presence). Release via
   release-please as a minor.
2. Studio PR: rules + client backend + mocks + capability probe (works against
   older CE via fallback — no hard dependency, mergeable before/after the CE
   release reaches j5s.dev).
3. Live verify on j5s.dev (2-core droplet — the guards' real test): dispatch a
   headless run; expect build phase to drop from ~45+ min (wasm ST) to a few
   minutes; confirm API latency stays sane *during* an encode.

## Risks

| Risk | Mitigation |
| --- | --- |
| ffmpeg starves/crashes a small droplet | The containment section is the feature: caps, niceness, queue-of-1, pre-flight checks, watchdog, kill switch, sizing docs. |
| postSteps execution ceiling in CE | Verify against CE source before implementation; multi-minute WhisperX postSteps are the existing precedent. Flag if a hard cap exists. |
| Backend redeploy mid-encode kills a job | Jobs are rows: on boot, sweep `running` older than the watchdog to `error("interrupted")`; the client's existing poll-error path (and Auto Build halt/resume) covers retry. |
| Variable-fps screen recordings encode differently server-side | Port the exact wasm flag sets from `lib/export/*`; verify seam alignment against a wasm-produced reference in tests. |
| Stream-copy stitch fails on mismatched clips | Automatic re-encode fallback inside `concat`. |
| Multi-tenant platform (k8s workspaces) CPU noise | v1 targets single-tenant CE; the platform chart can set `FFMPEG_HANDLER_ENABLED=false` until the sidecar evolution. |

## Out of scope (v1)

- Sidecar / external microservice execution (later evolution behind the same
  handler contract; revisit when a single backend's CPU is the limit).
- Raw ffmpeg arg passthrough (never, on security grounds).
- Contact-sheet generation server-side.
- GPU encoding, webhook completion callbacks, cross-instance job routing.

## Success criteria

1. A headless Studio run on ubuntu-latest completes Build in single-digit
   minutes for a ~10-minute recording, with `ffmpegCore` irrelevant.
2. During an encode on a 2-core droplet, `/api/*` latency stays interactive
   and nothing OOMs (observed via a load probe during live verify).
3. A CE instance without ffmpeg (or with the handler disabled) runs Studio
   exactly as today — wasm fallback, no errors, capability probe false.
4. Job rows tell the whole story: enqueue → running → done/error with output
   paths or a human-readable failure, pollable by the existing pattern.
