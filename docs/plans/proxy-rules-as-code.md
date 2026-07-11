# Proxy Rules as Code — DX Plan

Status: **plan agreed — open questions resolved (§7), not implemented**
Tracking issue: [bffless/ce#446](https://github.com/bffless/ce/issues/446)
Date: 2026-07-11
Scope: CE backend, a new CLI/compiler package, `bffless/upload-artifact`, and authoring conventions in consumer repos (`bffless/apps`, `example-project`, …)

## 1. Problem

Proxy rule sets are authored and stored only in the database (admin UI / MCP). The
`*.proxy-rules.json` files checked into consumer repos (e.g.
`apps/studio/bffless/studio.proxy-rules.json`) are **manual dashboard exports** — backups that
drift the moment someone edits a rule live. Concretely:

- **No versioning.** `proxy_rules` / `proxy_rule_sets` have only `createdAt`/`updatedAt`;
  last write wins, no history, no rollback, no review.
- **Code trapped in JSON strings.** Studio's set is 39 rules with 23 `function_handler`
  steps — ~29 KB of JavaScript embedded as single JSON string values (largest single
  function: 7.6 KB). No syntax highlighting, no linting, no unit tests, unreadable diffs.
- **No idempotent deploy path.** `POST /project/:projectId/import` is create-only: re-importing
  the same file yields a second rule set named `… (Imported)` (`proxy-rule-sets.service.ts:346-355`).
  There is no "sync by name" — so CI cannot apply rules, and nothing keeps git and DB aligned.
- **Export is a frontend behavior, not an API.** The v2 export envelope is assembled
  client-side in `ProxyRuleSetsPage.tsx:100-159`; there is no server export endpoint a CLI
  or CI job could call.
- **CI only attaches, never applies.** `bffless/upload-artifact` attaches pre-existing sets
  by name/id to the deployed alias; the JSON files are referenced by no workflow. PR
  previews therefore share the production rule sets.
- **Cross-environment portability is partial.** Only pipeline-schema UUIDs are remappable on
  import (and only with explicit per-schema resolutions); secrets and `headerConfig.add`
  values are (correctly) stripped and must be re-provisioned by hand, silently.

## 2. Goals

1. Author rules in a git repo as **one file (or folder) per rule**, organized by URL path —
   filesystem conventions in the spirit of Next.js routing, without adopting Next.js.
2. **JavaScript handlers as real `.js` files** — lintable, testable, reviewable.
3. **Idempotent build-time deploy**: CI compiles the folder and syncs it to an instance;
   re-running is a no-op; the diff is visible in the PR.
4. **Adoption path for existing sets**: decompile a live set (or an existing export JSON)
   into the file layout with one command.
5. Git history becomes the version history (compensating for the DB not versioning rules).

Non-goals: SSR/rendering of any kind; replacing the admin UI or MCP authoring (they remain
first-class for quick edits and small projects); exporting secret values.

## 3. Design overview

Three layers, loosely coupled through the **existing export JSON as the wire format**:

```
  bffless/<set>/**  (authoring layout, git)
        │  bffless rules build          ← pure client-side compiler
        ▼
  bffless-proxy-rule-set JSON (v2/v3)   ← unchanged interchange format
        │  bffless rules push           ← new idempotent sync endpoint in CE
        ▼
  proxy_rule_sets / proxy_rules (DB)    ← runtime source of truth, as today
```

Because the compiler targets the existing export format, Phase 0 works against today's CE
(build → manual dashboard Import); the sync endpoint is what unlocks CI.

### 3.1 Directory layout (per rule set)

```
bffless/
  studio/                            # one directory per rule set
    ruleset.yaml                     # set metadata: name, description, environment
    schemas/
      projects.schema.yaml           # pipeline schemas referenced BY NAME (see 3.4)
      youtube-thumbnail.schema.yaml
    rules/
      api/
        uploads/
          youtube-thumbnail/
            post.rule.yaml           # POST /api/uploads/youtube-thumbnail
            [...path]/
              get.rule.yaml          # GET  /api/uploads/youtube-thumbnail/*
        feeds/
          remove/
            post/                    # directory form: rule with code files
              rule.yaml
              pick.fn.js             # function_handler source, a real JS file
```

Routing conventions (Next-ish, adapted to bffless `*` glob patterns):

- The path under `rules/` **is** the `pathPattern`; `[...name]/` maps to a trailing `*`
  segment; a mid-path `[name]/` maps to a single `*` segment.
- The filename gives the method: `get.rule.yaml`, `post.rule.yaml`, `any.rule.yaml`
  (multi-method rules set `methods:` in the manifest).
- **Escape hatch:** a manifest may declare `pathPattern:` explicitly, overriding the
  derived path (for patterns the filesystem can't express, and for gradual migration).
- **Ordering:** the compiler sorts by specificity (static segments > wildcards, longer
  prefixes first) and emits `order` deterministically; a manifest `order:` wins when set.
- Two shapes per rule, compiler accepts both: a **single file** (`post.rule.yaml`) for
  simple rules, or a **directory** (`post/rule.yaml` + code/template siblings) when the
  rule carries code.

### 3.2 Rule manifest

YAML (recommended; see open question Q1), with aggressive **default elision** — the compiler
injects today's boilerplate (`targetUrl: http://internal/pipeline`, `proxyType: pipeline`
when `pipeline:` is present, `stripPrefix`, `timeout`, flags), and the decompiler strips
values equal to defaults. A rule that exports today as ~30 lines of JSON becomes:

```yaml
# rules/api/feeds/remove/post/rule.yaml   → POST /api/feeds/remove
description: Remove a feed for the current user
pipeline:
  validators:
    - type: auth_required
      config: { allowApiKey: true }
  steps:
    - id: query
      handler: data_query_handler
      config:
        schema: feeds                 # by NAME, not UUID — resolved at sync (3.4)
        filter: { url: "{{request.body.url}}" }
    - id: pick
      handler: function_handler
      code: ./pick.fn.js              # $file reference — the core DX unlock
    - id: response
      handler: response_handler
      config: { status: 200, body: "{{{steps.pick}}}" }
```

`code:` (and, generally, any long string config such as `response_handler` bodies, email
templates, chat system prompts) accepts a relative file reference. The compiler inlines
file contents into the canonical JSON; the decompiler extracts them back out
(`*.fn.js` for function handlers, `*.hbs` / `*.md` / `*.txt` for templates by content type).

### 3.3 Function handlers as real files

`pick.fn.js` is exactly the string stored today — `function handler({ user, request, steps,
deployment, utils }) { … }` — so round-tripping is byte-faithful. On top of that:

- **Lint preset** shipped with the CLI: an ESLint flat config that mirrors the
  function-runner's `PROHIBITED_PATTERNS` (`function-runner.service.ts:78-97`) — no
  `require`/`import`/`process`/`Buffer`/`eval` — so sandbox violations fail locally
  instead of at runtime.
- **Test harness**: the CLI exports `runHandler(file, ctx)` which executes the file in a
  `node:vm` sandbox replicating the runner's exact globals and timeouts
  (`function-runner.service.ts:22-49, 250-333`), so handlers get plain Vitest unit tests.
- **Phase 3 — TypeScript + shared modules**: author `.fn.ts` with a `HandlerContext` type,
  and allow local imports between handler files; the compiler esbuild-bundles each entry
  to a single self-contained ES5-ish `function handler(...)` string (the sandbox forbids
  module systems, so bundling is the only way to share utilities across rules).

### 3.4 Portability: schemas by name, secrets by contract

- **Schemas:** the authoring format references pipeline schemas **by name**; field
  definitions live in `schemas/*.schema.yaml`. The compiler emits them as the export's
  `schemas[]` plus symbolic refs. The sync endpoint resolves name → UUID per target
  project: reuse if a schema with that name exists, create otherwise (auto, non-interactive
  — today's `ImportSchemaResolutionDto` flow requires explicit per-schema choices, which CI
  can't answer). Field drift between repo and target is reported in the sync response.
- **Secrets:** stay out of git, referenced as `{{secrets.NAME}}` exactly as today. The
  compiler statically collects every referenced secret name; sync verifies them against the
  target project's `project_secrets` and returns `missingSecrets[]` — CI can warn or fail
  (`--require-secrets`). Same treatment for `headerConfig.add`: the manifest writes
  `$secret: NAME` placeholders instead of values.

### 3.5 CLI — a `rules` command family in a single umbrella `bffless` CLI

Distribution requirement: a developer who has **never cloned any bffless repo** (someone who
grabbed the studio giveaway, or any CE self-hoster) must be able to run this. That means a
published npm package with a `bffless` bin, runnable with zero setup:

```bash
npx bffless rules build            # one-off, no install
pnpm add -D bffless                # or pinned as a devDependency in consumer repos/CI
```

Rather than a standalone `@bffless/rules-cli`, ship **one umbrella CLI** (`bffless` on npm,
proposed home: `repos/ce/packages/cli`, next to `packages/github-action`, so validation stays
close to the DTO source of truth). `rules` is the first command family; the same bin later
absorbs the other scriptable surfaces that today live only in the dashboard/MCP:

```
bffless rules …        # this plan
bffless secrets …      # set/list project secrets (fixes the silent missing-secret gap)
bffless schemas …      # pipeline schema pull/push
bffless deploy …       # CLI twin of upload-artifact for non-GitHub CI / local deploys
bffless logs …         # tail pipeline execution logs while developing rules
```

Config resolution shared by all subcommands: `--api-url`/`--api-key` flags →
`BFFLESS_API_URL`/`BFFLESS_API_KEY` env vars → a `bffless.config.json` (committable, no
secrets — instance URL + default project) next to the rule-set directory.

`rules` subcommands:

| Command | Purpose |
|---|---|
| `bffless rules build [dir]` | Compile layout → canonical export JSON (deterministic, sorted keys). |
| `bffless rules validate` | Manifest schema check + sandbox-lint of all `.fn.js` + dangling `$file`/schema/secret refs. |
| `bffless rules test` | Run handler fixtures through the vm harness. |
| `bffless rules pull <set> --decompile` | Live set (or an existing export JSON via `--from-file`) → file layout. **The migration/adoption command**, and the reconciliation path when someone edits in the admin UI. |
| `bffless rules diff <set>` | Compiled vs live; nonzero exit on drift (CI drift-check job). |
| `bffless rules push <set>` | Idempotent sync (needs the new endpoint). `--dry-run` prints the change plan; `--prune` deletes rules absent from git; `--name-suffix pr-42` for previews. |
| `bffless rules dev` (later) | Watch mode: rebuild + push to a dev instance on save. |

Auth: `X-API-Key`, same as everything else (`ApiKeyGuard` already covers these controllers).

## 4. CE backend work

1. **Server-side export endpoint** — `GET /api/proxy-rule-sets/:id/export`. Move the
   assembly logic (rules serialization, `collectSchemaIds` walk, `sanitizeHeaderConfigForExport`)
   from `ProxyRuleSetsPage.tsx:100-159` into the service; frontend and CLI both consume it.
   Small, independently shippable, fixes "export format is a frontend contract" on its own.

2. **Idempotent sync endpoint** — `PUT /api/proxy-rule-sets/project/:projectId/sync`.
   - Match the set **by name** (the existing `(projectId, name)` unique key); create if absent.
   - Match rules by **`(pathPattern, method)`** (the existing `(ruleSetId, pathPattern, method)`
     unique key): update changed (content-hash comparison for cheap no-ops), insert new,
     delete removed only when `options.prune` — default **off**.
   - Auto-resolve `schemas[]` by name (3.4); rewrite refs via the existing `remapSchemaIds`.
   - Body: `{ ruleSet, rules[], schemas[], options: { prune, dryRun } }`.
     Response: `{ created[], updated[], deleted[], unchanged[], schemaResolutions[],
     missingSecrets[], warnings[] }` — the `dryRun` plan is what CI posts as a PR comment.
   - Same guard/permission story as import (`ApiKeyGuard` + `contributor`), plus SSRF
     re-validation of `targetUrl`s (import currently skips what `ProxyRulesService.create`
     enforces — worth closing regardless).

3. **Source tracking + drift signal** — nullable `source` jsonb on `proxy_rule_sets`
   (`{ repo, path, gitSha, syncedAt, contentHash }`), written by sync. Admin UI and MCP
   show a "Managed from git (repo@sha)" banner on such sets; edits are allowed but warn
   "will be overwritten on next deploy — run `bffless rules pull` to keep this change".
   (A hard `locked` mode can come later if warnings prove insufficient.)

4. **Revisions (Phase 3)** — `proxy_rule_set_revisions` (set id, full snapshot jsonb,
   source metadata, capped at ~20 per set) written on every sync/import/edit, with
   `POST /:id/rollback/:revisionId`. Gives non-git users versioning too, and makes a bad
   deploy instantly reversible server-side.

## 5. CI integration

- **New sibling action `bffless/deploy-proxy-rules`** (rather than growing upload-artifact's
  input surface): inputs `path`, `api-url`, `api-key`, `prune`, `dry-run`, `name-suffix`.
  Runs build → validate → push, emits the change report as a step summary / PR comment.
  Deploy order in a workflow: **sync rule sets → upload artifact → attach by name** (attach
  stays upload-artifact's job and is already idempotent).
- **PR preview rule sets** — the headline feature this unlocks: previews currently share
  production rules. `deploy-proxy-rules` with `name-suffix: pr-42` pushes `studio-pr-42`,
  upload-artifact attaches it to the `pr-42` alias; a close-PR cleanup job deletes both.
  Full-stack previews: frontend *and* API changes reviewable per PR.
- **Drift check** — scheduled/`workflow_dispatch` job running `bffless rules diff`; replaces
  the "please remember to re-export from the dashboard" README instruction.
- **Fix in passing:** `@bffless/artifact-client` serializes `proxyRuleSetNames` as a
  comma-joined string which the deployments API rejects (`proxyRuleSetNames must be an
  array`) — every apps workflow carries a comment working around it with the legacy
  singular input. Fix the serialization and migrate workflows to the plural.

## 6. Phasing

| Phase | Deliverables | Depends on |
|---|---|---|
| **0 — Authoring format + compiler** | Layout spec; `build` / `validate` / `test` / decompile-from-file; lint preset + vm test harness. Pilot: decompile **reader** (13 rules, 21 fn steps — small but function-heavy), verify byte-faithful round-trip against its export JSON, then studio. Deploy remains manual dashboard Import. | nothing (CE untouched) |
| **1 — CE sync surface** | Server export endpoint; sync endpoint with schema-by-name + change report; `source` tracking + UI/MCP banner; CLI `pull` / `push` / `diff` wired to them. | Phase 0 format |
| **2 — CI** | `bffless/deploy-proxy-rules` action; apps repo converts studio + reader (delete the raw JSON backups); PR-preview rule sets + cleanup; drift-check job; artifact-client plural fix. | Phase 1 |
| **3 — Polish** | Revisions + rollback; TS handlers + esbuild bundling of shared utils; `rules dev` watch mode; docs-public guide + a `bffless:rules-as-code` skill. | Phases 1–2 |

## 7. Decisions (resolved 2026-07-11)

- **Q1 Manifest format** — **YAML.** (A TS `defineRule()` layer can come later as sugar that
  emits the same YAML/JSON; not in scope.)
- **Q2 Route derivation** — **filesystem-derived paths with the `pathPattern:` escape hatch**,
  as specced in §3.1.
- **Q3 Prune semantics** — **opt-in `--prune`**; sync never deletes rules by default, even for
  git-managed sets.
- **Q4 Committed build artifact** — **commit the compiled export JSON during Phases 0–1**
  (lockfile-style, preserves today's "backup JSON" property and eases dashboard Import), then
  drop it once Phase 2 CI deploys are the norm.
- **Q5 CLI packaging** — **one umbrella `bffless` CLI, home `repos/ce/packages/cli`**, `rules`
  as the first command family (§3.5). Publish unscoped `bffless` on npm if the name is
  claimable, else `@bffless/cli` with a `bffless` bin. Open sub-questions: npm name
  availability, and whether `@bffless/artifact-client` becomes an internal dependency of it
  (recommended) or stays parallel.

## 8. Risks

- **Round-trip fidelity** is the make-or-break invariant: `pull` → `build` must reproduce
  the live set exactly (modulo key order). Mitigate with a golden-file test that round-trips
  the three real exports in `bffless/apps` from day one.
- **Two-writer drift** (admin UI/MCP vs git) is inherent; the `source` banner + `diff` CI
  job + `pull` reconciliation manage it, but the team norm has to become "edit in git for
  managed sets".
- **Schema auto-resolution by name** can silently bind to a same-named schema with different
  fields; the sync response must surface field mismatches as warnings (or failures with
  `--strict-schemas`).
- **Sync atomicity**: apply per-set changes in a transaction so a failed push can't leave a
  half-updated set serving traffic.
