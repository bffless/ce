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

- `bffless rules build [dirs...]` — compile an authoring rule-set directory to a canonical export JSON.
- `bffless rules validate [dirs...]` — validate an authoring rule-set directory.
- `bffless rules test [dirs...]` — run declarative handler fixtures (`*.fn.test.yaml`).
- `bffless rules pull --from-file <json> --decompile` — turn an export JSON into an authoring directory.
- `bffless rules push [dirs...]` — sync a compiled rule set to a live BFFless instance.
- `bffless rules diff [dirs...]` — compare a compiled rule set against what's live (exit `0` in-sync, `1` drift, `2` error — safe for CI).

Rule-set directories default to the nearest `.bffless/config.json`'s `ruleSets` glob array
when `[dirs...]` is omitted.

## Auth & config precedence

- API URL: `--api-url` > `BFFLESS_API_URL` env > `.bffless/config.json`'s `apiUrl`.
- API key: `--api-key` > `BFFLESS_API_KEY` env only (never read from config, so it's safe to commit).
- Project: `--project` > `.bffless/config.json`'s `project` (UUID, `owner/name`, or bare name).
  Prefer a UUID or `owner/name`: both resolve for any user with a role on the project. A bare
  name has to be matched against `GET /api/projects`, which lists only the projects the API
  key's user *created* — so it won't find a project that was merely shared with them.

`.bffless/config.json` (`{ apiUrl?, project?, ruleSets? }`) is discovered by walking up from
the current directory and is safe to commit — it never holds secrets.

## Docs

Full authoring-layout, manifest, and reference documentation: https://github.com/bffless/ce/blob/main/packages/cli/docs/reference.md
