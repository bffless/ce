# CE Domain Glossary

The ubiquitous language for Community Edition. A glossary, not a spec — define what terms *mean*, not how they're implemented.

## Authentication

The most-confused area is *which auth path a deployed app should use*, which is decided entirely by *which kind of domain the app is served from*.

**Primary domain**:
The single domain SuperTokens is configured against. Its auth cookies (`sAccessToken`) are valid on it and all of its subdomains.

**Subdomain**:
A host under the primary domain (e.g. `handoff.j5s.dev` under `j5s.dev`). Shares the primary domain's SuperTokens cookies — so apps here authenticate via the **SuperTokens session path**, not the relay.

**Custom domain**:
A cross-origin host that is *not* under the primary domain (e.g. `app.acme.com`, or **`localhost`** during local/automated testing). SuperTokens cookies cannot reach it, so apps here authenticate via the **admin login relay**, which mints its own cookie. `localhost` qualifying as a custom domain is why a local headless browser (e.g. Sandcastle's Playwright) gets a `bffless_access` cookie, never an `sAccessToken`.

**SuperTokens session path**:
Authentication via the `/api/auth/*` reverse proxy straight to SuperTokens. The correct path for the primary domain and its subdomains. Yields an `sAccessToken`.
_Avoid_: "the api/auth proxy"

**Admin login relay**:
Authentication via the `/_bffless/auth/*` endpoints, intended **only for custom (cross-origin) domains** where SuperTokens cookies can't reach. It mints a `bffless_access` cookie and adds custom-domain-specific behaviour on top. A common mistake (especially by code-gen) is defaulting to the relay without checking which domain the app sits on.
_Avoid_: "the _bffless endpoint", "bffless auth"

**sAccessToken**:
The SuperTokens session cookie. Valid on the primary domain and its subdomains.

**bffless_access**:
The relay-minted access cookie for a single custom domain. The relay's answer to "SuperTokens can't set a cookie here."

**Project API key**:
An `X-API-Key` credential scoped to one project, authenticating the data layer (`/api/*`, pipelines, proxy rules). It does **not**, today, produce a user session — that gap is the subject of issue #372.
_Avoid_: "the project key", "access key"

**App token**:
A member-bound, project-bound, scoped bearer credential (`Authorization: Bearer bfat_…`) the member mints in *Settings → App Tokens*, or an OAuth client obtains on the member's behalf. Wherever a session is accepted for content or pipelines — the deployment visibility gate, `auth_required` — the token *is* the member, narrowed by its scopes: effective permission is what the member may do ∩ what the token was granted, so a token never elevates. On the admin API it behaves as a project-scoped API key does (project-fenced, role pinned). Not an API key: an API key is pinned to role `user` and bound to no person.
_Avoid_: "personal access token", "PAT", "bearer" alone (a SuperTokens JWT is also a bearer)

**Scope**:
A `namespace:verb` string an app declares on its own rules (`auth_required` → `requiredScopes`) and an App token carries. CE only compares strings; the vocabulary is the app's (`workflow:read`, `workflow:run`, …). Sessions, custom-domain cookies and API keys are never scope-checked — a person acting as themselves is not a delegation.
_Avoid_: "permission" (that is the member's project role), "role"

**Bypass visibility**:
A per-rule opt-out of the deployment visibility gate (`bypassVisibility: true` in rules-as-code) for endpoints a caller reaches before it has any credential — OAuth discovery under `/.well-known`, a webhook receiver. The rule's own validators still run; internal rewrites are unaffected.
_Avoid_: "public rule" (deployment visibility is a different setting)

**Owner session**:
A browser session authenticated as the project owner, which login-gated SPA routes accept. The thing an automated client holding a Project API key currently cannot obtain.

## Bot protection & request observability

Admin-global (not project-scoped) concerns: refusing junk traffic and seeing what hits the instance. The guiding rule is that behaviour must not differ by where CE is hosted (docker-compose vs GKE) — see [[0002-dynamic-blocklist-via-regenerated-per-domain-rules]].

**Blocklist**:
A named, reusable set of request-path patterns (with its own allowlist of exceptions) that domains refuse to serve. Defined once in an admin-global library and attached to domains — the way a proxy rule set attaches to an alias. A domain's effective rules are the lists attached to it plus the Baseline.
_Avoid_: "scanner map", "444 list", "firewall rules"

**Baseline**:
The code-shipped set of universal scanner signatures (WordPress, phpMyAdmin, `.env`, …) applied to every domain by default under a single master toggle, improved on upgrade. The floor of bot protection that needs no per-domain wiring.
_Avoid_: "default blocklist" (it is not one of the named lists)

**Edge drop**:
Refusing a blocklisted request at nginx by closing the connection (HTTP 444) with no response body, so it never reaches the application. The cheap first line; an optimization over the application interceptor, not a separate policy.
_Avoid_: "ban", "block at the edge"

**Unmatched request**:
A request that resolves to no deployment, alias, or asset — what bot scans for `/.env` or `/wp-login` produce. Currently answered with a 404 (which leaks internal paths). The primary signal feeding the Blocklist.
_Avoid_: "404", "miss", "not found"

**Request log**:
The admin-global, cross-project record of requests the instance observed — especially Unmatched and blocked ones — used to discover bot activity and curate the Blocklist. A persisted, queryable concept owned by CE, distinct from nginx's raw access log.
_Avoid_: "access log" (that is nginx's raw artifact), "audit log"

**Application interceptor**:
The single cross-topology authority that observes every request reaching the app, records it to the Request log, and applies the Blocklist as a fallback. Consistent regardless of host, because requests reach the app in every topology.
_Avoid_: "catch-all pipeline", "fallback handler" (it is framework middleware, not a project-scoped proxy rule)

## Server video ops

Where ffmpeg work for an app runs. There are three peers, and "server" on its own is ambiguous — say which.

**Browser**:
ffmpeg (wasm) running in the person's own tab. Needs nothing from CE. The default an app falls back to when no server executor exists.
_Avoid_: "client-side", "wasm mode" (in user-facing text)

**Local server**:
ffmpeg spawned by the CE backend on the instance itself, subject to that box's memory, disk and single-slot queue.
_Avoid_: "server" alone, "in-process"

**Remote**:
ffmpeg run by a Worker that CE calls over HTTPS with signed storage URLs, so the bytes never pass through the instance. Cloud Run is the *reference deployment*, not the name — any host running the Worker image is Remote.
_Avoid_: "cloud run mode", "cloud"

**Server video ops**:
Local server and Remote together — everything that is not Browser. What the Features toggle switches on.

**Executor**:
The CE-side strategy that carries out an ffmpeg job: `local` or `remote`. An instance may enable both; the admin picks the default and a pipeline step or an app may ask for one explicitly.
_Avoid_: "backend" (overloaded), "runner"

**Worker**:
The stateless ffmpeg service CE calls when the executor is Remote. It knows nothing about ops or projects — it runs the argv it is given against the URLs it is given.
_Avoid_: "sidecar" (implies same pod), "ffmpeg service"

**Job envelope**:
The single request CE sends a Worker: kind, argv with named placeholders, signed input/output URLs, deadline and limits.
_Avoid_: "payload", "job spec"

**Capability probe**:
The `probe`-without-input result apps read to learn which executors exist and which is default. Additive over time; `server:true` means at least one executor is ready.

## Remote connections

Instance-level infrastructure for calling services CE itself owns, not third-party APIs. Generalises the Remote ffmpeg Worker's transport so any private service gets the same treatment.

**Remote connection**:
An admin-owned, named service URL + auth mode CE calls with its own identity (a minted Google ID token, or none on a private network), configured once (DB, or pinned via `REMOTE_CONNECTION_<NAME>_*` env) and referenced by name — from `remote_request` pipeline steps and from the ffmpeg Remote executor — rather than by a raw URL a step could point anywhere.
_Avoid_: "webhook target", "external API" (those are `http_request`'s domain, not this)

**Fuse**:
The per-connection in-flight ceiling: every caller of the same named connection — a `remote_request` step, the ffmpeg Remote executor — draws on one shared counter, so an admin's `max_inflight` actually bounds the connection, not just one caller of it. Fails fast (no queueing) once at capacity.
_Avoid_: "rate limit" (this is a concurrency ceiling, not a rate)

**`remote_request`**:
The pipeline step handler that calls a named Remote connection: resolves the connection, acquires its Fuse, sends the request with the connection's own identity, and always resolves with a step output (`ok`/`status`/`body`) rather than throwing on a non-2xx — a later step branches on the result.
_Avoid_: "the remote handler" (ambiguous with the ffmpeg Remote executor)

## Pipelines

**MCP handler**:
A pipeline step (`mcp_handler`) that answers as a stateless MCP server from its own config — tools and `ui://` resources mapped to Sibling rules of the same alias, executed in-process as the caller. App-agnostic: the app's rule set *is* the server; CE owns only the envelope. Not CE's own platform-admin MCP server (`@rekog/mcp-nest`, a different thing on a different path).
_Avoid_: "the MCP server" (ambiguous with the platform-admin one), "MCP endpoint" (the app's rule, not the handler)

**Sibling rule**:
Another rule of the same alias's effective rule sets, invoked in-process by `RuleInvokerService` with the caller's identity and the sibling's own validators (`auth_required`, `requiredScopes`, `rate_limit`) — never the deployment visibility gate twice, and never nested (a sibling that is itself an MCP handler is refused). How an MCP tool runs, and the runtime cousin of the `alias://` idea (#698).
_Avoid_: "internal call", "sub-pipeline"
