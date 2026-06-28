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
