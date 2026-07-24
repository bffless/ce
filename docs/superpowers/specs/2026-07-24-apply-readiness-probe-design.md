# Apply readiness probe — redirect only when the restarted backend is actually up

**Date:** 2026-07-24
**Branch:** `specs/do-one-click-and-web-bootstrap` (PR #508)
**Relates to:** issue #510 (supersedes its "skip the doomed poll" polish), live-testing follow-up

## Problem

After the bootstrap wizard's Apply step, the backend writes `instance.json` and
`process.exit(0)`s so Docker restarts it under its new identity
(`bootstrap-setup.controller.ts`). The restart takes ~20 s (Nest boot,
migrations, nginx config regen). nginx runs in a separate container and never
goes down; while the backend is dead, `location /api` proxy attempts fail and
nginx answers **502**.

The wizard's readiness probe (`ApplyStep.tsx`) is a `no-cors` fetch of
`${adminUrl}/api/setup/status`. An opaque `no-cors` fetch **resolves on any
HTTP answer — including that 502** — and only rejects on network/DNS failure.
So the first poll tick (3 s) "succeeds" and redirects the user to
`https://admin.<domain>` while the backend is still booting. Logging in
immediately fails with a misleading "invalid credentials".

The signal is structurally too weak: `no-cors` cannot distinguish "nginx up,
backend down" from "ready". A fixed pre-redirect delay would only treat the
symptom (slow droplets / long migrations overrun any constant; fast restarts
make everyone wait).

## Design

### Backend — `GET /api/setup/ready`

New endpoint on `SetupController` (`api/setup` route group), public like
`status` (no guards). Behavior:

- Returns `200` with body `{ "ready": true }` — unconditionally; if the
  process can answer, Nest bootstrap has completed (migrations, SuperTokens
  init, nginx config regen all happen before `listen`), so login genuinely
  works.
- Sets `Access-Control-Allow-Origin: *` via Nest's `@Header()` decorator.
  The handler-level header is written after the global `enableCors`
  middleware runs, overwriting its value — no duplicate-header conflict.
- Sets `Cache-Control: no-store` so no layer caches a stale "ready".

Why a dedicated endpoint instead of widening `status`'s CORS: `status`
returns setup-state details; `ready` exposes nothing beyond "the process is
up", so ACAO `*` is safe. No credentials are involved (the wizard polls with
the fetch default `credentials: 'same-origin'`, which sends no cookies
cross-origin, so ACAO `*` is valid; same-origin requests are exempt from CORS
entirely).

### Frontend — `ApplyStep.tsx` poll

Replace the `no-cors` probe with a plain (`cors`) fetch of
`${adminUrl}/api/setup/ready`; redirect only when `res.ok`. Failure modes all
correctly mean "keep polling":

| State | Probe result | Action |
| --- | --- | --- |
| Backend down, nginx up (502, no ACAO) | cross-origin: fetch throws; same-origin: `res.ok` false | keep polling |
| DNS not propagated / conn refused | fetch throws | keep polling |
| Backend up | readable `200` | redirect once |

Keep: 3 s cadence, 30 s hint, manual "Open <url>" link, `doneRef` single-shot
guard. The hint copy (DNS-propagation wording) is unchanged — it never had a
"browser may be blocking" line; that wording only appeared in issue #510's
description. With ACAO `*` the bare-IP origin can now read the probe, so
auto-redirect works on the bare-IP path too (supersedes #510's proposed
skip-the-poll workaround).

## Testing

- **Backend** (`setup.controller.spec.ts` or sibling): `ready` returns 200 +
  `{ready: true}`; route metadata carries the two headers (assert via
  supertest-style e2e if available, else reflect `@Header` metadata).
- **Frontend** (`ApplyStep.test.tsx`): fetch rejecting → no redirect, hint
  appears after 30 s of ticks; fetch resolving `ok: false` (nginx 502
  same-origin case) → no redirect; fetch resolving `ok: true` → exactly one
  redirect, poll cleared. Update existing no-cors assertions.

## Out of scope

- No fixed delay / countdown.
- No identity check in the response body (the old backend exits ~100 ms
  after apply's response; the first probe tick is 3 s later).
- No gating of the manual link on readiness — it stays an escape hatch.
