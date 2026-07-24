# SSL Cert Staging + Day-2 Follow-ups — Design

**Date:** 2026-07-24
**Issues:** [#514](https://github.com/bffless/ce/issues/514) (cert staging path), [#512](https://github.com/bffless/ce/issues/512) (Apply gating), [#513](https://github.com/bffless/ce/issues/513) (port-80 control unification)
**Context:** Follow-ups from PR #508 (day-2 SSL management), merged 2026-07-23.

## Problem

Certificates are written *live* into `/etc/nginx/ssl/` — the directory the
nginx reload-watcher inotify-watches — rather than to a staging area that
`apply()` promotes. Three separate bugs traced to this root cause (silent
rollback no-op `b83566c`, self-signed re-render clobbering a staged cert
`f80bd16`, and "stage" not actually being provisional). Each was fixed
pointwise; the pattern keeps recurring.

Two smaller follow-ups ride on the fix:
- **#512:** the day-2 `ApplyPanel`'s `disabled` prop is hardcoded `false`, so
  Apply is clickable with nothing staged and the user gets a 422 toast instead
  of a disabled button.
- **#513:** the bootstrap wizard's `ProxyOptions` still uses its original
  port-80 checkbox (`closed`/`null`) while the day-2 page uses the shared
  `Port80Choice` radio (`closed`/`redirect`) — a consistency gap that was
  deliberately deferred while #508 was in flight (it merged; unblocked).

## Decisions (agreed 2026-07-24)

1. **PR structure:** two PRs — PR A: #514 + #512 (coupled: the Apply gating
   needs the staging status field); PR B: #513 alone.
2. **#514 scope:** staging covers **both** the day-2 flow and the bootstrap
   wizard's cert upload. Eliminates the bug-2 class at the root instead of
   relying on the render script's only-if-missing guard.
3. **Discard UX:** yes — a `DELETE` endpoint plus a "Discard staged
   certificate" button, making clean abort reachable from the UI.
4. **Staging location:** `<SSL_CERT_PATH>/staging/` (approach A below).

## Approaches considered for the staging location

- **A. `staging/` subdir of `SSL_CERT_PATH` — chosen.** Same filesystem as
  the live files, so promotion is an atomic `rename()` per file. The watcher's
  `inotifywait` is non-recursive: writes *inside* `staging/` are invisible;
  creating/removing the dir itself wakes the watcher once, a benign no-op
  re-render (same class as the existing `pending-serving-revert.json` writes
  into the watched bootstrap dir).
- **B. Under `bootstrapDir()` next to `ssl-snapshot/`.** Rejected:
  `/etc/nginx/bootstrap` and `/etc/nginx/ssl` can be different bind mounts, so
  cross-mount `rename()` fails `EXDEV` and promotion degrades to copy — losing
  the atomicity that motivated the issue.
- **C. Keep pointwise fixes.** Rejected; that's the recurring pattern the
  issue exists to end.

## Design

### 1. Backend staging architecture (#514)

`saveCertificates()` (BootstrapSetupService) gains a target — staging vs live
— keeping its per-file atomic write (tmp + rename) and the four-file layout
(`fullchain.pem`, `privkey.pem`, `wildcard.<domain>.crt/.key`).

**Writers that move to staging (user-driven):**
- Day-2 `PrimarySslService.stagePaste` — validates, writes to `staging/`.
  **Drops its `snapshotForChangeCycle()` call**: nothing live is touched, so
  the snapshot-ordering discipline that caused bug 1 disappears.
- Day-2 `PrimarySslService.issueLetsEncrypt` — issued cert written to
  `staging/`; the "already valid, reuse" check (`stagedPrimaryCertificate`)
  consults staging first, then live. Also drops its snapshot call.
- Bootstrap wizard `POST /api/setup/certificates` — stages too.

**Writer that stays live:** the LE renewal cron
(`ssl-renewal.service` → `savePrimaryCertificate`) keeps writing directly to
the live dir — auto-renewal must not wait for an Apply click.

