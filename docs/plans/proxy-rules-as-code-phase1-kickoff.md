# Proxy Rules as Code — Phase 1 Kickoff & Status Handoff

Status doc for resuming after a context clear. Phase 0 is shipped; this doc is the
starting point for **Phase 1 (CE backend: export + sync endpoints)**.

Date: 2026-07-11

## Where things stand

**Phase 0 — DONE, merged.**
- The `bffless` CLI (`packages/cli`) shipped in **bffless/ce#449** (commit `469e35d` on `main`):
  a compiler/decompiler between a file-per-rule authoring layout and the existing
  `bffless-proxy-rule-set` v2 export JSON, plus a `node:vm` handler test harness
  (`bffless/harness`), an ESLint preset (`bffless/eslint`), and
  `bffless rules build | validate | test | pull --from-file`. 232 tests. No CE backend changes.
- The design doc is `docs/plans/proxy-rules-as-code.md` (merged in #447). §4 is the Phase 1 spec.
- The Phase 0 implementation plan + reader-pilot report are
  `docs/plans/proxy-rules-cli-phase0-implementation.md` and `…-phase0-pilot.md`.
- **Round-trip proven on real data:** the reader pilot decompiled reader's live export
  (13 rules, 21 handlers) and rebuilt it byte-faithfully (`exportsEquivalent` equal, 0 diffs,
  all 21 `function_handler` code strings identical).

**Reader pilot output — open PR, non-blocking.** bffless/**apps**#228 carries reader's
decompiled authoring layout (`apps/reader/.bffless/proxy-rules/reader/**`), additive
(the raw `reader.proxy-rules.json` backup is kept). It is a review artifact; the full
reader conversion is Phase 2. **Does not block Phase 1.** Leave open until Phase 2, or merge
as a reference — either is fine.

**Related bug — bffless/ce#448 (fold into Phase 1).** The frontend exporter silently drops
the `methods` field (`apps/frontend/src/pages/ProxyRuleSetsPage.tsx`, the `handleExport`
mapper ~lines 127-147 omits `methods` though the DB column, DTO, and the `ExportedProxyRule`
type all carry it). Fix it as part of the Phase 1 server-side export endpoint (task 1 below).

**Auth-proxy fix — already released**, unrelated to this work: bffless/ce#444, in release 0.1.105.

## Phase 1 scope (from design doc §4)

Four deliverables, in dependency order. Tasks 1–2 are the substance; 3 needs a DB migration;
4 wires the already-shipped CLI to the new endpoints.

### Task 1 — Server-side export endpoint (small, ship first; closes #448)
`GET /api/proxy-rule-sets/:id/export`. Move the export-envelope assembly out of the frontend
(`ProxyRuleSetsPage.tsx` `handleExport`, ~lines 100-181) into `ProxyRuleSetsService`; frontend
and the CLI both consume it. **Include the #448 fix** — emit `methods`.
- Envelope (v2, unchanged): keys `version:2, exportedAt, kind:'bffless-proxy-rule-set',
  ruleSet:{name,description?,environment?}, rules[], schemas?[]` (schemas key omitted when empty).
- Per-rule serialized fields (the CLI's `RULE_KEY_ORDER` is the reference, in
  `packages/cli/src/format/types.ts`): `pathPattern, method, methods, targetUrl, stripPrefix,
  order, timeout, preserveHost, forwardCookies, headerConfig, authTransform, internalRewrite,
  proxyType, emailHandlerConfig, pipelineConfig, isEnabled, debugEnabled, description`.
- `schemas[]` = `{ id, name, fields }` from `collectSchemaIds` walk; `sanitizeHeaderConfigForExport`
  blanks `headerConfig.add` values to `''` (secret stripping).
- **Verify against the CLI:** the CLI's `exportsEquivalent`/`canonicalizeExport`
  (`packages/cli/src/format/canonical.ts`) defines correct output; a good test is
  `exportsEquivalent(serverExport, cliRoundTrip)`.

### Task 2 — Idempotent sync endpoint (the real unlock)
`PUT /api/proxy-rule-sets/project/:projectId/sync`.
- Match the set **by name** (existing unique key `(projectId, name)`); create if absent —
  this replaces the create-only import (`proxy-rule-sets.service.ts:273-408`, which suffixes
  `… (Imported)` at ~345-355).
- Match rules by **`(pathPattern, method)`** (existing unique key
  `(ruleSetId, pathPattern, method)`): update changed (content-hash for cheap no-ops), insert
  new, delete removed **only when `options.prune`** (default off).
- Auto-resolve `schemas[]` **by name** per target project (reuse if a schema with that name
  exists, else create) — today's `ImportSchemaResolutionDto` needs explicit per-schema choices
  CI can't answer; sync must be non-interactive. Rewrite refs via `remapSchemaIds`.
- Body: `{ ruleSet, rules[], schemas[], options: { prune, dryRun } }`.
  Response: `{ created[], updated[], deleted[], unchanged[], schemaResolutions[],
  missingSecrets[], warnings[] }`. `dryRun` returns the plan without writing (CI posts it as a
  PR comment).
- Guard: `ApiKeyGuard` + `contributor` (same as import). **Add SSRF re-validation of
  `targetUrl`s** — import currently skips the `IsValidTargetUrlOrPath` check that
  `ProxyRulesService.create` enforces (gap at ~`:378`); close it here.
- **Transaction** per set so a failed push can't leave a half-updated set serving traffic.
- Collect `{{secrets.NAME}}` references, verify against `project_secrets`, return
  `missingSecrets[]`.

### Task 3 — Source tracking + drift banner (needs a migration)
- Nullable `source` jsonb on `proxy_rule_sets`: `{ repo, path, gitSha, syncedAt, contentHash }`,
  written by sync.
- **MIGRATION IS INTERACTIVE — the operator runs it, not the agent:**
  `cd apps/backend && pnpm db:generate` (after editing the schema file
  `src/db/schema/proxy-rule-sets.schema.ts`), then `pnpm db:migrate`. Do NOT hand-write SQL
  migrations (breaks Drizzle snapshots).
- Admin UI + MCP show a "Managed from git (repo@sha)" banner on such sets; edits warn
  "will be overwritten on next deploy".

### Task 4 — Wire the CLI to the endpoints
In `packages/cli` (already on `main`): implement live `rules pull` (from the export endpoint),
`rules push` (to the sync endpoint — `--dry-run`, `--prune`, `--name-suffix pr-42`), and
`rules diff` (compiled vs live, nonzero exit on drift). Auth via `X-API-Key`. These currently
error with "requires a server export endpoint (Phase 1)".

## Key grounding facts (so you don't re-derive them)

- **Export/import code:** frontend assembly `apps/frontend/src/pages/ProxyRuleSetsPage.tsx`
  (`handleExport` ~100-181); envelope types `apps/frontend/src/services/proxyRulesApi.ts:152-178`;
  import service `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts` (`importRuleSet`
  ~273-408); controller `…/proxy-rule-sets.controller.ts` (`ApiKeyGuard` class-level,
  `requireProjectAccess(…, 'contributor')`).
- **DB:** `apps/backend/src/db/schema/proxy-rule-sets.schema.ts` (set: unique `(projectId, name)`;
  no `source` column yet) and `proxy-rules.schema.ts` (rule: unique
  `(ruleSetId, pathPattern, method)`; defaults `stripPrefix:true, timeout:30000,
  preserveHost:false, forwardCookies:false, internalRewrite:false, isEnabled:true,
  debugEnabled:false, proxyType:'external_proxy'`). Schemas: `pipeline-schemas.schema.ts`,
  unique `(projectId, name)`.
- **Schema ref keys** (used by both the CLI and the backend's `schema-refs.util.ts`):
  `schemaId, persistMessagesSchemaId, persistConversationsSchemaId, conversationsSchemaId,
  messagesSchemaId`.
- **The CLI is the export-format reference.** `packages/cli/src/format/{types,canonical,defaults}.ts`
  encode exactly what a correct v2 export/round-trip looks like. When in doubt about a field or
  ordering, the CLI's canonicalizer is ground truth; make the server endpoint agree with it.
- **Handler-type strings** are the canonical union in `apps/backend/src/pipelines/types.ts`
  (`data_query`, `function_handler`, `response_handler`, `ai_handler`, …).

## How to run this

Use **superpowers subagent-driven-development** again (it worked well for Phase 0): write an
implementation plan (`docs/plans/proxy-rules-as-code-phase1-implementation.md`) with bite-sized
TDD tasks, then dispatch a fresh implementer per task + an independent adversarial review per
task + a final whole-branch review. Backend is Jest (`cd apps/backend && pnpm test`).

Work on branch **`feat/proxy-rules-phase1`** (already created off `main`@`469e35d`, where this
doc lives). Confirm `git log origin/main` still has #449 as an ancestor before starting.

## Operator constraints (from the repo CLAUDE.md)

- Never commit/push without explicit approval; never force-push; branch off `main`.
- `db:generate`/`db:migrate` are **interactive** — the operator runs them; the agent edits the
  schema file and reviews the generated SQL.
- Deploying to prod / touching live tenants / DB migrations are high-stakes — pause and confirm.
