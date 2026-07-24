# Primary SSL: cert-change confirm window + snapshot re-baselining

**Date:** 2026-07-23
**Issue:** [#511](https://github.com/bffless/ce/issues/511) — Day-2 SSL: harden cert-change lockout & rollback semantics
**Follows:** `2026-07-23-day2-ssl-management-design.md` (PR #508)

## Problem

Two safe-by-default deferrals from the day-2 SSL feature:

1. **Direct-serving lockout path.** On `proxyMode: 'none'` (nginx terminates
   TLS), a cert change is classified `cert-only`, so it gets manual rollback
   but no auto-revert timer. A valid-but-untrusted/wrong cert then breaks the
   browser on `admin.<domain>` — the page hosting the "Restore previous SSL
   configuration" button. Rollback works but is unreachable.
2. **Rollback overshoot on chained cert-only applies.**
   `PrimarySslSnapshotService.snapshotIfAbsent()` never re-baselines, and a
   cert-only apply never confirms/clears. After several cert-only applies
   without an intervening rollback, "Restore previous" jumps to the *original*
   pre-chain cert, not the most recent one.

## Decisions

- **Part 1:** cert-affecting changes applied while serving directly
  (`proxyMode: 'none'`) get the same 5-minute provisional auto-revert window
  as reachability changes. Behind Cloudflare/proxy the origin cert is not
  user-facing, so those stay manual-rollback-only.
- **Part 2:** re-baseline on the next change. A successful cert-only apply
  (no confirm window) marks the snapshot *applied*; the next cert-writing
  operation takes a fresh snapshot of the then-live state. Rollback always
  restores the most recent pre-change state, and the manual rollback button
  keeps working after every apply.

## Design

### 1. Snapshot lifecycle (`primary-ssl-snapshot.service.ts`)

Add an **applied marker** — a marker file inside the existing `ssl-snapshot/`
dir, so it is wiped automatically by `snapshot()`, `restore()`, and
`clearSnapshot()`:

- `markApplied()` / `isApplied()` — set after a cert-only apply commits
  without a confirm window.
- Replace `snapshotIfAbsent()` with `snapshotForChangeCycle()`: take a fresh
  snapshot if **no snapshot exists OR the existing one is marked applied**.
  Mid-cycle calls (staged-but-not-yet-applied) remain no-ops, preserving the
  existing guarantee that an apply after a stage/issue does not clobber the
  pre-change baseline with the staged cert.

Effect: `stage A → apply → stage B → apply → rollback` restores **A**, not
the original pre-chain cert.

### 2. Apply classification (`primary-ssl.service.ts`)

In `apply()`, computed **before** `snapshotForChangeCycle()` runs (which may
re-snapshot and clear the marker):

```
certStagedThisCycle = snap.hasSnapshot() && !snap.isApplied()
certAffecting       = certStagedThisCycle || cur.sslMode !== next.sslMode
needsConfirm        = serving || (certAffecting && next.proxyMode === 'none')
```

- `needsConfirm` → `writePendingRevert(deadline)` and return
  `{ applied, kind, deadlineMs }`. `kind` stays `'cert-only'` for pure cert
  changes — the presence of `deadlineMs` is the confirm-required signal.
  Unconfirmed past the deadline → the existing `PrimarySslRevertService`
  interval auto-restores the previous cert + config. This closes the lockout:
  a wrong cert on `admin.<domain>` heals itself within 5 minutes.
- Otherwise (cert change behind Cloudflare/proxy, or a no-op apply) →
  `snap.markApplied()` and return `{ applied, kind: 'cert-only' }` as today.
  Manual rollback stays available, now correctly baselined.
- `cur.sslMode !== next.sslMode` catches served-cert swaps with no staged
  files (e.g. `paste → selfsigned` on direct serving breaks browser trust
  too, so it gets the timer).

`confirm()` and `rollback()` endpoints are unchanged. Confirm still commits
(clears pending revert + snapshot) — after confirming, the manual "Restore
previous" button has no target until the next change, matching existing
serving-change semantics.

Stage/issue guards ("a serving change is pending confirmation") now also
block during a pending cert confirm — acceptable and consistent: one
provisional change at a time.

### 3. Frontend

- `ApplyPanel.tsx`: branch the post-apply toast on `result.deadlineMs != null`
  instead of `kind === 'serving'`; cert-flavored confirmation copy when
  `kind === 'cert-only'` with a deadline (verify the site loads with the new
  certificate, then confirm — or it auto-reverts).
- `RollbackPanel` (countdown + confirm/rollback buttons): **no changes** —
  already driven by `status.pendingRevert`.
- `primarySslApi.ts`: response types already carry optional `deadlineMs`; no
  change.

## Testing

Backend (`primary-ssl.service.spec.ts`, `primary-ssl-snapshot.service.spec.ts`):

- cert-only apply on `proxyMode: 'none'` → pending revert written, response
  carries `deadlineMs`, `kind: 'cert-only'`.
- cert-only apply on `cloudflare` / `proxy` → no pending revert; snapshot
  marked applied.
- chained cert-only applies (proxied): second stage re-baselines; rollback
  restores the most recent pre-change cert, not the original.
- sslMode-only swap on direct serving (no staged files) → gets the timer.
- stage → apply in one cycle: apply does not clobber the stage's snapshot.
- unconfirmed direct-mode cert change → `PrimarySslRevertService` restores it.
- marker lifecycle: cleared by `snapshot()`, `restore()`, `clearSnapshot()`.

Frontend (`ApplyPanel.test.tsx`): toast branches on `deadlineMs`, not `kind`.

## Out of scope

- Any change to serving-change (reachability) semantics — already correct.
- Confirm-window UX beyond toast copy (RollbackPanel already handles it).
- Platform mode / externally-managed SSL (feature already gated off there).
