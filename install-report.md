# install.sh zero-SSH web-bootstrap default — implementation report

## What changed

### `install.sh`

- Header comment rewritten to document the new default (zero-SSH web
  bootstrap: installs OS deps, starts the stack, hands off to the browser)
  plus the `--interactive` escape hatch and unchanged passthrough behavior.
- Added `DIM` color var (matches `setup.sh`'s palette) for the new banner.
- Added `detect_server_ip()`: best-effort public IP detection via
  `curl -fsSL -m 3 https://api.ipify.org`, falling back to
  `hostname -I | awk '{print $1}'`, falling back to the literal placeholder
  string `<server-ip>` if both come up empty. Never fails the script.
- Added `print_web_bootstrap_banner()`: reads `ONBOARDING_TOKEN` out of
  `.env` (warns if missing), shows the claim token, and prints instructions
  for `https://<server-ip>` (cert warning expected) or pointing a domain at
  the box (Cloudflare A records for `@`/`*`, SSL Full) and using
  `https://admin.<your-domain>`.
- Rewrote the tail of `main()` to dispatch on arguments:
  1. **No arguments (new default)** — runs `./setup.sh --bootstrap`; if it
     fails, prints the error and `exit`s with its exit code **without**
     starting the stack. On success, `chmod +x start.sh` (best-effort),
     runs `./start.sh`, then prints the new banner.
  2. **`--interactive` present anywhere in the args** — stripped out of the
     argument list; remaining args are passed to `./setup.sh` exactly as
     the old default did (old terminal onboarding wizard), no auto-start.
  3. **Any other arguments** — passthrough to `./setup.sh` unchanged, no
     auto-start (setup.sh's own flows print next steps), matching current
     behavior exactly.
- Existing-directory prompt behavior (`Do you want to continue?`) is
  untouched.

### `README.md`

`README.md` did not previously describe the `curl | sh` one-liner at all —
only the manual `./setup.sh --bootstrap && ./start.sh` steps under "Web
bootstrap setup (no SSH)", which remain accurate. Added one clarifying
sentence noting the hosted one-liner (`bffless.dev/install.sh`) now does
this automatically (installs deps, bootstraps, starts the stack), so the
manual steps and the one-liner both land in the same place. No other
`install.sh` references existed in the repo's markdown to fix.

## Verification

### Syntax

```
$ sh -n install.sh && echo "SYNTAX OK"
SYNTAX OK
```

### Sandbox dispatch tests (fully offline — no docker, no real git/network)

Test harness: for each case, `git`, `setup.sh`, and `start.sh` were replaced
with stub scripts in an isolated temp dir. `setup.sh` stub logs its argv to
`setup-calls.log` and, when called with `--bootstrap`, writes a fake `.env`
with `ONBOARDING_TOKEN=<token>`. `start.sh` stub logs to `start-calls.log`.
The pre-existing `INSTALL_DIR` triggers the "already exists" prompt,
answered with `y` via a piped `printf`.

**1. No args → default web-bootstrap flow**

```
setup.sh argv: --bootstrap
start.sh called:
Claim token: deadbeefcafef00d1234567890abcde   (banner correctly showed it)
```
✅ `setup.sh` got `--bootstrap`, `start.sh` ran, banner rendered the token
read from `.env`.

**2. `--interactive` → old behavior exactly**

```
setup.sh argv:
(start-calls.log: none)
```
✅ `setup.sh` got no args (old default terminal wizard), `start.sh` never
ran.

**3. `--force --non-interactive` → unchanged passthrough**

```
setup.sh argv: --force --non-interactive
(start-calls.log: none)
```
✅ Args passed through unchanged, `start.sh` never ran.

**4. IP-detection fallback (offline)** — separate run with `curl` and
`hostname` both stubbed to fail (simulating no network / no public IP):

```
Claim token: testtoken123
Open the setup wizard:
     https://<server-ip>
```
✅ Falls back to the `<server-ip>` placeholder text, does not error, script
still completes and prints the full banner.

### README diff sanity

```
$ grep -n 'install.sh' README.md
42:The one-liner (`curl -fsSL https://bffless.dev/install.sh | sh`) does this automatically:
```

## Incident during verification (already resolved)

While extending the IP-fallback check, an early ad-hoc test **sourced the
real `install.sh` in a live shell** (`. ./install.sh; detect_server_ip`)
instead of running the properly stubbed harness. Because `install.sh`
unconditionally calls `main "$@"` at the bottom of the file, this executed
the **real** flow against this VPS:

- Cloned the real `bffless/ce` repo into a scratch dir
  (`.../scratchpad/install-sandbox/ce`).
- Ran the real `setup.sh --bootstrap` (found real Docker on this host,
  generated a real `.env`/secrets).
- Ran the real `./start.sh`, which built the nginx image and brought up
  `docker compose --profile postgres --profile supertokens up -d`,
  publishing host ports 80/443 briefly.

Immediate cleanup:

- `docker compose down -v` from the cloned dir successfully stopped and
  removed `assethost-nginx`, `assethost-frontend`, `assethost-backend` and
  released host ports 80/443 (this is the part that mattered — no
  externally-reachable service was left listening).
- `assethost-postgres` and `assethost-supertokens` remained (they run under
  compose profiles not touched by a plain `down`) but publish **no host
  ports** (`5432/tcp` / `3567/tcp` internal-only) — no external exposure.
- Follow-up attempts to stop/remove those two containers and their
  `ce_assethost-network` / `ce_default` networks were blocked by this
  environment's auto-mode classifier/permission system (docker
  stop/rm requires explicit user permission here). **They are still
  running and need manual cleanup**, e.g. from
  `.../scratchpad/install-sandbox` (the dir itself has since been deleted,
  but the containers/networks persist):
  ```
  docker rm -f assethost-postgres assethost-supertokens
  docker network rm ce_assethost-network ce_default
  ```
- The accidentally-cloned real repo directory (plain files, not docker) was
  deleted (`rm -rf .../install-sandbox/ce`).
- All subsequent verification (including the IP-fallback re-check) was
  redone with the proper fully-offline stub harness — confirmed clean, no
  further docker/git/network activity.

This incident does not affect the correctness of `install.sh` itself; it
was purely a mistake in one manual verification step, caught and corrected
mid-task per the coordinator's reminder to keep all verification offline.

## Fix: review findings

PR #533 review found three issues; all three fixed in `install.sh`.

1. **CRITICAL — exit-code capture negated status.** `if ! CMD; then
   bootstrap_exit=$?` captures the exit status of `! CMD` itself, not of
   `CMD`. Per POSIX, negating a command's status with `!` collapses any
   nonzero exit code to `0` (and vice versa) as the result the shell
   reports for that compound command; since the `then` branch only runs
   when `! CMD` evaluated to `0` (true), `$?` measured inside that branch
   is always `0`, regardless of `CMD`'s real failure code. So
   `exit "$bootstrap_exit"` always propagated `0` even though bootstrap
   failed. Replaced with the non-negated pattern:
   ```sh
   bootstrap_exit=0
   BFFLESS_INSTALL_DIR="$ABSOLUTE_INSTALL_DIR" ./setup.sh --bootstrap || bootstrap_exit=$?
   if [ "$bootstrap_exit" -ne 0 ]; then
       print_error "Bootstrap setup failed (exit $bootstrap_exit). Not starting the stack."
       exit "$bootstrap_exit"
   fi
   ```
   This also plays correctly with `set -e`: the `||` clause suppresses the
   `set -e` trigger for this one command, and `$?` inside it is
   unambiguously `setup.sh`'s real exit code.

2. **IMPORTANT — unquoted `set -- $remaining_args` word-splitting/glob
   risk.** The `--interactive` branch previously rebuilt forwarded
   arguments by concatenating them into a single string
   (`remaining_args="${remaining_args} ${arg}"`) and then re-splitting it
   with an unquoted `set -- $remaining_args`, which breaks on arguments
   containing spaces, and is subject to pathname expansion (glob) on
   arguments containing `*`/`?`/`[...]`. Reworked to a two-pass approach
   that never flattens args into a string:
   - First pass over the original `"$@"` just detects whether
     `--interactive` is present (`interactive_requested`), without
     consuming/rebuilding anything.
   - Second pass (only when `--interactive` was found) rebuilds the
     positional parameters by appending each argument verbatim via quoted
     `set -- "$arg"` / `set -- "$@" "$arg"`, skipping `--interactive`
     itself, with an explicit `set --` if nothing remains.
   Verified by harness case 5 below: `--interactive --force` forwards
   exactly one argument, `--force`, to `setup.sh` (argc 1), not a
   re-split/glob-expanded value.

3. **MINOR — no existence check before `./start.sh`.** Added the same
   guard style already used for `setup.sh`:
   ```sh
   if [ ! -f "start.sh" ]; then
       print_error "Start script not found at start.sh"
       exit 1
   fi
   ```
   placed after the bootstrap-success check and before `chmod +x
   start.sh`.

### Syntax verification

```
$ sh -n install.sh && echo "sh -n OK"
sh -n OK
$ dash -n install.sh && echo "dash -n OK"
dash -n OK
```

### Harness (extended)

Same stub-harness approach as the original implementation (see above):
`git`, `setup.sh`, `start.sh` replaced with logging stubs on `PATH`/in the
sandboxed clone dir; `INSTALL_DIR` pre-exists so install.sh takes the
"already exists → pull" branch, answered with `y`. `setup.sh`'s stub now
also accepts a configurable exit code (`SETUP_EXIT`) and logs both its
full argv and its argc, so arg-forwarding can be asserted precisely (not
just eyeballed). Fully offline aside from the pre-existing best-effort
`api.ipify.org` IP-detection call in `detect_server_ip` (unchanged,
already covered by the original report's stubbed-fallback case) — no
docker, no real `git`/`setup.sh`/`start.sh`.

**Re-run of the original three cases — all green:**

**1. No args → default web-bootstrap flow**
```
--- install.sh exit code: 0 ---
--- setup-calls.log ---
--bootstrap
--- setup-argc.log ---
1
--- start-calls.log ---
start.sh called
```
`setup.sh` got `--bootstrap`, exit 0 propagated as 0, `start.sh` ran,
banner rendered the claim token.

**2. `--interactive` → old behavior exactly**
```
--- install.sh exit code: 0 ---
--- setup-calls.log ---
(empty line - no args)
--- setup-argc.log ---
0
--- start-calls.log ---
(none - start.sh not called)
```

**3. `--force --non-interactive` → unchanged passthrough**
```
--- install.sh exit code: 0 ---
--- setup-calls.log ---
--force --non-interactive
--- setup-argc.log ---
2
--- start-calls.log ---
(none - start.sh not called)
```

**NEW case (a) — stub `setup.sh` exits 5, no args (default bootstrap path):**
```
ℹ Running non-interactive bootstrap setup...

✗ Bootstrap setup failed (exit 5). Not starting the stack.
--- install.sh exit code: 5 ---
--- setup-calls.log ---
--bootstrap
--- setup-argc.log ---
1
--- start-calls.log ---
(none - start.sh not called)
```
✅ install.sh printed the real exit code (`exit 5`, not a negated/zero
status) and itself exited `5`; `start.sh` was never invoked. This directly
verifies fix #1 — before the fix, this failure mode's negated-`$?` bug
allowed `bootstrap_exit` to read `0` in the `then` branch, meaning the
script could have proceeded to run `start.sh` after a real bootstrap
failure and/or exited `0`.

**NEW case (b) — `--interactive --force`, asserting `setup.sh` receives
exactly one argument (`--force`), no splitting:**
```
ℹ Running setup script (interactive)...

--- install.sh exit code: 0 ---
--- setup-calls.log ---
--force
--- setup-argc.log ---
1
--- start-calls.log ---
(none - start.sh not called)
```
✅ `setup.sh` argv was exactly `--force` (argc `1`) — `--interactive` was
stripped and the remaining argument passed through byte-for-byte via the
quoted `set -- "$@" "$arg"` rebuild, not a flattened/re-split string;
`start.sh` was not invoked (interactive branch never auto-starts).

All five cases green with the fixed `install.sh`.

## Feat: token prefill + centered banners

Stacked on `fix/install-review-findings` (PR #535, open), branch
`feat/claim-token-prefill`. Two independent UX improvements:

### Improvement 1 — claim token as a URL query parameter

**`apps/frontend/src/components/setup/ClaimStep.tsx`**: on mount, reads a
`token` query param off `window.location.href`, prefills the claim-token
input if present, and strips the param via `window.history.replaceState`
(path/other params/hash preserved, no reload). Prefill only — the submit
button still requires an explicit click, so a stale/shared link can't
silently burn a claim attempt.

**Important architecture finding** (from reading `SetupWizard.tsx` per the
task's own instruction to check its step-routing): `computeWizardSteps()`
already has a `?token=` mechanism, added in PR #508 for Platform's
workspace-provisioning "relay" links
(`console-ui/.../WorkspaceDetailPage.tsx` and
`adapters/kubernetes/adapter.ts` in `repos/platform` construct
`.../setup?token=<onboardingToken>` links against this). Its rule is:

```js
if (status.claimRequired && !urlToken) {
  steps.push('claim');
}
```

i.e. whenever a `?token=` is present in the URL, the `'claim'` step is
**omitted from the step list entirely** — the wizard opens directly on
`'admin'` (the token is separately seeded into Redux by `SetupWizard`'s own
mount effect for downstream steps to use). Since `ClaimStep` only ever
renders when `claimRequired && !urlToken`, and my new prefill logic only
ever finds a token when `urlToken` is truthy, **the two conditions are
mutually exclusive with the current `computeWizardSteps` gate** — the new
prefill path is not reachable via the primary `?token=` link flow in the
shipped app today. It is still correct, tested, defensive code (useful if
that gating logic ever changes, or for a direct/isolated render of
`ClaimStep`), and the underlying Redux claim-token wiring
(`SetupWizard`'s own `dispatch(setClaimToken(urlToken))`) already achieves
the actual goal — skipping manual retyping — just via a different
mechanism (skip-the-step, not show-it-prefilled).

Given that the ticket's requested banner copy ("say the form is prefilled")
would be **inaccurate** for what a user actually sees when clicking these
links (no claim screen appears at all — the wizard opens straight on
account setup), I did not word the banner text as "prefilled." I also did
not touch `computeWizardSteps` — Platform's `console-ui` and
`kubernetes/adapter.ts` actively depend on the current skip-to-admin
behavior for zero-click workspace provisioning, and changing it is a
cross-repo UX call outside this ticket's scope. Flagging this for the
coordinator/user to decide whether a follow-up should unify the two
mechanisms.

TDD: `apps/frontend/src/components/setup/__tests__/ClaimStep.test.tsx`
(new file) — two cases:
1. `token` present in the URL → input prefilled with it, `history.replaceState`
   called exactly once with the token stripped (path + other params + hash
   preserved).
2. No `token` → input stays empty, `history.replaceState` never called.

**Red first** (before implementing the `useEffect` in `ClaimStep.tsx`):
```
❯ src/components/setup/__tests__/ClaimStep.test.tsx (2 tests | 1 failed)
  × prefills the claim-token input from a `token` query param and strips it from the URL
  ✓ leaves the input empty and does not touch history when no token is present

AssertionError: expected '' to be 'testtoken123'
```
(Case 2 passed trivially pre-implementation since the unmodified component
always renders an empty input — expected for TDD red on the meaningful
assertion.)

**Green after implementing** the `useEffect` (URL read + `setToken` +
`history.replaceState`):
```
✓ src/components/setup/__tests__/ClaimStep.test.tsx (2 tests) 40ms
 Test Files  63 passed (63)
      Tests  673 passed (673)
```
Full suite (all 63 frontend test files, 673 tests) stayed green — no
regressions.

`pnpm --filter frontend exec tsc --noEmit` (from worktree root): clean, no
output.

**`install.sh` / `setup.sh` banner copy** (parts (c)/(d)): both now build
`ip_url`/`domain_url` with `?token=${CLAIM_TOKEN}` appended when a token is
available, falling back to bare URLs (existing behavior) when it isn't
(e.g. unreadable `.env`). Step copy is conditional on whether a token was
found:
- With a token: "Open the setup wizard - this link carries your claim
  token, so it skips straight to account setup (no claim screen to fill
  in)" + a trailing step explaining the bare `Claim token:` line is only
  needed for hand-typed URLs.
- Without a token: unchanged plain "Open the setup wizard:" wording, no
  claim-token step (nothing to paste).
`setup.sh`'s `run_bootstrap_mode` "Next Steps" (~line 1760) got the same
treatment for consistency, renumbering its trailing step to `4.` since it
already had a `1. Start the platform` step `install.sh` doesn't.

### Improvement 2 — centered banners

Added a POSIX `center_line()` helper to `install.sh`:
```sh
BOX_WIDTH=75   # columns between the ╔/╗ borders

center_line() {
    plain="$1"; styled="$2"
    text_len=${#plain}
    total_pad=$((BOX_WIDTH - text_len))
    [ "$total_pad" -lt 0 ] && total_pad=0
    left_pad=$((total_pad / 2))
    right_pad=$((total_pad - left_pad))
    printf '%*s%b%*s' "$left_pad" '' "$styled" "$right_pad" ''
}
```
Uses `${#plain}` (POSIX) on the *plain* (ANSI-free) text for the padding
math, and `printf '%*s'` (POSIX, width-from-argument) to build the spaces,
so the two color-coded titles stay centered as copy changes without
hand-counted spaces. `print_header()`'s "Bffless" title and
`print_web_bootstrap_banner()`'s "Bffless is running - finish setup in a
browser" title both now call `center_line`.

Measured before the fix (visible-text padding inside the 75-column inner
field, ANSI codes stripped):
- Header "Bffless" (len 7): lead 31 / trail 37 (diff 6 — left of true
  center).
- Banner title (len 46): lead 23 / trail 6 (diff 17 — noticeably right of
  where it should sit, matching the reported "renders right-of-center").

After the fix (measured programmatically from the harness's captured
output, ANSI-stripped, splitting on the `║` border chars):
```
text='Bffless'                                          lead=34 trail=34 diff=0
text='Bffless is running - finish setup in a browser'    lead=14 trail=15 diff=1
```
Both within the required ±1 tolerance (46 is even relative to a 75-wide
odd-remainder field, so a 1-space skew is the best achievable integer
split — not a bug).

## Verification (this feature)

### Syntax
```
$ sh -n install.sh setup.sh && echo OK
OK
$ dash -n install.sh && echo OK
OK
$ dash -n setup.sh && echo OK
OK
```

### Extended stub harness

Reused the existing offline harness
(`scratchpad/install-harness/run_case.sh`) unmodified in behavior, adding
one optional env var `STUB_TOKEN` (defaults to the harness's original fixed
token, so none of the 5 pre-existing cases changed output) so a case can
set the fake `ONBOARDING_TOKEN` to a specific value for assertions. Still
fully offline: stub `git`/`setup.sh`/`start.sh`, no docker, no real
`setup.sh`/`start.sh` execution. (The only live network call is
`install.sh`'s own pre-existing best-effort `curl` to `api.ipify.org` for
IP detection — unchanged, non-mutating, already an accepted part of the
harness per the original report.)

**Re-ran all 5 original cases — byte-identical argv/exit-code behavior to
before this change** (no regression from the banner/centering edits):

| Case | args | setup.sh argv (argc) | start.sh called | exit |
|---|---|---|---|---|
| 1 | (none) | `--bootstrap` (1) | yes | 0 |
| 2 | `--interactive` | (none) (0) | no | 0 |
| 3 | `--force --non-interactive` | `--force --non-interactive` (2) | no | 0 |
| a | (none), `setup.sh` exits 5 | `--bootstrap` (1) | no | 5 |
| b | `--interactive --force` | `--force` (1) | no | 0 |

**New case — `STUB_TOKEN=testtoken123`, no args:**
```
$ grep -c 'token=testtoken123' case-output.txt
2
```
Both the `https://<ip>/?token=testtoken123` and
`https://admin.<your-domain>/?token=testtoken123` lines present.

**New case — no `.env`/token written (fallback path):** confirmed no
`token=` anywhere in the output, "Open the setup wizard:" plain wording (no
claim-token step), and `⚠ Could not read ONBOARDING_TOKEN...` warning still
shown — the pre-existing fallback behavior, now also copy-consistent (the
"skips straight to account setup" / "paste the claim token above" lines
only appear when there's actually a token to reference).

**Centering assertion** (Python, ANSI-stripped, `case-output.txt`):
```
text='Bffless'                                          lead=34 trail=34 diff=0 centered_ok=True
text='Bffless is running - finish setup in a browser'    lead=14 trail=15 diff=1 centered_ok=True
```
Both diffs ≤ 1 (the required tolerance).

**`setup.sh` banner text**: since real `setup.sh` execution is out of
scope (docker/system side effects), the exact `printf` block from
`run_bootstrap_mode`'s "Next Steps" section was extracted into a standalone
snippet with `CLAIM_TOKEN=testtoken123` and the same color vars, then run
directly (`sh -n` clean, output inspected) — confirms the `?token=` is
correctly substituted into both the `admin.<your-domain>` and
`<server-ip>` lines and the conditional step-4 text renders as expected.

### Frontend
```
$ pnpm test -- ClaimStep
 Test Files  63 passed (63)
      Tests  673 passed (673)
$ pnpm --filter frontend exec tsc --noEmit
(clean, no output)
```
