# v0.2.18 Review Fixes — Design

**Date:** 2026-07-25
**Status:** Approved
**Source:** Release review of PR #515 (v0.2.18) — code review by three parallel reviewers plus eight live test legs on a DigitalOcean droplet (sahp.app: legacy install, both upgrade styles, fresh zero-SSH wizard via Bunny, bare-IP wizard, day-2 SSL staging/rollback, real Cloudflare NS cutover on Full strict). Full findings report: session artifact `CE v0.2.18 Release Review`.
**Sequencing decision:** this branch merges **before** release PR #515 is cut, so v0.2.18 ships with the critical fixed. Release-please folds these commits into the same release.

## Problem

The v0.2.18 release (web bootstrap #508, SSL staging #520, env adoption #522, plus fixes) passed live migration testing overall, but the review surfaced one critical defect, three major gaps, and a set of minor hardening/UX issues. All are to be fixed in one cohesive change set.

Finding IDs below match the review report (C1, M1–M3, m2–m13).

## Non-goals

- No behavior change for existing installs' port-80 knob (adoption/upgrade never rewrites an applied knob; only *defaults for new choices* change).
- No auto-deletion of `ssl/bootstrap-selfsigned.crt` to escape the M2 trap — those files are the live serving cert in selfsigned mode; deletion heuristics are riskier than the trap.
- The cert-less-legacy-install-serves-the-wizard behavior (review info item) gets no dedicated change; M2's warning covers operator visibility.
- Umbrel/tunnel profile, LE-behind-CF, and DNS-provider auto-renew remain out of scope as before.

## Design by workstream

### C1 (Critical): generate the selfsigned pair on demand in the render script

`render-main-conf.sh`'s `SSL_MODE=selfsigned` branch currently `exit 1`s when `${SSL_DIR}/bootstrap-selfsigned.crt/.key` are missing. Env-adopted installs never have the pair (the adoption gate requires its absence; only bootstrap-mode render generates it), so a day-2 switch to selfsigned commits an unrenderable config: silent no-op under the watcher, nginx crash-loop on the next container restart.

**Change:** in the selfsigned branch, when the pair is missing, generate it exactly as the bootstrap-mode branch does (`openssl req -x509 -nodes -days 825 -newkey rsa:2048 … -subj "/CN=bffless-bootstrap"`, key `chmod 600`) and continue. Keep the existing `exit 1` only if generation itself fails. The fix lives render-side only: the nginx image installs openssl; the backend image cannot be assumed to have it, and every consumer (entrypoint, watcher re-render, restart) already goes through this script.

**Note on M2 interaction:** generating the pair here writes the bootstrap marker file on a NORMAL-mode install. That is acceptable: the marker's role in `should_bootstrap()` and `isLegacyEnvInstall()` only matters *before* an `instance.env` with `STATE=applied` exists, and reaching the selfsigned branch requires exactly such a file. Document this in a comment at the generation site.

**Tests:** new `render-main-conf.test.sh` case — fixture with `instance.env` (`STATE=applied`, `SSL_MODE=selfsigned`) and **no** selfsigned pair → render succeeds, pair exists afterward, `fullchain.pem`/`privkey.pem` materialized from it. Plus a `test-bootstrap.sh` leg (`RUN_ADOPTED_SELFSIGNED_LEG=1`): simulate an adopted install (real certs, no marker, instance.json origin env), apply a day-2 switch to proxy+selfsigned via the API, assert nginx reloads and serves the generated selfsigned cert, then restart nginx and assert it comes back up.

### M3: bootstrap apply must not strand the box on an fs failure

`BootstrapSetupController.apply()` runs `finalizeSetup()` (DB: `isSetupComplete=true`) before `writeInstanceConfig()` (fs). If the fs write throws (ENOSPC, EACCES), setup is complete ⇒ bootstrap mode permanently off ⇒ every wizard endpoint 403s, yet no identity exists — browser recovery impossible.

**Change:** keep the current order (swapping creates the mirror stranding on DB failure) but wrap `writeInstanceConfig()`; on failure, un-finalize (`setSetupComplete(false)` or equivalent revert of exactly what `finalizeSetup` set), log the underlying error, and return 500 with a message telling the operator the disk write failed and Apply can be retried. The wizard's ApplyStep already surfaces API errors.

**Tests:** controller spec — `writeInstanceConfig` throws → setup is un-finalized, 500 returned, bootstrap mode still active; retry path succeeds.

### M2: make the legacy bootstrap-mode trap visible

When render runs on a new-nginx install with no visible `instance.env` while real certs are transiently missing, it durably writes the selfsigned marker; the marker then defeats both the render legacy carve-out and backend adoption, leaving a production box serving the wizard until the marker is deleted by hand.

**Change (visibility only):** backend boot-time check — when `ssl/bootstrap-selfsigned.crt` exists AND real `fullchain.pem`/`privkey.pem` exist AND `envIdentity()` returns a real domain AND no `instance.json` exists, log a prominent warning naming the recovery (`rm ssl/bootstrap-selfsigned.crt ssl/bootstrap-selfsigned.key && docker compose restart nginx`). Same recovery snippet goes into README's bootstrap section and the release notes.

**Tests:** unit spec for the new check (all four conditions, and each condition absent → no warning).

### M1: upgrade documentation

The documented update flow (`./stop.sh && docker compose pull && ./start.sh --fresh`) lacks `git pull`, but 0.2.18 makes repo files load-bearing (compose `bootstrap/` mounts, `ONBOARDING_TOKEN` passthrough, rebuilt nginx image with the renderer). Verified live: images-only upgrade works but silently loses day-2 serving changes and adopted-LE renewal.

**Changes (this repo):**
- README "Updating" section: `git pull` as step 1, followed by `./stop.sh`, `docker compose pull`, `./start.sh` (start.sh rebuilds nginx), with a call-out box for the 0.2.18 upgrade specifically.
- Release-note block (pasted into the release PR body / GitHub release): the git-pull requirement, the M2 recovery one-liner, and the disclosed one-time snapshot-rollback overshoot (#516's transitional quirk).

**Companion deliverable (separate repo, same execution session):** `bffless/docs` PR updating the manual-setup and DigitalOcean "Updating" sections identically, plus a new zero-SSH web-bootstrap setup page (claim token → wizard walkthrough → recovery section). The execution plan carries this as its final task; it does not block the ce PR.

### m2: placeholder divergence warning

`adoptOrResyncEnvInstall`'s wizard-file divergence warning fires on every boot of every web-bootstrap install because compose substitutes `yourdomain.com` for a blank `PRIMARY_DOMAIN`.

**Change:** in the warning guard, skip when `d === 'yourdomain.com'` (mirroring `isLegacyEnvInstall`'s exclusion, with a comment referencing it). **Test:** spec case — placeholder domain + wizard file → no warning; a genuinely different real domain still warns.

### m3: reset-bootstrap.sh mints a claim token when absent

On a formerly-classic install, the kept `.env` has no `ONBOARDING_TOKEN`, so the relaunched wizard is claim-ungated on a public IP.

**Change:** after the wipe, if `.env` lacks a non-empty `ONBOARDING_TOKEN`, generate one (`openssl rand -hex 16`), append it with the same comment header `setup.sh --bootstrap` uses, and print it in the completion message (the script already prints next-step guidance).

**Tests:** shell-level check in `test-bootstrap.sh`'s reset coverage (token present after reset from a token-less `.env`; existing token preserved).

### m4: setup.sh guards against a surviving postgres volume

`setup.sh --force` regenerates `POSTGRES_PASSWORD` while an existing `bffless_postgres-data` volume keeps the old one; the install comes up broken with only a soft migration warning. Hit twice during live testing.

**Change:** when setup.sh is about to write a **new** `POSTGRES_PASSWORD` (fresh `.env` or `--force`) and `docker volume ls` shows an existing `*_postgres-data` volume for this project: interactive mode → explain and offer to remove the volume (default no); non-interactive/bootstrap mode → print a prominent warning with the exact fix (`docker compose down && docker volume rm <name>` or reuse of the old password). No silent deletion ever.

**Tests:** covered by a `test-bootstrap.sh` assertion (warning text emitted when the volume pre-exists in the non-interactive path).

### m11: day-2 cert-source selector (wizard parity)

`ServingModelEditor` hard-presets `sslMode` per serving mode and renders no control to change it, so a proxy-path install cannot paste a cert or switch to LE day-2 — while the wizard offers those choices and reminder emails promise them.

**Change:** add a cert-source radio group to `ServingModelEditor`, mirroring the wizard's per-mode options exactly:
- `proxy`: keep self-signed (default) / Let's Encrypt / paste
- `cloudflare`: paste (only — parity with the wizard's CF path)
- `none` (direct): Let's Encrypt (default) / paste

Selecting a mode still applies today's preset; the group then allows switching within the allowed set. Reuse the existing `ssl-leaves` components (`PasteCertificateFields`, the LE issue/renew panel, `SelfSignedConfirm` copy) — the render branches for paste/LE/selfsigned already exist in the editor; the change is exposing the choice rather than adding new apply semantics. Backend `ApplyDto` already accepts all three modes; no API change. The LE-forces-`port80:redirect` effect and `canApply` staging gates keep working unchanged.

**Tests:** frontend Vitest — per serving mode: allowed options rendered, disallowed absent; switching source swaps the sub-panel; existing ApplyPanel gating tests extended for a proxy+paste stage/apply flow.

### m12 + m13: port-80 defaults and visibility on the Cloudflare path

Live-verified through the real CF edge: the wizard's CF default (`port80: closed`) plus Cloudflare's default-off "Always Use HTTPS" means every plain-`http://` visitor gets a Cloudflare 520. Meanwhile the day-2 CF card's copy claims "port 80 stays closed" but preserves whatever knob exists, and hides the control.

**Change (decided with the user):** default `port80: 'redirect'` for the Cloudflare path in both the wizard and the day-2 editor; render the shared `Port80Choice` control on the CF path in both places so "closed" remains an explicit choice; update the CF card copy ("port 80 redirects to HTTPS; you can close it below if you enable Always Use HTTPS in Cloudflare"). `deriveKnobs`' v1-file derivation (`cloudflare → closed`) is **unchanged** — it describes existing installs, which keep their knob.

**Tests:** wizard + editor Vitest for the new default and visible control; `instance-config` spec asserting `deriveKnobs` legacy derivation unchanged.

### m5: per-IP claim-token rate limiting

The global 5-attempt/15-min lockout lets anyone deny claiming for everyone (including the holder of the correct token).

**Change:** key `claimAttempts` by client IP (`X-Real-IP` → `X-Forwarded-For` first hop → socket address, matching how the app resolves client IPs elsewhere), same 5/15-min budget per key, plus a global backstop of 50 attempts/15 min across all IPs against distributed guessing. A correct token from a non-locked IP always succeeds.

**Tests:** service spec — lockout is per-IP; other IPs unaffected; global cap trips; window expiry resets.

### m6: private-range denylist in DNS preflight and LE issuance

`bootstrap-dns-preflight` (and by extension `issue-certificate`) GET `http://<domain>/...` where `<domain>` is caller-supplied and may resolve to internal ranges.

**Change:** before fetching, resolve the domain (all A/AAAA answers) and refuse — with the existing `{ ok:false, reason }` shape — when any answer is loopback, RFC1918, link-local (169.254.0.0/16 incl. metadata), CGNAT (100.64/10), ULA/fc00::/7, or ::1. Also refuse IP-literal "domains" with an explicit check (do not rely on HOSTNAME_RE happening to reject all-numeric labels). Applies to both the preflight service and any direct fetch in the issuance path.

**Tests:** service spec with mocked DNS answers per range; public IP still passes.

### m7: renewal cron respects a pending confirm window

**Change:** `checkAndRenewPrimary` returns early (log line, no email) when `PrimarySslSnapshotService.readPendingRevert()` is non-null; next night's run proceeds normally.
**Tests:** renewal spec case.

### m8 + m9: renewal failure-email throttle and challenge cleanup

**Change:** (a) `sendFailureNotifications` for the primary-renewal path gets the same 7-day per-domain throttle mechanism the reminder emails use (failures still log every run); (b) ACME HTTP-01 challenge token files are removed in a `finally` so failed authorizations don't accumulate webroot litter.
**Tests:** renewal spec — second failure within the window sends no email; token file removed on a failed `waitForValidStatus`.

### Hostname hardening at adoption

`deriveAdoptedConfig` copies `.env`'s `PRIMARY_DOMAIN` verbatim into shell-sourced `instance.env`. Operator-controlled, but a malformed value (space, metacharacter) crash-loops the render — and it's the one identity path that bypasses DTO validation.

**Change:** `envIdentity()` validates the domain against the same hostname rule the DTOs use (`HOSTNAME_RE`, lowercased); invalid → return null (not adoptable) with a one-line warning. This also hardens the divergence-warning path for free.
**Tests:** instance-config spec — metacharacter/space/overlong domains refused with warning; valid domains unaffected.

## Testing strategy

- Every code change lands with unit/spec coverage in the suite that owns the file (backend Jest, frontend Vitest, `render-main-conf.test.sh`).
- One new integration leg: `RUN_ADOPTED_SELFSIGNED_LEG=1` in `test-bootstrap.sh` (C1 end-to-end incl. restart survival). CI runs it with branch-built images alongside the existing legs, same gating as the legacy leg (#522's convention).
- Full `pnpm test` (backend + frontend) and `tsc --noEmit` green before PR.

## Execution

- Branch: `spec/v0218-review-fixes` (this worktree), one PR into `main`, merged before release PR #515 is cut.
- Implementation plan: `docs/superpowers/plans/2026-07-25-v0218-review-fixes.md` (written next via the writing-plans skill), executed in a fresh session with superpowers:subagent-driven-development.
- The `bffless/docs` companion PR is the plan's final task (separate repo checkout at `repos/docs-public` is **stale** — the live docs repo is `bffless/docs` per its own conventions; the task clones/uses the correct repo).
