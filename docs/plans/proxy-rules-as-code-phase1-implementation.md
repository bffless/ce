# Proxy Rules as Code — Phase 1 Implementation Plan

CE backend sync surface: server export endpoint (closes #448), idempotent sync endpoint,
`source` tracking + managed-from-git banner, CLI live `pull`/`push`/`diff`.

Companion to `proxy-rules-as-code.md` (§4 spec) and `proxy-rules-as-code-phase1-kickoff.md`
(status handoff). Branch: `feat/proxy-rules-phase1` off `main@469e35d`.

Date: 2026-07-11

## Resolved design decisions (operator, 2026-07-11)

1. **Sync secret handling — preserve live values.** An incoming empty-string
   `headerConfig.add` value means "keep whatever the live rule has". If the rule is new
   (no live value), store `''` and report the header name in `missingSecrets[]`. Non-empty
   incoming values overwrite. Content comparison ignores blanked values (a blank incoming
   value never makes a rule "changed").
2. **Drift policy — keep `source`, warn.** Manual dashboard/MCP edits to a git-managed set
   leave `source` intact; the UI warns edits will be overwritten on next deploy. Drift is
   detected by contentHash / `rules diff`, not by clearing state.
3. **Banner scope — UI banner + MCP field.** Frontend banner + edit warning; MCP includes
   `source` in proxy-rule-set tool responses (no bespoke MCP warning logic).
4. **Schema mismatch — warnings + opt-in strict.** Field mismatches on a name-reused schema
   always land in `warnings[]`; `options.strictSchemas: true` turns them into a 400 (the
   transaction guarantees no partial write). CLI exposes `--strict-schemas`.

## Ground truth & key facts

- **The CLI canonicalizer is the export-format reference**:
  `packages/cli/src/format/{types,canonical,defaults}.ts`. `RULE_KEY_ORDER` (18 keys,
  including `methods` — the #448 fix), `ENVELOPE_KEY_ORDER`, null/undefined stripping at
  structural levels only, `schemas` key omitted when empty.
- Backend already has `collectSchemaIds`/`remapSchemaIds` (`schema-refs.util.ts`) — the
  frontend's copies mirror them.
- `ProxyRulesService.getRulesByRuleSetId()` returns rules with **decrypted**
  `headerConfig.add`; `encryptHeaderConfigForStorage()` is the write-side counterpart.
- `sanitizeHeaderConfigForExport` currently exists **only in the frontend** — the backend
  needs its own (blank `add` values to `''`).
- Rule matching key: unique `(ruleSetId, pathPattern, method)`; `method` is nullable
  (NULLs distinct in PG — matching logic must treat `null`/absent consistently).
  Set matching key: unique `(projectId, name)`. Schemas: unique `(projectId, name)`.
- DB rule defaults (import parity): `stripPrefix:true, order:i, timeout:30000,
  preserveHost:false, forwardCookies:false, internalRewrite:false,
  proxyType:'external_proxy', isEnabled:true, debugEnabled:false, targetUrl:''`.
- **Sync must regenerate nginx** — unlike import (fresh sets are unattached), a synced set
  may be attached to live aliases. `NginxRegenerationService.regenerateForRuleSet(ruleSetId)`
  exists and does exactly this. Call after a non-dryRun sync that changed anything.
- SSRF gap: import skips the `IsValidTargetUrlOrPath` validation that
  `ProxyRulesService.create` enforces. The sync DTO must apply it per rule.
- `db.transaction` precedent: `traffic/blocklist.service.ts`, `deployments/deployments.service.ts`.
- Secrets interpolation (`{{secrets.NAME}}`) is a pipeline-execution concept
  (`pipelines/execution/expression-evaluator.ts`); `project_secrets` has unique
  `(projectId, name)`. `missingSecrets[]` = referenced names with no matching secret row.
- MCP tools: `apps/backend/src/mcp/tools/proxy-rules.tools.ts`.
- CLI stubs to replace: `packages/cli/src/commands/pull.ts:32` errors with
  "live pull requires a server export endpoint (Phase 1)". `push`/`diff` don't exist yet.
  CLI config (`.bffless/config.json`): `{ apiUrl?, project?, ruleSets? }`.
- Backend tests are Jest (`cd apps/backend && pnpm test`); CLI tests are in
  `packages/cli` (`pnpm test` there); frontend is Vitest.

## Cross-cutting definitions

**Canonical rule serialization (server)**: emit keys in `RULE_KEY_ORDER`, dropping
`null`/`undefined` at the rule top level (nested config objects pass through verbatim).
This matches the CLI's `canonicalizeRule` on the wire.

**contentHash**: sha256 hex over `JSON.stringify` of the defaults-normalized, canonically
key-ordered `{ ruleSet: {name, description?, environment?}, rules: [...] }` of the synced
payload (schemas excluded — they're project-level; secrets excluded by construction since
exports blank them). Computed server-side at sync time, stored in `source.contentHash`.
Documented so `rules diff` / CI can reproduce it later if useful; Phase 1 diff uses
`exportsEquivalent`, not the hash.

**Sync response shape** (also the dryRun plan):

```jsonc
{
  "ruleSetId": "…",            // null on dryRun-create
  "created": [{ "pathPattern": "/api/x", "method": "GET" }],
  "updated": [{ "pathPattern": "/api/y", "method": null }],
  "deleted": [],                // only non-empty when options.prune
  "unchanged": [{ "pathPattern": "/api/z", "method": "POST" }],
  "pruneCandidates": [],        // live-only rules NOT deleted because prune=false
  "schemaResolutions": [{ "name": "comments", "action": "reuse" | "create", "targetSchemaId": "…|null", "fieldMismatch": false }],
  "missingSecrets": ["OPENAI_API_KEY"],
  "warnings": ["…"],
  "dryRun": false,
  "setCreated": false
}
```

## Process

Subagent-driven, mirroring Phase 0: a **fresh implementer subagent per task** (TDD: tests
first, then code, run the suite), an **independent adversarial review subagent per task**
(reviews the diff with intent to refute correctness/completeness), fixes applied before
moving on, and a **final whole-branch review**. The orchestrator arbitrates and keeps this
doc's checkboxes current.

Operator constraints: no commit/push without explicit approval; `db:generate`/`db:migrate`
are interactive and operator-run (Task 4); the agent edits the schema file and reviews the
generated SQL.

Task order is dependency order. Tasks 1–3 are the export track (shippable alone, closes
#448). Task 4 is a tiny schema edit whose interactive migration can be generated any time
before merge — it does not block 5–7 (backend unit tests mock the DB). Tasks 5–7 are the
sync track. Task 8 is UI/MCP. Task 9 is the CLI. Task 10 is the final review.

---

## Task 1 — Backend export-format module (pure functions)

**Files**: new `apps/backend/src/proxy-rules/export-format.util.ts` + `.spec.ts`.

Pure helpers, no DB:

- `sanitizeHeaderConfigForExport(headerConfig)` — blank every `add` value to `''`;
  pass `forward`/`strip` through; `null`/`undefined` in → `undefined` out.
- `serializeRuleForExport(rule)` — DB row → exported rule: pick the 18 `RULE_KEY_ORDER`
  keys in order, drop `null`/`undefined` at rule top level, run headerConfig through the
  sanitizer. Nested objects (`pipelineConfig`, `authTransform`, …) verbatim.
- `buildExportEnvelope({ ruleSet, rules, schemas, exportedAt })` — v2 envelope in
  `ENVELOPE_KEY_ORDER`; `ruleSet` keys `{name, description?, environment?}` stripped of
  null/undefined; `schemas` key omitted when empty.

**TDD**: spec first — key order (assert via `Object.keys`), `methods` included when set
(#448 regression test), null stripping at structural levels only (a `null` inside a step
`config` survives), secret blanking, `schemas` omission, envelope key order.

**Done when**: spec passes; no imports from frontend; types locally defined or shared.

## Task 2 — Export endpoint + CLI-equivalence test (closes #448)

**Files**: `proxy-rule-sets.service.ts` (`exportRuleSet`), `proxy-rule-sets.controller.ts`
(`GET :id/export`), DTO in `dto/`, service spec.

- `exportRuleSet(id, apiKeyProjectId)` — load set (404 if missing), enforce the same
  authorization as `getById` (`enforceApiKeyProjectScope`), load decrypted rules via
  `getRulesByRuleSetId`, serialize via Task 1, `collectSchemaIds` over the serialized
  rules, fetch each schema (`{id, name, fields}`; skip silently if missing — parity with
  the frontend's tolerance), envelope with fresh `exportedAt`.
- Controller: `GET :id/export`, Swagger docs, same guard story as `getById`.
- **Equivalence test**: assert the server export is accepted verbatim by the CLI's
  canonicalizer contract. Preferred: import `exportsEquivalent`/`canonicalizeExport` from
  `packages/cli` in the backend spec (workspace devDependency). If Jest/ESM interop makes
  that painful, fall back to a golden-fixture test: a fixture set covering every rule field
  (incl. `methods`, pipeline rules with schema refs, header add secrets) whose expected
  canonical JSON was produced by the CLI's `stringifyExport` and committed under
  `apps/backend/test/fixtures/`. Either way the test must fail if a field is dropped
  (i.e. it would have caught #448).

**Done when**: endpoint returns the canonical envelope; equivalence test green; controller
spec covers 404 + happy path.

## Task 3 — Frontend consumes the export endpoint

**Files**: `apps/frontend/src/services/proxyRulesApi.ts`, `apps/frontend/src/pages/ProxyRuleSetsPage.tsx`,
frontend tests.

- Add an RTK Query (lazy) endpoint for `GET /api/proxy-rule-sets/:id/export`.
- `handleExport` fetches the envelope from the server, downloads it as
  `<safeName>.proxy-rules.json` (keep the filename + toast logic; counts come from the
  payload). Delete the client-side assembly (`collectSchemaIds` walk, per-rule mapper,
  `sanitizeHeaderConfigForExport`) and any now-unused frontend copies of those helpers —
  the export format ceases to be a frontend contract.
- Keep `ExportedProxyRule`/envelope types only where the import dialog still needs them.

**Done when**: export flows through the server; dead code removed; frontend tests +
`tsc --noEmit` pass.

## Task 4 — `source` column (schema edit now; interactive migration operator-run)

**Files**: `apps/backend/src/db/schema/proxy-rule-sets.schema.ts`, `dto/` response DTOs.

- Add nullable `source` jsonb: `{ repo?: string; path?: string; gitSha?: string;
  syncedAt: string; contentHash: string }` (typed via `.$type<ProxyRuleSetSource>()`).
- Expose `source` on `ProxyRuleSetResponseDto` / `ProxyRuleSetWithRulesResponseDto`.
- **Migration is interactive**: the operator runs `cd apps/backend && pnpm db:generate`
  (then `db:migrate`); the agent reviews the generated SQL. NEVER hand-write migration SQL.
- Unit tests mock the DB, so Tasks 5–7 proceed on the schema edit alone; the migration
  must exist before merge.

**Done when**: schema + DTOs updated, backend typecheck passes; migration generation
requested from the operator (tracked, not blocking).

## Task 5 — Sync plan computation (pure)

**Files**: new `apps/backend/src/proxy-rules/sync-plan.util.ts` + `.spec.ts`.

Pure function: `computeSyncPlan(liveRules, incomingRules, { prune })` →
`{ toCreate[], toUpdate[], unchanged[], toDelete[], pruneCandidates[] }`.

- **Match key**: `(pathPattern, method ?? null)`. Duplicate match keys in the incoming
  payload are a validation error surfaced by the caller (the DB unique key would reject
  them anyway — fail fast with a clear message).
- **Normalization before comparison**: apply the DB import defaults to the incoming rule
  (absent-means-default, same table as `importRuleSet`), and compare against the live row
  projected through Task 1's `serializeRuleForExport`-style canonical form so
  server-managed fields (`id`, timestamps, `ruleSetId`) never count.
- **Blank-secret semantics** (decision 1): an incoming `headerConfig.add` value of `''`
  compares equal to any live value for that header name, and on update the live value is
  preserved. A header name present live but absent from the incoming `add` map is a real
  change (removal). Non-empty incoming values compare/overwrite normally.
- `toDelete` = live-only rules when `prune`; otherwise they land in `pruneCandidates`.
- `order` changes count as changes (they affect evaluation order).

**TDD**: table-driven spec — creates/updates/unchanged/deletes/pruneCandidates; blank-vs-set
secret cases; default-vs-explicit equivalence (`timeout: 30000` vs absent); method
null-vs-string keying; order-only change; duplicate incoming keys → error.

**Done when**: spec passes; function is side-effect-free and DB-free.

## Task 6 — Non-interactive schema resolution by name

**Files**: `proxy-rule-sets.service.ts` (private helper) or new
`schema-sync.util.ts` + service glue; specs.

`resolveSchemasByName(projectId, schemas, { strictSchemas, dryRun }, …auth)` →
`{ idMap, resolutions, warnings }`.

- For each bundled schema `{id, name, fields}`: if a project schema with that `name`
  exists → `action:'reuse'`, map `sourceId → existing.id`; compare `fields` (by field
  `name` + `type` + `required`, order-insensitive) — mismatch appends to `warnings[]`
  with a precise message, and under `strictSchemas` the whole sync fails 400.
- Missing → `action:'create'`. **Under `dryRun`, do not create** — report the plan with
  `targetSchemaId: null`. (Live sync creates via `pipelineSchemasService.create` with the
  exact name — no auto-suffixing; the name is the identity, unlike import.)
- No interactive `ImportSchemaResolutionDto` choices anywhere in this path.

**TDD**: reuse (identical fields), reuse (mismatched fields → warning; strict → throws),
create, dryRun-create (no service call — assert with mock), mixed batch.

**Done when**: spec passes; behavior matches decision 4.

## Task 7 — Sync service + endpoint

**Files**: `proxy-rule-sets.service.ts` (`syncRuleSet`), controller
(`PUT project/:projectId/sync`), new DTOs (`SyncProxyRuleSetDto`,
`SyncProxyRuleSetResponseDto`), specs.

**DTO**: `{ ruleSet: {name, description?, environment?}, rules: SyncRuleDto[],
schemas?: {id, name, fields}[], options?: { prune?, dryRun?, strictSchemas? },
source?: { repo?, path?, gitSha? } }`. `SyncRuleDto` mirrors the import rule DTO **plus
`IsValidTargetUrlOrPath` on `targetUrl`** (closes the SSRF gap; import's laxness is
pre-existing and out of scope to change here).

**Service flow** (`syncRuleSet(projectId, dto, userId, userRole, apiKeyProjectId)`):

1. Project exists (404) + `requireProjectAccess(…, 'contributor', …)` — import parity.
2. Resolve schemas (Task 6) → `idMap`; `remapSchemaIds` over incoming rules.
3. Find set by `(projectId, name)`; absent → plan a create (`setCreated: true`).
4. Load live rules decrypted (empty for a new set); `computeSyncPlan` (Task 5).
5. Collect `{{secrets.NAME}}` references (regex over the JSON-stringified incoming rules),
   check against `project_secrets` names → `missingSecrets[]` (warning-level, never fatal).
   Also add new-rule blank header `add` names to `missingSecrets[]` (decision 1).
6. `dryRun` → return the full response with no writes at all (no set create, no schema
   create, no rule writes, no source stamp).
7. Otherwise, in **one `db.transaction`**: upsert the set (create, or update
   description/environment when changed), insert `toCreate` (defaults + encrypted headers),
   update `toUpdate` (preserving live header values where incoming is blank, encrypting
   fresh values), delete `toDelete`, stamp `source` (`{...dto.source, syncedAt: now,
   contentHash}`).
8. Post-commit: if anything changed, `nginxRegenerationService.regenerateForRuleSet(id)`
   (failure logged as warning in `warnings[]`, not a 500 — the DB state is committed).
9. Return the response shape above.

**Controller**: `PUT project/:projectId/sync`, `ApiKeyGuard` (class-level), Swagger.

**TDD**: service spec with mocked db/services — idempotency (second sync of same payload →
all `unchanged`, no writes, but `source` re-stamped), create-from-scratch, update+preserve
secret, prune on/off, dryRun writes nothing (assert on mocks), missingSecrets, strictSchemas
400 before any write, transaction rollback on mid-flight error, nginx called once on change /
not called when all unchanged. Controller spec: guard + happy path + validation error.

**Done when**: all specs pass; `pnpm test` (backend) green; response is byte-stable for CI
consumption.

## Task 8 — Managed-from-git banner (UI) + MCP `source` field

**Files**: frontend `ProxyRuleSetsPage.tsx` (+ the set detail/rules page), `proxyRulesApi.ts`
types; backend `mcp/tools/proxy-rules.tools.ts`.

- Frontend: sets with `source` show a banner/badge "Managed from git
  (`repo@shortSha`, synced `<relative time>`)". Opening an edit dialog / mutating a rule in
  a managed set shows the warning "This set is managed from git — manual edits will be
  overwritten on next deploy. Run `bffless rules pull` to keep this change." Edits stay
  allowed; `source` is never cleared (decision 2).
- MCP: include `source` in rule-set responses (list/get) so agents can see the managed state; no
  extra warning logic (decision 3).

**TDD**: frontend component tests (banner renders with/without `source`; warning shown);
MCP tool spec asserts `source` passthrough.

**Done when**: tests + `tsc --noEmit` pass on both apps.

## Task 9 — CLI live `pull` / `push` / `diff`

**Files**: `packages/cli/src/` — new `api/client.ts` (fetch wrapper), `commands/push.ts`,
`commands/diff.ts`, rework `commands/pull.ts`, `index.ts` wiring, tests.

- **Client**: base URL from `--api-url` flag > `BFFLESS_API_URL` env > config `apiUrl`;
  key from `--api-key` flag > `BFFLESS_API_KEY` env (never in config.json). Sends
  `X-API-Key`. Inject `fetch` for tests. Clear errors on 401/403/404.
- **Set resolution**: the API is UUID-addressed; resolve by listing
  `GET /api/proxy-rule-sets/project/:projectId` and matching `name`. `projectId` from
  config `project` / flag. If `project` holds a name rather than a UUID, resolve via the
  projects list endpoint (implementer: check `projects` controller for the right call) —
  error messages must say exactly what was tried.
- **`rules pull <set-name>`**: resolve → `GET :id/export` → existing `decompileExport` /
  `writeDecompiled` (keep `--from-file` path working; `--decompile` stays default-on
  semantics for live pulls — live pull always decompiles).
- **`rules push [dirs…]`**: `build` in-memory → optional `--name-suffix pr-42` (rename
  `ruleSet.name` to `<name>-pr-42`) → attach `source` metadata (repo from
  `GITHUB_REPOSITORY` env or `git remote get-url origin`; gitSha from `GITHUB_SHA` or
  `git rev-parse HEAD`; path = rule-set dir relative to repo root; all best-effort) →
  `PUT project/:projectId/sync` with `--dry-run`, `--prune`, `--strict-schemas` flags →
  print the change report (created/updated/deleted/unchanged counts + lists,
  pruneCandidates, missingSecrets, warnings). Exit non-zero on HTTP error or strict
  failure; missingSecrets is a warning, exit 0.
- **`rules diff [dirs…]`**: build local + fetch live export → `exportsEquivalent` →
  print diffs, exit 1 on drift, 0 on clean (CI contract).
- Replace the Phase-1 stub error in `pull.ts`.

**TDD**: client tests (headers, error mapping) with injected fetch; command tests with a
stubbed client — pull happy path, push dry-run report rendering, push name-suffix, diff
exit codes. Reuse Phase 0's fixtures.

**Done when**: `pnpm test` in `packages/cli` green; `bffless rules pull|push|diff --help`
accurate; stub error gone.

## Task 10 — Final whole-branch review + verification

- Independent adversarial review of the entire branch diff vs `main` (fresh subagent, no
  implementation context): correctness, the four decisions honored, #448 actually fixed,
  SSRF validation present, transaction + nginx regeneration correct, no secret leaks in
  exports or logs, no drive-by regressions to import/copy.
- Verification: backend `pnpm test`, frontend tests, `packages/cli` tests, both
  `tsc --noEmit` typechecks. Exercise an end-to-end flow if feasible (backend up locally,
  real export→decompile→build→push round-trip).
- Review the operator-generated migration SQL (Task 4) before merge.
- Update the kickoff doc's status section; note the follow-ups (Phase 2 CI action, reader
  conversion, revisions in Phase 3).

## Status

- [x] Task 1 — export-format module (`f2e20ba`; canonical sorting added post-review in `ad2c7e6`)
- [x] Task 2 — export endpoint + equivalence test (#448) (`ad2c7e6`; CLI-import route via Jest moduleNameMapper)
- [x] Task 3 — frontend export switch (`e0333c3`)
- [x] Task 4 — `source` schema edit + DTO (`0114ce9`, `3346e3d`) + operator migration `drizzle/0038` (`7f8561e`)
- [x] Task 5 — sync plan computation (`8d4e19f`; post-review: add-null guard, CLI-parity proxyType/targetUrl inference, methods [] ≡ null)
- [x] Task 6 — schema resolution by name (`8a93dc2`; post-review: duplicate-id rejection, strict-under-dryRun pinned)
- [x] Task 7 — sync service + endpoint (`c444819`; post-review: missingSecrets covers update-path blanks)
- [x] Task 8 — UI banner + MCP field (`039c390`; post-review: RuleEditorPage save-path warning)
- [x] Task 9 — CLI pull/push/diff (`ed754e2`; post-review: diff schema-id alignment, targetUrl ''-normalization, validator config {})
- [x] Task 10 — final whole-branch review + verify (fresh-context adversarial review of
      `origin/main...HEAD`; verdict "fix-first, then ship" — both fixes taken: fail-loud
      guard on duplicate live `(pathPattern, null)` match keys from methods-split rules,
      and `methods: []` dropped at export so it can't become push-unfixable diff drift.
      Verification: backend 1659 passed / 107 suites, frontend 469 / 42 files,
      CLI 298 / 20 files, all three `tsc --noEmit` clean.)

## Known limitations (Phase 1, documented not fixed)

- **Methods-split sets can't sync yet.** Two live rules sharing `(pathPattern, method:
  null)` and differing only by `methods[]` are legal (PG unique index treats NULLs as
  distinct) but the sync/diff match key can't address them; sync now fails loudly (400)
  instead of silently overwriting one variant. Phase 2: fold a methods signature into
  the match key.
- **Set metadata is not declarative.** Sync writes `description`/`environment` only when
  provided — removing one from `ruleset.yaml` preserves the live value, and `rules diff`
  will keep reporting that drift. Workaround: set the field explicitly (empty string) or
  edit once in the dashboard.
- **`source.contentHash` is intra-project only** — it covers remapped schema ids, so it
  is stable within a target project but not reproducible from the git payload alone.
  Phase 1 drift detection uses `exportsEquivalent`, not the hash.
- **Pre-existing, filed as follow-up:** `copy()` inserts decrypted `headerConfig` without
  re-encrypting (plaintext at rest for copies) — present on `main`, not a Phase 1
  regression.
