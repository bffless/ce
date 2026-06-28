# API key mints a custom-domain session, not a SuperTokens session

**Status:** proposed

## Context

Headless automation (notably Sandcastle, which drives an app on a **`localhost`** Vite dev server via Playwright) holds a project `X-API-Key` but cannot authenticate the *browser*: the key authenticates the `/api/*` data layer, not a user session, so login-gated SPA routes never render. We want the key to mint a browser session.

## Decision

Add `POST /_bffless/auth/session-from-key`, guarded by `ApiKeyGuard`. It mints a **custom-domain `bffless_access` + `bffless_refresh` cookie pair** (a self-signed CE JWT) for the key's owner — *not* a SuperTokens `sAccessToken` session. It reuses the existing relay machinery (`resolveGatedProject` → `getRequestHost` → `issueDomainSession`); the only change from the password `signin` handler is that identity comes from the key's owner instead of `EmailPassword.signIn`.

**Authorization:** any project key may mint, and the minted session carries the key owner's *actual* project role — no elevation, no new per-key flag. "session-from-key" is exactly "log in as the key's owner, without their password." This is acceptable because the key *already* authenticates the `/api/*` data layer as that owner, so a same-owner browser session is escalation *within the same trust boundary*, not across one. We explicitly rejected a per-key `canMintSession` flag as unnecessary schema/UI weight given that framing.

## Considered Options

- **SuperTokens `sAccessToken` path** — rejected. The actual consumer runs on `localhost`, which is **cross-origin to the primary domain**, so a `.<primary>`-scoped SuperTokens cookie can never reach it. `sAccessToken` is structurally impossible here.
- **Seed a reusable cookie — no CE change.** Register `localhost` as a custom domain, log in once via the existing password relay, and inject the resulting `bffless_access` / `bffless_refresh` into the headless browser (Playwright `storageState` / `addCookies`). This works today with zero backend code and stays the no-code path for *manual* local testing. Rejected as the *autonomous* answer: it seeds a fresh sandbox with a long-lived bearer cookie (or a service-account password) — the exact "credential juggling" we're removing, and *less* manageable than the revocable, scoped API key the sandbox already holds. Choosing the endpoint means the sandbox carries **one** secret, not two.

## Consequences

- **No SuperTokens coupling.** `bffless_access` is verified with the CE `jwtSecret` (HS256), independent of SuperTokens. The issue's "refresh-token rotation interplay" concern does not apply.
- **Authorization gap to respect:** the strict `SessionAuthGuard` does **not** honor `bffless_access` (only `OptionalAuthGuard`, the proxy data layer, and the relay `/session` check do). Fine for SPA gating + the API-key proxy data layer; any endpoint behind `SessionAuthGuard` stays unreachable to a key-minted session.
- **Operational preconditions** (must be documented for consumers): the `localhost` host must be registered as a custom-domain mapping for the project, and the dev proxy must forward `X-Forwarded-Host` as that host (everything keys off it). Mint **before** first navigation, or the SPA's first session check 401s and triggers the benign SuperTokens-first refresh attempt.
