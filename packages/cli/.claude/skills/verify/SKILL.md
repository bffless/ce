---
name: verify
description: Verify a change to the bffless CLI (packages/cli) by driving the built binary against a stub backend.
---

# Verifying a `packages/cli` change

The CLI's surface is the terminal. Verification = run `dist/index.js` and read what it prints.
The live commands (`pull`/`push`/`diff`/`revisions`/`rollback`/`dev`) all talk to the backend
over HTTP, so a stub HTTP server is enough — no Postgres, MinIO, or backend needed.

## Build

```bash
cd packages/cli
pnpm install   # a fresh git worktree has no node_modules; ~7s from the pnpm store
pnpm build     # tsc -> dist/index.js  (the `bin`)
```

`pnpm build` is required after every source edit — `dist/` is what the `bffless` bin runs.

## Drive

```bash
node dist/index.js rules revisions <set-name> \
  --api-url http://127.0.0.1:8791 --api-key testkey --project <uuid|owner/name|name>
```

`rules revisions` is the cheapest command that exercises the full resolve chain
(project → rule set → request), so it's a good probe for anything in `src/api/`.
Auth/URL/project all have flags, so no `.bffless/config.json` is needed.

## Stub backend

Stand up a `node:http` server that answers the endpoints the command walks, and **log every
request** — the request path is usually the thing you're actually verifying:

| Endpoint | Shape | Note |
|---|---|---|
| `GET /api/projects` | `[{id, owner, name}]` | **creator-scoped** (`projects.createdBy`) — only projects the key's user created |
| `GET /api/projects/:owner/:name` | `{id, owner, name}` | **access-scoped** (`RequireProjectRole('viewer')`) — works for any member |
| `GET /api/proxy-rule-sets/project/:projectId` | `{ruleSets: [{id, name}]}` | |
| `GET /api/proxy-rule-sets/:id/revisions` | `{revisions: [{id, createdAt, trigger, ruleCount, current}]}` | |

Gotchas that cost time:

- **A missing project is HTTP 400, not 404.** `ProjectPermissionGuard` catches the service's
  NotFound and rethrows `BadRequestException('Project not found')`. Treat 400 and 404 alike;
  403 is the distinct "exists but no role" case.
- `formatRevisionsTable` indexes every cell unguarded, so a stub revision missing `trigger` or
  `ruleCount` dies with `Cannot read properties of undefined (reading 'length')`. That's the
  stub, not the CLI.
- To show a fix *does* something, run the same command against the same stub with the old file
  (`git show HEAD:packages/cli/src/api/foo.ts > src/api/foo.ts`, rebuild, run, restore, rebuild).

## Don't

Don't `pnpm vitest` as verification — CI does that. Don't import from `src/` and call the
function; the resolver's behaviour (which URL it hits) is only observable at the binary.

## Shell notes (zsh)

- `pkill -f stub-backend.mjs` **kills your own shell** (the pattern matches the command line).
  Use `fuser -k 8791/tcp`.
- zsh doesn't word-split unquoted vars, so `B="node dist/... "; $B --flag` fails with
  "no such file or directory". Use a shell function.
