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
