# Dynamic bot blocklist via backend-regenerated per-domain server-block rules

The bot/scanner blocklist becomes admin-configurable at runtime. Instead of the static, image-baked `http`-level `map $request_uri $block_scanner` (`docker/nginx/blocklist.conf`), the backend compiles the admin-curated blocklist into **server-block `location` rules** (e.g. `location ~* ^/(\.env|wp-login|phpinfo\.php) { return 444; }`) injected into the per-domain configs it already generates into `sites-enabled/`, then triggers the existing nginx reload.

## Why not keep the `http`-level `map`?

An `http` `map` is marginally faster, but it **cannot be made dynamic on Kubernetes**: the GKE workspace nginx serves its `http` config from a read-only ConfigMap, nginx forbids redefining a `map`, and the only hot-reloadable include on both topologies is `sites-enabled/*.conf` (server blocks). Editing the map would require a pod restart — i.e. not dynamic. The per-domain `location` approach rides the config path that *already* hot-reloads on both docker-compose (inotify watcher) and GKE (the SIGHUP polling sidecar), so one mechanism serves both edges identically.

This also closes a live gap: GKE's `$block_scanner` map is currently an empty `default 0` stub, so **edge bot-blocking does not exist on GKE today** — which is why scanner requests (`/.env`, `/phpinfo.php`, …) reach the application and hit 404s there. Regenerating per-domain rules makes edge blocking work on GKE for the first time.

## Consequences

- Blocklists are a named, admin-global library attached to domains (like proxy rule sets attach to aliases), compiled per-domain. A code-shipped Baseline of universal scanner signatures applies to every domain by default under a master toggle. A domain's effective rules = Baseline + attached lists. The same compiled patterns also feed the application-level interceptor that handles anything reaching the app before/without an edge drop.
- Admin-supplied patterns are compiled into nginx config text, so they MUST be validated/escaped to prevent nginx-config injection: entries are structured `{matchType, value}`, metacharacter-escaped, and assembled into one anchored regex `location` per server block; the config is `nginx -t`-validated before reload.
- The static `blocklist.conf` http-map is retired in favour of generated rules.
