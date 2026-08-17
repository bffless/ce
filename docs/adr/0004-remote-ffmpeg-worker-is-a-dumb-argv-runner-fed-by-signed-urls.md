# The remote ffmpeg Worker is a dumb argv runner fed by signed storage URLs

When the `ffmpeg_handler` runs a job through the Remote executor, CE still builds the ffmpeg argv itself (from the curated ops) and sends the Worker a job envelope of `{kind, argv, signed input URLs, signed output URL, deadline}`. The Worker substitutes scratch paths for named placeholders, runs the binary, uploads only on exit 0, and returns exit code / stdout / timings. It knows nothing about ops, projects, or storage adapters, and it never receives bytes from CE — inputs and outputs move Worker ↔ bucket directly. Consequently the Remote executor is bucket-storage-only.

## Why

- **One source of truth for arguments.** The 2026-08-12 spec fixed the pipeline surface as *curated operations, never raw ffmpeg args*. That rule is about the surface **users** can reach. Between CE and a Worker only CE can call (Cloud Run IAM), an op-aware Worker would be a second copy of `ffmpeg-args.ts` that drifts, and every op change would become a lockstep CE + Worker release. Sending CE-authored argv keeps the curated surface *and* lets an op be added or a flag fixed with no Worker release.
- **Bytes must not transit the instance.** The whole point of Remote is that a 1 GB droplet can offer server video ops. Proxying input/output through CE would make the droplet the pipe again (memory, bandwidth, the stalled-socket hangs of #669). Signed GET/PUT URLs cost nothing and every bucket adapter already presigns for direct-to-bucket uploads. The local-FS adapter cannot presign, so it is excluded rather than special-cased.
- **`kind` is the extension point.** A future `whisper` kind is op-shaped and that is fine — it is a new *kind*, not a reason to make `ffmpeg` op-aware.

The alternative — an op-aware Worker with its own API (`/extract-audio`, `/slice` …) — was rejected for the drift and lockstep-release costs above; proxying bytes through CE was rejected because it defeats the purpose.

**As built:** the envelope carries `commands: [{id, kind, argv, timeoutSeconds?, fallbackFor?}]` instead of a single top-level `kind`/`argv` — slice+audioOutput and concat's re-encode fallback are two invocations over one scratch dir; the Worker stays a dumb argv runner (it loops). The published image is `ghcr.io/bffless/ce-ffmpeg-worker`.

## Consequences

- The Worker image is generic and versioned with CE; CE checks a minimum Worker version via `/healthz`, but a Worker rarely needs to move.
- Security rests on *who can call the Worker* (IAM ID tokens; or `auth: none` only on private networks) plus CE's existing path/spans validation — not on the Worker validating argv. Docs must say so plainly.
- Instances on local-FS storage keep Local server + Browser only; the settings UI says why.
- Signed single-request PUT caps output size (2 GiB default); larger outputs need a resumable-upload evolution of the envelope, not a change to this decision.
