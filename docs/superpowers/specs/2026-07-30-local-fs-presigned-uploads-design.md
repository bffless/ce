# Local-FS Presigned Uploads — Design Spec

**Date:** 2026-07-30
**Status:** Draft for review
**Scope:** `repos/ce` (`LocalStorageAdapter`, a new signature-gated streaming upload route, LRU-cache invalidation, quota enforcement, feature flag)
**Sequencing:** **Prerequisite** for `2026-07-30-app-catalog-1-click-install-design.md`. That spec gates app installs on `supportsPresignedUrls()`; shipping this first is what makes Handoff installable on a stock, local-filesystem CE with no storage decision at all.

## Problem

`LocalStorageAdapter.supportsPresignedUrls()` returns `false` (`storage/local.adapter.ts:198`), with the comment *"Local storage does not support presigned URLs - uploads must go through backend"*. Every other adapter — MinIO, S3, GCS, Azure — returns `true` and implements `getPresignedUploadUrl`.

That single gap has outsized consequences, because a **fresh CE install runs on local storage**: `DynamicStorageAdapter`'s constructor seeds `new LocalStorageAdapter({ localPath: './uploads' })` (`storage/dynamic-storage.adapter.ts:31`) and only swaps once an admin configures a backend. Meanwhile `ENABLE_MINIO` defaults to `false` (`scripts/compose-profiles.sh`), so even the bundled MinIO — which *does* support presigned — is off unless the operator edits `.env` and restarts.

The result: any app built on the presigned-upload flow is dead on arrival on a default install. Handoff is the concrete case — its uploads use presigned prepare + direct PUT, so on local FS it fails with `PRESIGNED_NOT_SUPPORTED`, and its own README has to open with a warning that a real bucket is a hard prerequisite.

The presigned flow exists to let the browser PUT bytes **without passing through the request path that carries a small body cap**. Nothing about that requires an external object store — it only requires an upload URL that is (a) pre-authorized, (b) time-bounded, and (c) streamed to storage rather than buffered. A local adapter can provide all three.

## Goals

1. `LocalStorageAdapter` supports presigned uploads, so `supportsPresignedUrls()` returns `true` and the presigned flow works identically on local FS.
2. Large uploads stream to disk with **bounded memory** — no buffer-the-whole-body step.
3. No new required configuration. An existing install gains the capability on upgrade.
4. The new route is safe to expose unauthenticated, because that is what "presigned" means: authorization is carried by the signature, not a session.

**Non-goals:** changing the presigned *contract* or any pipeline handler; presigned **download** URLs for local FS (`getSignedUrl` already returns a public URL for local); multipart/resumable uploads; making local FS a recommended production backend.

## Scope decisions

| Decision | Choice | Rationale |
|---|---|---|
| URL form | **Absolute**, from an explicitly resolved public origin: `PUBLIC_ORIGIN` if set, else `https://${PRIMARY_DOMAIN}`, else **fail loudly** | A relative URL would work in a browser but presigned URLs are also consumed by non-browser clients (CI, CLI). Absolute keeps one shape for all callers. Failing loudly matters — see the `baseUrl` warning below. |
| Signing key | **Derived**, `sha256(ENCRYPTION_KEY \| 'local-presign-v1')`, overridable via `LOCAL_PRESIGN_SECRET` | Mirrors the established precedent in `function-runner.service.ts:126-137`, which derives the `utils.sign` key from the required, stable `ENCRYPTION_KEY`. Zero new config; signatures survive restarts. |
| Auth on the PUT route | **Signature only**, no session | This is the whole point of a presigned URL. Compensating controls: expiry, exact-key binding, size cap, quota. |
| Overwrite semantics | **Allowed** within the signature's validity | Parity with S3 presigned PUT. Handoff's keys are content-addressed anyway, so overwrite is a no-op in practice. |
| Body handling | **Stream to a temp file, then atomic rename** | A buffered write on a 128 MB-heap backend is how the earlier large-file OOM happened. Streaming is not an optimization here, it is the requirement. |
| Feature flag | `ENABLE_LOCAL_PRESIGNED_UPLOADS`, **default on** | Additive capability, but it does expose an unauthenticated write route, so an operator must be able to turn it off. |

## Architecture

### 1. Signature format

A presigned upload URL is:

```
{origin}/api/storage/presigned/local?key={b64url(key)}&exp={unixSeconds}&max={bytes}&sig={hmacHex}
```

`sig = HMAC-SHA256(key + '|' + exp + '|' + max, presignKey)`.

