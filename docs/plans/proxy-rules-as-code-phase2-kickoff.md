# Proxy Rules as Code — Phase 2 Kickoff & Status Handoff

Status doc for resuming after a context clear. Phases 0 and 1 are shipped; this doc is
the starting point for **Phase 2 (CI: deploy action, apps conversion, PR previews,
drift check)**.

Date: 2026-07-12

## Where things stand

**Phase 0 — DONE, merged** (#449, `main@469e35d`): the `bffless` CLI in
`repos/ce/packages/cli` — compiler/decompiler for the file-per-rule authoring layout,
`node:vm` handler test harness, ESLint preset, `rules build | validate | test`.

**Phase 1 — DONE, merged** (#451, squashed to `main@e884652`, 2026-07-12). The CE sync
surface exists end to end:

- **`GET /api/proxy-rule-sets/:id/export`** — server-side canonical v2 envelope
  (byte-canonical per the CLI canonicalizer; secrets blanked; schemas bundled).
  Closed #448 (`methods` no longer dropped).
- **`PUT /api/proxy-rule-sets/project/:projectId/sync`** — idempotent, transactional:
  set matched by name (created if absent), rules matched by `(pathPattern, method)`,
  schemas resolved **by name** (mismatch → `warnings[]`, or 400 with
  `options.strictSchemas`), delete only with `options.prune`, `options.dryRun` returns
  the full change report with zero writes. Blank (`''`) header `add` values preserve
  the live secret. Response: `{ ruleSetId, created[], updated[], deleted[],
  unchanged[], pruneCandidates[], schemaResolutions[], missingSecrets[], warnings[],
  dryRun, setCreated }` (refs are `{pathPattern, method}`). Body also takes
  `source: { repo?, path?, gitSha? }`.
- **`source` tracking** — jsonb column (migration `drizzle/0038`) stamped on every live
  sync (`{...caller source, syncedAt, contentHash}`), kept on manual edits; dashboard
  shows a "Managed from git (repo@shortSha)" badge + edit warnings; MCP rule-set
  responses include `source`.
- **Live CLI** — `bffless rules pull <set-name>` (export → decompile),
  `rules push [dirs…]` (`--dry-run`, `--prune`, `--name-suffix pr-42`,
  `--strict-schemas`; best-effort source metadata from `GITHUB_REPOSITORY`/`GITHUB_SHA`
  or git), `rules diff [dirs…]` (**exit 0 in sync / 1 drift / 2 error — the CI
  contract**). Auth: `--api-key` flag > `BFFLESS_API_KEY` env (never config.json);
  URL: `--api-url` > `BFFLESS_API_URL` > `.bffless/config.json` `apiUrl`. Project:
  config `project` (UUID, `owner/name`, or bare name resolved via `GET /api/projects`).
- Implementation record (per-task commits, resolved design decisions, adversarial
  review results): `proxy-rules-as-code-phase1-implementation.md`.

**Known Phase 1 limitations** (documented, not bugs):
- Methods-split sets (two rules sharing `(pathPattern, method: null)` differing only by
  `methods[]`) **400 on sync** — fold a methods signature into the match key when it
  matters (could be a Phase 2 stretch item).
- Set `description`/`environment` are only written when provided (omission preserves the
  live value → `rules diff` reports it as drift until set explicitly).
- `source.contentHash` covers remapped schema ids → intra-project only; drift detection
  uses `exportsEquivalent`, not the hash.

**Open follow-ups:**
- **bffless/ce#452** — pre-existing: `copy()` stores decrypted header `add` values
  (plaintext at rest). One-line fix + optional data migration; labeled `ready-for-agent`.
- **bffless/apps#228** — reader's decompiled authoring layout (Phase 0 pilot artifact).
  Superseded by the real Phase 2 conversion; close or merge as reference when reader is
  converted.
- **Release/deploy**: the merge will be released by release-please as the next CE
  version. Live pushes only work against an instance running it — and CE deploys pin
  the image tag in `.env`, so the operator must bump + deploy before exercising the
  endpoints on a real instance.

## Phase 2 scope (from design doc §5 + §6)

1. **New sibling GitHub Action `bffless/deploy-proxy-rules`** (do NOT grow
   upload-artifact's input surface). Inputs: `path`, `api-url`, `api-key`, `prune`,
   `dry-run`, `name-suffix`. Runs build → validate → push; emits the change report as a
   step summary and PR comment. Model it on `repos/upload-artifact` (TypeScript,
   `@vercel/ncc` bundle to `dist/`, `runs: node20`, release-please, `@v1` pinning,
   Vitest). **Open question for the operator: how the action obtains the CLI** —
   publish `bffless` (or `@bffless/cli`) to npm per design-doc Q5 (name availability
   still unverified), vendor/bundle it into the action, or git-install from the ce
   repo. Decide before building.
2. **Convert the apps repo** — studio + reader get `.bffless/proxy-rules/<set>/**`
   authoring layouts (reader's exists in apps#228); workflows call
   `deploy-proxy-rules`; **delete the raw `*.proxy-rules.json` backups** (sources
   become the single source of truth). Deploy order: **sync rule sets → upload
   artifact → attach by name** (attach stays upload-artifact's job).
3. **PR-preview rule sets** — the headline: `deploy-proxy-rules` with
   `name-suffix: pr-42` pushes `studio-pr-42`; upload-artifact attaches it to the
   `pr-42` alias; a close-PR cleanup job deletes both (rule set delete is
   `DELETE /api/proxy-rule-sets/:id`, resolve by name via the list endpoint).
4. **Drift-check job** — scheduled/`workflow_dispatch` `bffless rules diff` per app;
   replaces the "re-export from the dashboard" README instruction. Exit 1 = drift.
5. **Fix in passing: `@bffless/artifact-client` plural serialization** —
   `proxyRuleSetNames` is sent comma-joined and rejected by the deployments API
   (`proxyRuleSetNames must be an array`); every apps workflow carries a workaround
   comment using the legacy singular input. Fix the client, migrate workflows to the
   plural. Lives in the upload-artifact/artifact-client repo.

## Key grounding facts (so you don't re-derive them)

- **Repos involved**: `repos/ce` (CLI lives in `packages/cli`; not published to npm
  yet), `repos/upload-artifact` (the reference action + `@bffless/artifact-client`),
  `repos/apps` (studio; monorepo the conversions land in), plus a **new repo**
  `bffless/deploy-proxy-rules` (creation is an operator step: gh repo create under the
  org). The reader app lives in `repos/apps` too (see apps#228 for its layout).
- **CLI wire types**: `packages/cli/src/api/sync-types.ts` mirrors the backend DTOs;
  `packages/cli/src/api/client.ts` is the injectable-fetch HTTP client the action can
  reuse if it bundles the CLI.
- **Workspace docs**: `/home/rico/bffless/CLAUDE.md` (repo map, operator rules),
  `repos/apps/README.md` + per-app `CLAUDE.md`, `repos/upload-artifact/README.md` +
  `action.yml` (input/output conventions to mirror).
- **CE endpoints** (all `ApiKeyGuard`; sync additionally requires `contributor`):
  list `GET /api/proxy-rule-sets/project/:projectId` → `{ruleSets:[…]}`;
  export `GET /api/proxy-rule-sets/:id/export`; sync `PUT …/project/:projectId/sync`;
  projects `GET /api/projects` (bare array with `id`/`owner`/`name`).

## Process & operator constraints (carry-overs + Phase 1 lessons)

- Subagent-driven development worked well twice: bite-sized TDD plan doc first
  (`docs/plans/proxy-rules-as-code-phase2-implementation.md`), fresh implementer per
  task, independent adversarial review per task, final whole-branch review. Ask the
  operator's open questions before writing the plan.
- **Ask before committing; never force-push; per-task commits can be pre-approved
  (worked well in Phase 1 — ask again).**
- **No local DB on this VPS** — never `db:migrate`/`dev:full`; backend tests mock the
  DB; migrations apply on deploy. (No CE schema changes expected in Phase 2 anyway.)
- **Parallel subagents share one working tree** — forbid `git stash / restore /
  checkout -- / reset` in every subagent prompt (one stash/pop incident in Phase 1);
  use `git show HEAD:<path>` for baseline reads. Commit each task before starting a
  task that touches the same files.
- Phase 2 spans multiple repos — run the session from `/home/rico/bffless` (the
  workspace root), and remember each repo under `repos/` is its own git repo.
- GitHub Actions can't be tested by running the workflow locally — unit-test the
  action's TS (Vitest, like upload-artifact) and verify `dist/` is rebuilt (ncc) before
  committing; GitHub runs `dist/`, not `src/`.
