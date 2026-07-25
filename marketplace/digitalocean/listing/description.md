# BFFless CE

BFFless CE is a self-hosted platform for static hosting with backend-for-frontend
superpowers: deploy static sites from CI in seconds, then add dynamic behavior —
API proxying without CORS, no-code backend pipelines, data tables, AI chat,
auth — without running your own backend.

**Highlights**

- **Deploy from CI in seconds** — a GitHub Action uploads your build; every
  commit gets an immutable URL, aliases (production/staging/pr-N) move freely
- **Proxy rules** — forward `/api/*` to any backend without CORS pain
- **Pipelines** — no-code backend handlers: forms, uploads, webhooks, scheduled jobs
- **Data tables + `use-bff-state`** — server state for React apps without a server
- **Auth built in** — cookie sessions, roles, per-folder access control
- **Cloudflare-first SSL** — recommended path uses Cloudflare's free CDN/WAF in front

**This 1-Click app**

Boots ready to configure: on first boot the droplet creates swap (on small
droplets), generates per-droplet secrets, and starts all services. Open
`https://<your-droplet-ip>/` and finish setup in the browser — no SSH required.
Lifecycle scripts (`status.sh`, `update.sh`, `backup.sh`, `logs.sh`,
`restart.sh`) come standard.

Runs on 1 GB droplets (2 GB recommended). Docs: https://docs.bffless.dev