Binding **`max`** into the signature (not just `key` and `exp`) means the size cap is issued by the server that minted the URL and cannot be raised by the client. `expiresIn` from the caller becomes `exp`; the adapter clamps it to a configured ceiling (default 1 hour, matching the other adapters' default).

Two constraints discovered in the existing code:

- **`max` is a server-side ceiling, not caller input.** `IStorageAdapter.getPresignedUploadUrl?(key, expiresIn?)` (`storage.interface.ts:191`) has no size parameter, and the pipeline handler calls it with exactly those two arguments (`pipelines/handlers/presigned-upload.handler.ts:183-186`). So `max` comes from adapter configuration — one ceiling for the install — and a rule's own `maxFileSize` stays enforced where it already is, in the handler. Widening the interface to carry a per-URL max is a possible future change and is explicitly *not* required here.
- **The route needs its own path.** `api/storage` is already claimed by `storage-usage.controller.ts:13`, so this lands at `@Controller('api/storage/presigned')` with `@Put('local')`. Controllers in this codebase spell out the `api/` prefix themselves — there is no `setGlobalPrefix` in `main.ts`.

### 2. `LocalStorageAdapter` changes

```ts
supportsPresignedUrls(): boolean   // false → true (flag-aware)

async getPresignedUploadUrl(key: string, expiresIn = 3600): Promise<string>
```

`getPresignedUploadUrl` sanitizes and prefixes the key exactly as `upload()` does (reusing the existing `sanitizeKey`/`prefixKey`, so the `keyPrefix` workspace-isolation behaviour is preserved), then signs and returns the URL. The adapter is constructed with the resolved public origin and the presign key, so it stays free of `process.env` reads at call time — consistent with how it already takes `localPath`/`keyPrefix` config.

> ⚠️ **Do not reuse the adapter's existing `baseUrl` for this.** `local.adapter.ts:26-28` takes an optional `baseUrl` that defaults to `http://localhost:3000/files` and carries a standing `@TODO` questioning whether it is used for anything at all. It is used only by `getSignedUrl` (:191). Threading presigned uploads through it would silently mint `localhost` URLs on a real install — a failure that looks like a broken client rather than a misconfiguration. Add a **separate, explicitly resolved `publicOrigin`** and throw at construction when it cannot be resolved. Cleaning up or removing the vestigial `baseUrl` is out of scope here.

### 3. The upload route

New controller in the storage module: `PUT /api/storage/presigned/local`. It follows the precedent of `files.controller.ts`, which is likewise a local-storage-only controller that injects `STORAGE_ADAPTER` and narrows to `LocalStorageAdapter`.

> ⚠️ **Body-parser interaction to verify, not assume.** `main.ts:21-40` creates the app with `rawBody: true` and re-registers the JSON and urlencoded parsers with a `10mb` limit. Neither parser should touch a binary `PUT` (they match on content type), so the request should arrive as an unconsumed stream — but if either did buffer it, the result would be a `10mb` ceiling and a fully-buffered body, i.e. exactly the OOM this design exists to avoid, and it would fail *silently* on large files while passing every small-file test. The plan must include a step that asserts the request stream is still readable in the handler and that memory stays bounded, rather than taking this on trust.

Ordered checks, all before any bytes are written:

1. **Flag** — 404 when `ENABLE_LOCAL_PRESIGNED_UPLOADS` is off, so the route's existence isn't advertised.
2. **Active adapter is local** — 404 otherwise. Prevents a stale URL minted before a backend swap from writing to disk on a bucket-backed install.
3. **Signature** — constant-time compare; 403 on mismatch.
4. **Expiry** — `exp` in the past → 403.
5. **Declared size** — missing `Content-Length` → 411; `Content-Length > max` → 413.
6. **Quota** — `storageQuotaService.checkQuota(contentLength)` (`storage/storage-quota.service.ts:62`); 507 with the quota message when it fails.
7. **Key confinement** — re-sanitize the decoded key and assert it is unchanged; a key that normalizes differently is rejected 400 rather than written. The signature already binds the exact key, so this is defence in depth against a traversal-shaped key that was somehow signed.

Then the write: pipe the request into a temp file under the storage root (`.tmp/<uuid>`), counting bytes. Abort and delete the temp file if the count exceeds `Content-Length` or `max`. On clean end, `fsync` and **atomically rename** into place, creating parent directories first. A client disconnect leaves only the temp file, which a sweeper removes (the existing `pending-uploads.scheduler.ts` is the natural home for that).

`proxy_request_buffering off` is set for this location in both nginx configs so the request streams through rather than being spooled by nginx first; `client_max_body_size` is already `100M` in both (`docker/nginx.conf:18`, `configmap-nginx.yaml:38`) and becomes the effective ceiling unless raised.

Response mirrors what an S3/MinIO presigned PUT returns to the client: `200` with an empty body and an `ETag` of the content hash.

### 4. Cache invalidation

`CachingStorageAdapter` sits in front of storage when `ENABLE_LRU_CACHE` is on and correctly delegates `supportsPresignedUrls`/`getPresignedUploadUrl` (`storage/cache/caching-storage.adapter.ts:206-218`) — so no change is needed there for the *minting* side.

But a presigned PUT writes **underneath** the cache: the cache never sees it and can serve a stale entry for that key afterwards. The upload route therefore invalidates the key in the cache layer after a successful rename. This is a real bug the bucket adapters share in principle, but it only becomes reachable here because local FS is the backend the cache most often fronts.

### 5. What does *not* change

`DynamicStorageAdapter` already delegates both methods (`:148-156`), so the runtime-swap path needs no edits. No pipeline handler, no `presigned_upload` step config, and no client code changes — the whole point is that the existing flow starts working.

## Consequences for Handoff

Once this ships, on a stock local-FS install:

- `PRESIGNED_NOT_SUPPORTED` no longer occurs.
- **No bucket CORS configuration is needed.** The upload URL is same-origin, so the cross-origin `PUT` rule that Handoff's README requires for S3/GCS/Spaces simply doesn't apply. One manual step disappears.
- Handoff's README should be revised from *"requires a real bucket storage backend"* to *"works on any storage backend; a bucket is recommended for production"*, with the CE-version floor noted.

Bucket backends remain the production recommendation — local FS doesn't survive a container rebuild without a volume, and it doesn't scale past one node. This changes what's *possible* on a default install, not what's *advisable* at scale.

## Error handling

| Condition | Status | Notes |
|---|---|---|
| Flag off, or active adapter not local | 404 | Route indistinguishable from absent |
| Bad/missing signature | 403 | Constant-time compare; no detail leaked |
| Expired | 403 | Distinct log line, same response shape |
| Missing `Content-Length` | 411 | Streaming write needs a declared size for the quota pre-check |
| Declared size over `max` | 413 | `max` is signature-bound |
| Actual bytes exceed declared | 413 | Detected mid-stream; temp file deleted |
| Over quota | 507 | Reuses `QuotaCheckResult`'s message |
| Key fails re-sanitization | 400 | Defence in depth |
| Disk write failure | 500 | Temp file deleted; nothing renamed into place |

Failures never leave a partial object at the target key — that is the reason for temp-file-plus-rename rather than writing in place.

## Testing

**Unit** — sign/verify round trip; tampering with each of `key`, `exp`, `max` independently invalidates; expiry boundary; `expiresIn` clamped to the ceiling; key sanitization and `keyPrefix` preservation; `supportsPresignedUrls()` tracks the flag; adapter-not-local rejection.

**Integration (the important one)** — a real streamed upload against a temp storage root:
- a large body (well above the heap cap) completes with **bounded memory**, asserted by sampling RSS during the write rather than by inspecting call shapes. The earlier large-file OOM passed every mock-based test; this is the test that would have caught it.
- a client that disconnects mid-body leaves no target object and no orphaned temp file after the sweeper runs.
- a body exceeding its declared `Content-Length` is aborted with nothing written.
- quota exhaustion rejects before any bytes land.
- with the LRU cache on: read key → presigned PUT new bytes → read again returns the **new** bytes.

**End-to-end** — the Handoff-shaped round trip on local FS: presigned prepare → direct PUT → register → serve back. This is the assertion that the prerequisite actually unblocks the app, and it belongs in CE rather than in the apps repo because it's CE's contract being verified.

## Security review notes

This adds an **unauthenticated write endpoint**, which deserves explicit review attention. The controls are: an HMAC-SHA256 signature over key + expiry + size cap derived from `ENCRYPTION_KEY`; a short default expiry; the exact target key bound into the signature; a size cap bound into the signature and enforced twice (declared and actual); quota enforcement before the write; key re-sanitization; and no session, cookie, or ambient credential consulted, so the route cannot be used as a confused deputy. The route is also inert whenever the active adapter isn't local, which bounds the blast radius of leaked URLs across a backend migration.

The residual risk is the standard presigned-URL one: a leaked URL permits one upload of bounded size to one key until it expires. That is the same exposure S3 presigned PUTs carry, and it is why the expiry ceiling is configurable.
