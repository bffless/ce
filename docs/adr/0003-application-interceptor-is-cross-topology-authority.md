# The application interceptor is the cross-topology authority for bot handling and request observation

Bot handling and request observation are owned by a NestJS application-level interceptor — the one layer that behaves identically whether CE runs via docker-compose (nginx is the edge) or on GKE (Cloud LB + Cloud Armor + Traefik are the edge, and the workspace nginx ships an empty `$block_scanner` stub). The nginx edge drop is treated as an optimization in front of this authority, not a separate policy. The Request log is sourced from the interceptor and is admin-global (cross-project), not project-scoped.

## Why

Edge behaviour diverges sharply by host: docker-compose has a full nginx blocklist and a local access log; GKE has no working nginx blocklist (so scanners reach the app and hit 404s today) and its access logs live in Cloud Logging / TimescaleDB, collected from Traefik, not the workspace nginx. Any scheme rooted at the edge would behave differently per host — the opposite of the requirement that the admin panel work the same everywhere. The application is the only layer every request reaches in every topology, so it is the only place a consistent policy and a consistent log can live.

This also reframes the originally-imagined "catch-all pipeline route that calls `next()`": it is framework **middleware**, not a project-scoped proxy rule (proxy rules are project-scoped, first-match-wins, and always terminate — they cannot express a global observe-then-continue).

## Consequences

- The interceptor's response policy: serve matched requests normally; answer Unmatched-but-not-blocklisted with a generic 404 (fixing the current leak of internal paths like `sites/landing/dist/backend/.env`); refuse blocklisted requests that slip past the edge with a bare 403.
- Request log: live view streams all app-observed requests ephemerally (access-log-formatted); only Unmatched + blocked requests are persisted (retained + row-capped) alongside a per-IP rollup. The rollup + an admin-global read API are the surface a future Cloudflare-IP-feed (an external app or a pipeline in a dedicated admin project) consumes.
- This is deliberately *not* the platform's TimescaleDB/Vector analytics pipeline; that stays an ops/billing concern. CE owns its own consistent request log so behaviour does not depend on host.
