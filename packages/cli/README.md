# bffless

A CLI for authoring [BFFless](https://github.com/bffless/ce) proxy rule sets as **files in
git** instead of only through the admin UI/MCP. It compiles a directory of YAML manifests +
real `.js` handler files into the same `bffless-proxy-rule-set` export JSON the dashboard's
Import already understands, syncs that compiled output to a live instance, and ships a
`node:vm` test harness + ESLint preset for the handler code along the way.

## Install

```bash
npx bffless rules build          # one-off, no install
npm i -g bffless                 # global install
pnpm add -D bffless              # or pin it as a devDependency
```

## Commands

- `bffless rules init --schema <name> [dir]` — scaffold `schemas/<name>.schema.yaml` in a rule-set directory (schemas sync by name on push; no pre-created server id needed).
- `bffless rules build [dirs...]` — compile an authoring rule-set directory to a canonical export JSON.
- `bffless rules validate [dirs...]` — validate an authoring rule-set directory.
- `bffless rules test [dirs...]` — run declarative handler fixtures (`*.fn.test.yaml`).
- `bffless rules pull --from-file <json> --decompile` — turn an export JSON into an authoring directory.
- `bffless rules push [dirs...]` — sync a compiled rule set to a live BFFless instance.
- `bffless rules diff [dirs...]` — compare a compiled rule set against what's live (exit `0` in-sync, `1` drift, `2` error — safe for CI).

Rule-set directories default to the nearest `.bffless/config.json`'s `ruleSets` glob array
when `[dirs...]` is omitted.

## Authentication

Every server command needs an API key, resolved as: `--api-key` flag >
`BFFLESS_API_KEY` env > the login credential store. Keys are never read from
`.bffless/config.json` (it is committed to the repo).

One-time per machine + instance, store a key interactively:

    bffless login                       # instance from .bffless/config.json
    bffless login --api-url https://admin.example.com

`login` tells you where to create the key (admin UI → Settings → API Keys),
validates the pasted key against the instance, and saves it to
`~/.config/bffless/credentials.json` (mode 0600, keyed by instance URL — one
entry per instance).

    bffless auth status                 # list stored instances + validity
    bffless auth token                  # print the key (for scripts/agents)
    bffless logout                      # remove an instance's entry

Scripts and other tools can reuse the stored key without parsing anything:

    curl -H "X-API-Key: $(bffless auth token)" https://admin.example.com/api/projects

CI should keep using `BFFLESS_API_KEY` — env always beats the store.

## Auth & config precedence

- API URL: `--api-url` > `BFFLESS_API_URL` env > `.bffless/config.json`'s `apiUrl`.
- API key: `--api-key` > `BFFLESS_API_KEY` env > login credential store (see Authentication above; never read from config, so it's safe to commit).
- Project: `--project` > `.bffless/config.json`'s `project` (UUID, `owner/name`, or bare name).
  Prefer a UUID or `owner/name`: both resolve for any user with a role on the project. A bare
  name has to be matched against `GET /api/projects`, which lists only the projects the API
  key's user *created* — so it won't find a project that was merely shared with them.

`.bffless/config.json` (`{ apiUrl?, project?, ruleSets? }`) is discovered by walking up from
the current directory and is safe to commit — it never holds secrets.

## Docs

Full authoring-layout, manifest, and reference documentation: https://github.com/bffless/ce/blob/main/packages/cli/docs/reference.md