**`apply()` (both bootstrap and day-2) promotes:**
- Staging populated → validate coverage against the *staged* fullchain →
  `snapshotForChangeCycle()` (live pre-change state; ordering now trivially
  correct) → `rename()` each staged file over its live counterpart → clear
  `staging/` → `writeInstanceConfig` (watcher re-renders + reloads).
- Staging empty → require live certs present (the unchanged knob-only path,
  e.g. port-80/real-IP edits on an already-working mode).
- Applying with `sslMode: 'selfsigned'` **discards** staging rather than
  promoting: self-signed serves the bootstrap pair regardless, and a lingering
  "staged" indicator after committing to self-signed would mislead.
- The `certAffecting` heuristic (`hasSnapshot && !isApplied`) is replaced by
  the direct fact: `stagingPopulated || cur.sslMode !== next.sslMode`.

**Read paths:** `certificatesPresent` and `assertStagedCertificateCovers`
check staging first, fall back to live — apply gates and wizard-resume status
keep working across the transition.

**Render script:** the f80bd16 only-if-missing guard in
`render-main-conf.sh` stays (still materializes the self-signed pair), but a
re-render can no longer clobber a staged cert — staged files never sit at
`fullchain.pem`. No watcher changes.

### 2. Status + discard API (#514 → enables #512)

- `GET /api/setup/primary-ssl/status` gains
  `stagedCert: SslCertificateInfo | null`, parsed from `staging/fullchain.pem`.
- New `DELETE /api/setup/primary-ssl/staged` clears the staging dir. Same
  guards as sibling endpoints (`assertEnabled`, admin session); it does not
  need the pending-revert block since it touches nothing live.

### 3. Apply gating in the UI (#512)

`PrimarySslManager` derives:

```ts
canApply = editor.sslMode === 'selfsigned'
        || stagedCert != null
        || (editor.sslMode === data.sslMode && data.cert != null)
```

- Self-signed needs no cert; a staged cert enables Apply; the third clause
  keeps knob-only changes enabled on an already-working mode.
- When disabled, a hint line explains: "Validate & stage a certificate to
  enable Apply."
- A "Discard staged certificate" button renders next to Apply when
  `stagedCert` is present; it calls the DELETE endpoint and invalidates the
  status query.
- Backend remains authoritative — this is UX, not enforcement.

### 4. Wizard port-80 unification (#513, separate PR)

`ProxyOptions` swaps its checkbox for the shared `Port80Choice` radio.
Behavior-preserving because `validateApplyConfig` resolves
`port80: null → 'redirect'` in proxy mode (`'closed'` only defaults for
cloudflare, where `ProxyOptions` doesn't render): the radio initializes to
`'redirect'` and dispatches explicit values; `null` survives only as the
store's untouched-initial state. The LE-clear effect stays (same resolved
outcome). For parity, the wizard also gets day-2's copy line — "Port 80 stays
open so Let's Encrypt can validate over HTTP-01" — where the control hides in
LE mode.

## Error handling

- Promotion failures follow the existing posture: validation happens before
  any live write; `nginx -t` in the watcher fails closed on a half-applied
  pair; per-file `rename()` keeps the mismatched-pair window as narrow as the
  current live-write path.
- A stage overwrites any prior stage (no accumulation); discard is idempotent
  (`rm -rf` semantics, 200 even when empty).
- Rollback (`snap.restore()`) is unchanged; staging is already cleared by the
  promote that preceded any pending-revert window.

## Testing

- **Backend:** staging service unit tests (stage/promote/discard, staging-first
  read fallbacks); `primary-ssl.service.spec` (promotion ordering, new
  `certAffecting`, selfsigned-discard, apply-with-empty-staging);
  `bootstrap-setup.service.spec` (target parameter, `certificatesPresent`
  fallback); controller spec for the DELETE; integration spec re-verifies
  stage → apply → rollback under staging semantics.
- **Frontend:** `canApply` truth table in `PrimarySslManager.test.tsx`;
  discard-button render/click; `ProxyOptions` radio dispatch test (PR B).

## Out of scope

- The DNS-01 wildcard flow (Domains → SSL) and its live writes.
- Any change to the renewal cron's write-live behavior.
- Wizard behavior changes beyond the port-80 control swap and the LE copy line.
