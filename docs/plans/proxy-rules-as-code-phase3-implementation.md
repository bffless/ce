# Proxy Rules as Code — Phase 3 Implementation Plan

> **For agentic workers:** execute with superpowers:subagent-driven-development — fresh
> implementer subagent per task, independent adversarial review per task, final
> whole-branch review per repo. Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 polish: server-side rule-set revisions + rollback (CE backend + CLI +
minimal UI), TypeScript handlers with esbuild bundling of shared utils, `rules dev` watch
mode, CI npm publish for the CLI (ce#459), a skills-as-synced-resources evaluation memo
(design §3.5), a docs-public guide, and a `bffless:rules-as-code` skill.

**Architecture:** Revisions are post-mutation snapshots of the existing `RuleSetExport`
envelope stored in a new `proxy_rule_set_revisions` jsonb table (cap 20/set, deduped by
content hash); rollback replays a stored envelope through the existing `syncRuleSet` path
with `prune: true`. TS handlers hook the compiler's two file-read points and bundle each
entry self-contained via esbuild (imports confined to the set dir, bundled output re-linted
against `PROHIBITED_PATTERNS`). `rules dev` is a chokidar loop over build → validate →
fn-tests with opt-in push to a dev-suffixed set.

**Tech stack:** NestJS + Drizzle (DB mocked in Jest — no local DB), TypeScript ESM CLI
(commander + zod + vitest), esbuild, chokidar, release-please, Docusaurus, plain-markdown
skills.

Companion docs: `proxy-rules-as-code.md` (design; §3.3, §3.5, §4.4, §6),
`proxy-rules-as-code-phase3-kickoff.md` (status + operator constraints),
`proxy-rules-as-code-phase2-implementation.md` (prior art).
Date: 2026-07-12

## Resolved decisions (operator, 2026-07-12)

1. **Scope**: all five Phase 3 items + ce#459 (CI npm publish) rides along.
2. **Revisions storage**: CE DB jsonb table (`proxy_rule_set_revisions`), full
   export-format snapshot, written on every sync/import/UI edit, cap ~20/set. Rollback
   permission = **contributor** (same as sync/import).
3. **TS handlers**: esbuild as a **regular dependency**; each `.fn.ts` entry bundles
   **self-contained** (shared utils duplicate into each handler string). No
   shared-step runtime semantics.
4. **`rules dev`**: local-first (rebuild + validate + vm tests on change, no network by
   default); `--push` opt-in, which **requires** `--name-suffix` so the live set is never
   clobbered by accident.
5. Out of scope (do NOT fix in passing): ce#460 (resolveProjectId creator scope), ce#461
   (lib error wording / applyNameSuffix / final name on PushOutcome), ce#452, apps#230–232,
   methods-split sync 400.

## Repos, branches, dependency order

| Track | Repo | Branch | Depends on |
|---|---|---|---|
| A (revisions backend) | `repos/ce` | `phase3/proxy-rules-as-code` | — |
| B (CLI: TS handlers, dev, rollback) | `repos/ce` (same branch) | same | A4/A5 contracts only (B4) |
| C (ce#459 CI publish) | `repos/ce` (same branch) | — |
| D (docs-public guide) | `repos/docs-public` | `proxy-rules-as-code-guide` | plan contracts (verify vs. B at review) |
| E (skill) | `repos/skills` | `rules-as-code-skill` | plan contracts |
| F (§3.5 memo) | `repos/ce` (same branch) | — |
| G (reviews + release) | all | — | everything |

Tracks A→B→C→F are **sequential** (same repo/branch — parallel implementers only across
different repos). D and E may run in parallel with each other and with ce-track tasks.

## Ground truth & key facts (recon 2026-07-12 — don't re-derive)

### CE backend (`repos/ce/apps/backend`)

- **Set schema** `src/db/schema/proxy-rule-sets.schema.ts`: `proxyRuleSets` (lines 35–99),
  `source: jsonb('source').$type<ProxyRuleSetSource>()` at 77 (nullable).
  `ProxyRuleSetSource` (118–129) = `{ repo?; path?; gitSha?; syncedAt: string; contentHash: string }`.
  Unique `(projectId, name)`. Rules schema `proxy-rules.schema.ts`: `proxyRules` from 157,
  unique `(ruleSetId, pathPattern, method)`. Barrel `src/db/schema/index.ts` — ordering
  matters; add new export **after line 17** (`proxy-rules.schema`).
  Convention template with FK+indexes+timestamps+relations: `pipeline-schedules.schema.ts`.
- **Service** `src/proxy-rules/proxy-rule-sets.service.ts`. Mutation entry points:
  `create` 172–217, `update` (set metadata only) 222–267, `copy` 272–349, `importRuleSet`
  361–494 (NO transaction), `syncRuleSet` 656–878 (tx at 778–849), `delete` 1060–1138.
  Rule-level mutations live in `proxy-rules.service.ts` (`ProxyRulesService`
  create/update/delete + reorder). `syncRuleSet` signature:
  `(projectId, dto: SyncProxyRuleSetDto, userId, userRole, apiKeyProjectId?) => Promise<SyncProxyRuleSetResponseDto>`.
  `source` stamp built 760–767, `contentHash` from `computeSyncContentHash` (1020–1040).
  Live rules pre-mutation: `proxyRulesService.getRulesByRuleSetId(existing.id)` at 726
  (decrypted headerConfig). Post-commit nginx regen 857–868 (failure → warning, not 500) —
  the model for post-commit best-effort side effects.
- **Export utils** `src/proxy-rules/export-format.util.ts`:
  `serializeRuleForExport(rule: Partial<ProxyRule>): ExportedRule` (132),
  `canonicalRuleCompare` (171), `buildExportEnvelope(input): RuleSetExport` (191),
  `sanitizeHeaderConfigForExport` (111, blanks header `add` secret values),
  `RuleSetExport` (93) = `{version:2; exportedAt; kind:'bffless-proxy-rule-set'; ruleSet:{name,description?,environment?}; rules; schemas?}`.
  Schema-id walk: `schema-refs.util.ts` (`collectSchemaIds`). Schema resolution by name:
  in-service `resolveSchemasByName` (524–618).
- **Replay feasibility**: `SyncProxyRuleSetDto`
  (`dto/sync-proxy-rule-set.dto.ts` 174–222) accepts a raw export envelope verbatim
  (`version/exportedAt/kind` accepted-and-ignored, by design — DTO comment 168–172). So
  rollback = feed the stored envelope back through `syncRuleSet` with `options.prune: true`.
  Caveat: header `add` secrets are blanked in snapshots; sync's blank-value preservation
  (`preserveBlankHeaderValues` 920–932) restores live values for surviving rules, but a
  rule deleted-then-rolled-back gets `''` values and shows in warnings — documented
  limitation, not a bug to fix.
- **Controller** `proxy-rule-sets.controller.ts`: class-level
  `@UseGuards(ApiKeyGuard)` + `@Controller('api/proxy-rule-sets')`; authorization enforced
  in service via `permissionsService.requireProjectAccess(..., 'contributor', apiKeyProjectId)`.
  `GET :id/export` is declared BEFORE `:id` routes deliberately (comment 150–152) — new
  `:id/revisions` / `:id/rollback/:revisionId` routes must also be declared before the bare
  `:id` GET. Copy the decorator stack from `sync` (116–148) / `export` (153–178);
  handler args `@Param('id', ParseUUIDPipe) id`, `@CurrentUser() user: CurrentUserData`,
  pass `user.id, user.role || 'user', user.apiKeyProjectId`.
- **DB mock pattern** (`proxy-rule-sets.service.spec.ts` 11–72): `jest.mock('../db/client')`
  with a chainable builder; terminal awaits (`limit`/`orderBy`/`returning`) consume
  `mockDb.__setResults([[...], [...]])` sequentially; `transaction: jest.fn(async (fn) => fn(chainable))`.
  **Every new query in a code path needs a result slot in existing specs** — expect to
  update slots in touched tests. Controller spec asserts routes/guards via
  `Reflect.getMetadata(PATH_METADATA, ...)` / `GUARDS_METADATA`.
  Run: `cd apps/backend && pnpm test -- proxy-rule-sets` (or `-- proxy-rules`).
- **Migrations**: `pnpm db:generate` = drizzle-kit; **Claude must NOT run it** (workspace
  rule) — it is an operator-gated release step (Track G). Tests never need it (DB fully
  mocked). Prod migrations run automatically at container start
  (`docker/backend-entrypoint.sh` line 38).
- **Frontend**: detail page `apps/frontend/src/pages/RuleSetDetailPage.tsx` (uses
  `ManagedFromGitBadge` at 194, `warnIfManaged()` toast 63–73). RTK service
  `src/services/proxyRulesApi.ts` (exports `ProxyRuleSetSource`); tag types in
  `src/services/api.ts` line 165 (`'ProxyRuleSet'` at 183). Verify with
  `pnpm --filter frontend build` (tsc) — not just vitest (Phase 2 lesson).

### CLI (`repos/ce/packages/cli`, npm `bffless@0.1.0`)

- ESM, `tsc` build, exports: `"."`, `"./lib"`, `"./harness"`, `"./eslint"` — new subpaths
  are added in `package.json` `exports` + `files: ["dist","LICENSE.md","README.md"]`.
  Deps today: `commander ^12.1.0`, `yaml ^2.4.5`, `zod ^3.23.8` only. `pnpm test` =
  `pnpm build && vitest run`; vitest targets `test/**/*.test.ts` importing `../src/*.ts`.
  Engines `node >= 18`. Repo root is a pnpm workspace — dep adds update root
  `pnpm-lock.yaml`; PR CI job `cli-tests` runs `pnpm --filter ./packages/cli test`.
- **Compiler** `src/compile/build.ts`:
  `buildRuleSet(setDir, opts?): Promise<BuildResult>` (216); handler code enters at exactly
  two read points — `compilePipeline` line 167 (the `code: <relpath>` sugar → `config.code
  = readFileSync(...)`) and `resolveFileRefs` line 143 (`{ $file }`). Both guarded by
  exported `resolveConfinedPath` (108) + `assertRealpathConfined` (124). Both sync today;
  `buildRuleSet` is already async. `buildOne` (orchestrator, dist writing + `dist/.gitignore`)
  is `src/commands/build.ts:26`.
- **Lint** `src/lint/patterns.ts`: `validateHandlerSource(code): LintFinding[]` (63) —
  regex `PROHIBITED_PATTERNS` (13–32, 1:1 parity with backend
  `function-runner.service.ts` — includes `\brequire\s*\(`, `\bimport\s*\(` (dynamic only),
  `\bglobalThis\s*\.`, `\bBuffer\s*\.`, `\bconstructor\s*\.`), `HANDLER_DECL_RE` (41)
  `/\bfunction\s+handler\b|\b(?:const|let|var)\s+handler\b/`, plus a compile-only
  `new vm.Script` syntax check. **Lint runs ONLY in `validateRuleSet`** step 3
  (`commands/validate.ts:288–299`, walking `discoverFnJsFiles` 99–110); `build`/`push` do
  not lint — bundled output must therefore be validated explicitly at bundle time.
- **Harness** `src/harness/run-handler.ts`: `runHandler(code, data?, opts?)` (101),
  `runHandlerFile(file, data?, opts?)` (223); sandbox allow-list at 126–164 (no
  require/process/fetch/Buffer/setTimeout; `utils` crypto bag from `harness/utils.ts`);
  timeout clamp 1000–30000ms. `rules test` (`commands/test.ts`): `runFnTests(setDir)` (53),
  discovers `*.fn.test.yaml` under `<setDir>/rules/` (35–45); fixture schema
  `FnTestManifestSchema` (`format/manifest.ts:196–202`, `.strict()`), `handler:` resolved
  relative to the test file.
- **API layer**: `ApiClient` (`api/client.ts:61`) has `get`/`put` only — private
  `request(method, ...)` (81) already supports any method; add `post` trivially.
  `createClient(flags, cwd, deps?)` (152): apiUrl = flag > env > config; apiKey = flag >
  env ONLY (never config). Resolution helpers `api/resolve.ts`: `requireProject` (90),
  `resolveProjectId` (28, ce#460 fragility — do not fix), `resolveRuleSetId` (70).
  Wire types in `api/sync-types.ts` (`SyncRequestBody` 20–26, `SyncResponse` 28–40).
- **index.ts**: subcommands hang off `const rules = program.command('rules')` (28–30);
  copy the `build` registration shape (32–64) for dir-taking commands and the pull/push
  option triple (`--api-url/--api-key/--project`, e.g. 123–125) for server commands;
  command modules never call `process.exit`/commander. `diff` models 3-way exit codes
  (222–236). Shared helper `resolveDirsOrReport` (18–25).
- **lib.ts** (`src/lib.ts`): side-effect-free barrel consumed by the deploy-proxy-rules
  action — **additive changes only**, never remove/rename existing exports.
- **Test helpers** `test/live-helpers.ts`: `stubFetch(routes)` ("METHOD url" → {status,
  body} map, records calls), `happyRoutes(exportBody)`, `API_URL='https://api.test'`,
  `PROJECT_UUID`, `SET_UUID`. Fixtures: `test/fixtures/synthetic/basic/` (+`expected.json`
  byte-golden), `synthetic/broken/`, `real/*.proxy-rules.json`.
  **Golden rule: never put esbuild output text in a byte-golden** — bundled text varies
  across esbuild versions; assert TS-handler output behaviorally (lint-clean, runs in
  harness, returns expected).
- **esbuild gotchas**: plugins do NOT work with `buildSync` — use the async `build()` API
  (fine: make `compilePipeline`/`resolveFileRefs` async; `buildRuleSet` already is).
  IIFE-format output with `globalName` yields `var X = (() => {...})()` — no `globalThis.`,
  no `require(` for pure relative-import inputs; still ALWAYS run `validateHandlerSource`
  on the final bundled string and fail the build on findings.
- **reference.md** section order (docs/reference.md): Install(28), Quickstart(35),
  Directory layout(87), Rule manifest reference(124), Defaults & elision(190), Route
  derivation(211), runHandler—Vitest(254), fn.test.yaml reference(291), ESLint preset(320),
  Not yet(352 — currently lists all three Phase 3 features as nonexistent; shrink it as
  they land).

### CI/release (`repos/ce`)

- `release-please-config.json`: `release-type: node`, `include-component-in-tag: false`,
  packages = `{ "." }` only. `.release-please-manifest.json` = `{ ".": "0.2.2" }`.
  `.github/workflows/release-please.yml` exists (read it before editing);
  `main-release.yml` builds Docker images only; `pr-tests.yml` has the `cli-tests` job.
  No npm publish anywhere. ce#459 = add `packages/cli` as a second release-please package
  + a publish job gated on its release. **NPM_TOKEN secret must be set by the operator**
  (Track G) — the workflow lands first, secret later.

### docs-public / skills

- Guide home: `repos/docs-public/docs/recipes/proxy-rules-as-code.md`; register in
  `sidebars.ts` Recipes `items` (lines 103–117 area); frontmatter =
  `sidebar_position` + `title` + `description` (one line, no trailing period); internal
  links are absolute site-root (`/features/proxy-rules`); admonitions `:::note` etc.;
  existing feature page `docs/features/proxy-rules.md` gets a cross-link. Build check:
  `pnpm build` (+ `pnpm typecheck`). Deploys via `bffless/upload-artifact` on main.
- Skill home: `repos/skills/plugins/bffless/skills/rules-as-code/SKILL.md` — frontmatter
  exactly `name:` + `description:`, first line must be `---` (CI checks). House length
  ~130–140 lines; style model: `proxy-rules/SKILL.md` (`# Title`, `**Docs**:` link line,
  `##` sections, Troubleshooting tail). Add alphabetical row to README "Skills Included"
  table. Versions are release-please-managed (three files) — **never hand-edit versions or
  CHANGELOG**. A `feat:` commit → minor bump (currently 1.10.1).

## Cross-cutting definitions (the contracts tasks share)

**Revision content hash** (backend + used by `current` flag):
`sha256(JSON.stringify({ ruleSet, rules, schemas }))` over the canonical envelope **minus
`exportedAt`/`version`/`kind`** — timestamps must not defeat dedupe. Helper
`computeRevisionHash(envelope: RuleSetExport): string` exported from the revisions service
module.

**Revision triggers**: `'sync' | 'import' | 'create' | 'copy' | 'set_update' | 'rule_edit' | 'rollback' | 'backfill'`
(varchar(20), typed `RevisionTrigger`).

**Capture semantics**: post-mutation, post-commit, **best-effort** (failure logs a warning
— mirrors the nginx-regen pattern; never fails the request). Deduped: skip insert when the
newest revision for the set has the same `contentHash`. Cap: after insert, delete all but
the newest 20 (`REVISION_CAP = 20`). **Backfill**: destructive paths (`syncRuleSet` on an
existing set, rule-level mutations, rollback) first call
`captureIfUnrevisioned(...)` — if the set has ≥1 rule and zero revisions, capture the
pre-mutation state with trigger `'backfill'`, so the first post-upgrade sync is reversible.
No capture on `dryRun`.

**Wire contracts (server ⇄ CLI)** — CLI copies live in `src/api/sync-types.ts`:

```ts
// GET /api/proxy-rule-sets/:id/revisions
export interface RevisionListItem {
  id: string;            // uuid
  createdAt: string;     // ISO
  trigger: string;       // RevisionTrigger
  contentHash: string;
  ruleCount: number;     // snapshot.rules.length
  current: boolean;      // contentHash === hash of the LIVE envelope, computed per request
  source?: { repo?: string; path?: string; gitSha?: string; syncedAt: string; contentHash: string } | null;
}
export interface RevisionListResponse { revisions: RevisionListItem[] } // newest first

// GET /api/proxy-rule-sets/:id/revisions/:revisionId
export interface RevisionDetailResponse extends RevisionListItem { snapshot: RuleSetExport }

// POST /api/proxy-rule-sets/:id/rollback/:revisionId   body: { dryRun?: boolean }
// response: SyncResponse (existing type) — it IS a sync
```

**Rollback semantics**: loads the revision (404 if absent or belonging to another set),
rebuilds a `SyncProxyRuleSetDto` from the snapshot with
`ruleSet: { ...snapshot.ruleSet, name: existingSet.name }` (rollback never renames/creates
a set — if the snapshot name differs from the current name, keep the current name and
append a warning), `options: { prune: true, dryRun }`, `schemas: snapshot.schemas`, then
calls `syncRuleSet`. After a non-dry-run rollback, capture a new revision with trigger
`'rollback'` (history only moves forward — like `git revert`). Known inherited limitation:
snapshots of methods-split sets fail replay with the same 400 sync gives today — surface
the sync error as-is.

**TS handler authoring contract**: a `.fn.ts` entry must `export default function
handler(ctx) {...}` (or `export function handler`). Imports: **relative only, confined to
the set directory** (bare specifiers and escapes are build errors). Bundling: esbuild
`{ bundle: true, write: false, format: 'iife', globalName: '__bfflessHandler',
platform: 'neutral', target: 'es2020' }` + appended
`var handler = __bfflessHandler.default || __bfflessHandler.handler;`, then
`validateHandlerSource` over the final string (build error on findings). `rules build`
does NOT typecheck (esbuild transpiles only) — documented.

## Process

- Fresh implementer subagent per task; independent adversarial review subagent per task
  (prompt: refute against this plan + the design doc; check the Done-when gate actually
  holds; run the named suites); fix rounds before the next task starts. Final whole-branch
  adversarial review per repo (most capable model), then fix rounds + re-review.
- Per-task commits pre-approved on the feature branches. **Never push, open PRs, publish,
  or merge without asking the operator.** Never force-push.
- Subagents share the working tree: **forbid `git stash` / `git restore` / `git checkout` /
  `git reset` in every subagent prompt**; use `git show HEAD:<path>` for baseline reads.
  Parallel implementers only across DIFFERENT repos.
- No local DB; backend tests mock the DB. Verify frontend-affecting changes with
  `pnpm --filter frontend build`. The API origin for any live checks is
  `https://admin.j5s.dev` (NOT the apex). Do not run `pnpm db:generate`.
- GitHub Actions can't run locally — unit-test workflow-adjacent TS, treat first real runs
  as part of release verification (Track G).

---

## Track A — CE backend: revisions + rollback (`repos/ce`, branch `phase3/proxy-rules-as-code`)

### - [x] Task A1 — revisions schema + capture service

**Files**:
- Create `apps/backend/src/db/schema/proxy-rule-set-revisions.schema.ts`
- Modify `apps/backend/src/db/schema/index.ts` (export after line 17)
- Create `apps/backend/src/proxy-rules/proxy-rule-set-revisions.service.ts`
- Create `apps/backend/src/proxy-rules/proxy-rule-set-revisions.service.spec.ts`
- Modify `apps/backend/src/proxy-rules/proxy-rules.module.ts` (provider + export)

Schema (model on `pipeline-schedules.schema.ts`; type-only imports avoid runtime cycles):

```ts
export const proxyRuleSetRevisions = pgTable(
  'proxy_rule_set_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleSetId: uuid('rule_set_id')
      .references(() => proxyRuleSets.id, { onDelete: 'cascade' })
      .notNull(),
    snapshot: jsonb('snapshot').$type<RuleSetExport>().notNull(), // import type only
    source: jsonb('source').$type<ProxyRuleSetSource>(),
    trigger: varchar('trigger', { length: 20 }).$type<RevisionTrigger>().notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    createdBy: uuid('created_by'), // no FK — survives user deletion
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('proxy_rule_set_revisions_set_created_idx').on(t.ruleSetId, t.createdAt)],
);
export type RevisionTrigger = 'sync' | 'import' | 'create' | 'copy' | 'set_update' | 'rule_edit' | 'rollback' | 'backfill';
export type ProxyRuleSetRevision = typeof proxyRuleSetRevisions.$inferSelect;
```

Service (`@Injectable`, depends on `PipelineSchemasService` only — NOT on
`ProxyRuleSetsService`/`ProxyRulesService`, to avoid DI cycles; callers pass decrypted
rules in):

```ts
export const REVISION_CAP = 20;
export function computeRevisionHash(envelope: RuleSetExport): string; // per cross-cutting def

export interface CaptureInput {
  ruleSet: ProxyRuleSet;          // current row (id, name, description, environment, source)
  rules: ProxyRule[];             // decrypted, as from getRulesByRuleSetId
  trigger: RevisionTrigger;
  userId?: string;
}
async capture(input: CaptureInput): Promise<void>;                 // never throws; logs warning on failure
async captureIfUnrevisioned(input: Omit<CaptureInput,'trigger'>): Promise<void>; // trigger 'backfill', only when count===0 && rules.length>0
async listRevisions(ruleSetId: string): Promise<ProxyRuleSetRevision[]>; // newest first
async getRevision(ruleSetId: string, revisionId: string): Promise<ProxyRuleSetRevision | null>;
```

`capture` assembles the envelope exactly like `exportRuleSet` does: `serializeRuleForExport`
per rule, sort `canonicalRuleCompare`, `collectSchemaIds` walk → fetch referenced schemas
via `PipelineSchemasService` → `buildExportEnvelope`. Then hash → dedupe vs newest → insert
→ prune beyond `REVISION_CAP` (select ids newest-first, delete ids at index ≥ 20).

**TDD** (write failing specs first, mock-DB pattern with `__setResults` slots): hash is
stable across `exportedAt` changes and differs when a rule changes; `capture` dedupes when
newest hash matches; `capture` prunes to 20; `capture` swallows DB errors (logs, does not
throw); `captureIfUnrevisioned` no-ops when a revision exists or rules are empty;
`listRevisions` orders newest first; `getRevision` returns null for a revision of another
set.

**Done when**: `cd apps/backend && pnpm test -- proxy-rule-set-revisions` green;
`pnpm --filter backend exec tsc --noEmit` clean. No migration generated (operator step).

Commit: `feat(backend): proxy rule set revisions schema + capture service`

### - [x] Task A2 — capture on set-level mutations (sync/import/create/copy/update)

**Files**:
- Modify `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts`
- Modify `apps/backend/src/proxy-rules/proxy-rule-sets.service.spec.ts`

**Consumes**: A1's `ProxyRuleSetRevisionsService` (`capture`, `captureIfUnrevisioned`).

Wire-up, mirroring the post-commit nginx-regen pattern (calls sit AFTER the transaction /
final write, wrapped so failure only warns):

- `syncRuleSet`: on an existing set, right after `liveRules` is loaded (~726), call
  `captureIfUnrevisioned({ ruleSet: existing, rules: liveRules, userId })`. After the
  transaction commits and the response is assembled (skip when `options.dryRun`): reload
  current rules (`getRulesByRuleSetId`) and `capture({ ruleSet: <post-sync row>, rules,
  trigger: 'sync', userId })`.
- `importRuleSet` / `create` / `copy`: after the final insert, capture with triggers
  `'import'` / `'create'` / `'copy'` (create/copy: only when the new set has rules —
  `capture` on an empty set is fine but pointless; keep it simple and always capture, the
  hash dedupe handles noise — implementer's choice, but assert whichever in tests).
- `update` (set metadata): capture with `'set_update'` after the update, passing current
  rules.

**TDD**: extend the `describe('syncRuleSet')` block — new `__setResults` slots for the
revision queries; assert `capture` called with trigger `'sync'` and NOT called on dryRun;
assert backfill fires exactly once for a set with rules and no revisions. Simplest
approach: inject a mocked `ProxyRuleSetRevisionsService` into the service under test
(plain object like the other deps) — then the mock-DB slots don't change for revision
internals. Assert each mutation path calls it with the right trigger.

**Done when**: `pnpm test -- proxy-rule-sets` green (all pre-existing sync/import/copy
specs still pass), tsc clean.

Commit: `feat(backend): capture revisions on sync/import/create/copy/set-update`

### - [x] Task A3 — capture on rule-level mutations

**Files**:
- Modify `apps/backend/src/proxy-rules/proxy-rules.service.ts`
- Modify `apps/backend/src/proxy-rules/proxy-rules.service.spec.ts`

**Consumes**: A1's service (same injection pattern as A2).

`ProxyRulesService` rule `create` / `update` / `delete` / `reorder`: before mutating, call
`captureIfUnrevisioned` (needs the parent set row + current decrypted rules — the service
already loads what it needs to authorize; add the minimal extra query); after mutating,
`capture(..., trigger: 'rule_edit', userId)` with freshly-loaded rules. Best-effort, post-
mutation, never fails the request.

**TDD**: per mutation method, assert the mocked revisions service receives `'rule_edit'`
post-mutation and `'backfill'` pre-mutation only when unrevisioned; a revision-service
throw does not fail the mutation (mock it to reject; the endpoint still succeeds — note
`capture` itself never throws per A1, so this test guards against future regressions by
asserting the call is `await`ed inside a try/catch or the promise is handled).

**Done when**: `pnpm test -- proxy-rules` green, tsc clean.

Commit: `feat(backend): capture revisions on rule-level edits`

### - [x] Task A4 — revisions list/detail endpoints

**Files**:
- Create `apps/backend/src/proxy-rules/dto/rule-set-revision.dto.ts` (+ barrel export in `dto/index.ts`)
- Modify `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts` (list/detail methods with permission checks)
- Modify `apps/backend/src/proxy-rules/proxy-rule-sets.controller.ts`
- Modify both specs

**Produces** (wire contract per cross-cutting section): `GET /api/proxy-rule-sets/:id/revisions`
→ `RevisionListResponse`; `GET /api/proxy-rule-sets/:id/revisions/:revisionId` →
`RevisionDetailResponse`.

Service methods (in `ProxyRuleSetsService`, which may depend on the revisions service —
the no-cycle rule is only the reverse direction):

```ts
async listRevisions(ruleSetId, userId, userRole, apiKeyProjectId?): Promise<RevisionListResponseDto>
async getRevision(ruleSetId, revisionId, userId, userRole, apiKeyProjectId?): Promise<RevisionDetailResponseDto>
```

Both: `findById` + the same scope/permission enforcement as `exportRuleSet` (viewer-level
read is fine — match whatever `exportRuleSet` requires; rollback in A5 requires
contributor like sync). `current` flag: compute the live envelope once per list call
(reuse the A1 assembly path — expose a small
`buildCurrentEnvelope(ruleSet, rules)` from the revisions service or a shared util) and
compare `computeRevisionHash`.

Controller: declare both routes BEFORE the bare `:id` GET (see ground truth); copy the
`export` decorator stack; `ParseUUIDPipe` on both params.

**TDD**: service specs (list maps rows → DTO with `current` true only for the matching
hash; detail 404s via `NotFoundException` for missing/foreign revision); controller spec
asserts paths + class guard intact.

**Done when**: `pnpm test -- proxy-rule` green (both suites), tsc clean.

Commit: `feat(backend): list/get proxy rule set revision endpoints`

### - [x] Task A5 — rollback endpoint

**Files**:
- Modify `apps/backend/src/proxy-rules/dto/rule-set-revision.dto.ts` (add `RollbackRuleSetDto { dryRun?: boolean }`)
- Modify `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts`
- Modify `apps/backend/src/proxy-rules/proxy-rule-sets.controller.ts`
- Modify both specs

**Produces**: `POST /api/proxy-rule-sets/:id/rollback/:revisionId` body
`{ dryRun?: boolean }` → `SyncProxyRuleSetResponseDto`.

```ts
async rollbackToRevision(ruleSetId, revisionId, options: { dryRun?: boolean }, userId, userRole, apiKeyProjectId?): Promise<SyncProxyRuleSetResponseDto>
```

Per the cross-cutting rollback semantics: load set (contributor permission — same call
`syncRuleSet` makes), load revision (404 checks), build the sync DTO from the snapshot
(`name` forced to the current set name + warning on mismatch, `prune: true`, `dryRun`
passthrough, `schemas` from snapshot), call `this.syncRuleSet(projectId, dto, ...)` — the
set's own `projectId`, NOT a caller-supplied one. Append a `rolledBackTo: revisionId`-style
warning line or extend response warnings so the report is self-describing. Post-rollback
(non-dry-run): `capture(..., trigger: 'rollback')` — note `syncRuleSet` will already have
captured a `'sync'` revision from A2's hook; to avoid a duplicate pair, pass a capture-
suppression flag through or accept the hash-dedupe (both revisions have identical hashes →
second insert is deduped; the surviving trigger is `'sync'`). **Decision: rely on
dedupe, but make the trigger right** — simplest correct: A2's sync-path capture accepts an
optional trigger override argument; rollback calls `syncRuleSet` via a private variant that
sets trigger `'rollback'`. Implementer picks the minimal refactor that yields exactly ONE
new revision with trigger `'rollback'`; the spec asserts that.

**TDD**: rollback of a 2-rule snapshot over a 3-rule live set produces a sync plan with
one delete (prune) and no create when unchanged; dryRun does not mutate and captures no
revision; foreign/missing revision → 404; name-mismatch snapshot keeps current name +
warning; exactly one `'rollback'` revision captured. Controller spec: route + guard.

**Done when**: `pnpm test -- proxy-rule` green, tsc clean.

Commit: `feat(backend): rollback endpoint replaying revision snapshots through sync`

### - [x] Task A6 — frontend: revision history + restore UI

**Files**:
- Modify `apps/frontend/src/services/api.ts` (add `'ProxyRuleSetRevision'` tag)
- Modify `apps/frontend/src/services/proxyRulesApi.ts` (endpoints `getRuleSetRevisions`,
  `rollbackRuleSet`; export `RuleSetRevisionListItem` type mirroring the wire contract)
- Create `apps/frontend/src/components/proxy-rules/RevisionHistoryPanel.tsx` (+ colocated `.test.tsx`)
- Modify `apps/frontend/src/pages/RuleSetDetailPage.tsx` (render panel)

Panel behavior: collapsible "History" section on the rule-set detail page listing
revisions (relative time, trigger badge, rule count, `current` marker, `repo@shortSha`
when source present). Each non-current row gets a **Restore** button → confirm dialog
("Restores this rule set to the state captured <time>. Rules added since will be deleted.")
→ `rollbackRuleSet` mutation → toast with created/updated/deleted counts from the
`SyncResponse`; `invalidatesTags: ['ProxyRuleSet', 'ProxyRule', 'ProxyRuleSetRevision']`.
Reuse existing dialog/toast/badge primitives from the page (match `ManagedFromGitBadge` /
`warnIfManaged` idioms — no new UI framework patterns).

**TDD**: component test with mocked RTK hooks: renders rows newest-first, current row has
no Restore, confirm→mutation fires with `{ id, revisionId }`, toast shows counts.

**Done when**: `pnpm --filter frontend test -- RevisionHistoryPanel` green AND
`pnpm --filter frontend build` succeeds (the Phase 2 lesson — build, not just vitest).

Commit: `feat(frontend): revision history + restore on rule set detail page`

---

## Track B — CLI: TS handlers, dev mode, rollback (`repos/ce`, same branch, after Track A)

### - [x] Task B1 — esbuild bundling core + handler types

**Files**:
- Modify `packages/cli/package.json` (add deps `esbuild ^0.25.0`; add exports
  `"./handlers": "./dist/handlers/types.js"`; run `pnpm install` from repo root to update
  the workspace lockfile)
- Create `packages/cli/src/compile/bundle.ts`
- Create `packages/cli/src/handlers/types.ts`
- Create `packages/cli/test/bundle.test.ts`

**Produces**:

```ts
// src/compile/bundle.ts
export interface BundleOptions { sourcemap?: boolean }
export interface BundleOutcome { code: string; warnings: string[] }
export async function bundleHandler(entryFile: string, setDir: string, opts?: BundleOptions): Promise<BundleOutcome>;
```

Per the TS handler authoring contract (cross-cutting section): async esbuild `build()`
(NOT `buildSync` — plugins don't work there) with a confinement plugin whose `onResolve`
rejects bare specifiers (`error: only relative imports within the rule-set directory are
supported in .fn.ts handlers`) and confines relative resolutions via the exported
`resolveConfinedPath`/`assertRealpathConfined` from `compile/build.ts` (resolve against the
importer's dir, confine against `setDir`; accept `.ts`/`.js` with extension-adding
resolution). Append the `var handler = __bfflessHandler.default || __bfflessHandler.handler;`
tail; when `opts.sourcemap`, use esbuild `sourcemap: 'inline'` (the inline map rides the
bundled string — used by harness/dev only, never in pushed output). Finally run
`validateHandlerSource(code)` and throw a build error listing findings (file + line) if
non-empty.

```ts
// src/handlers/types.ts — author-facing types, mirror harness/run-handler.ts HandlerData + utils
export interface HandlerUtils { sha256(input: string): string; hmacSha256(key: string, input: string): string; sign(payload: string): string; verify(payload: string, signature: string): boolean; randomToken(bytes?: number): string; randomUUID(): string; base64urlEncode(input: string): string; base64urlDecode(input: string): string }
// (implementer: copy the EXACT signatures from src/harness/utils.ts — the above is the shape, utils.ts is the truth)
export interface HandlerContext { user?: Record<string, unknown>; request?: { method?: string; path?: string; headers?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }; steps?: Record<string, unknown>; deployment?: Record<string, unknown>; utils: HandlerUtils }
```

**TDD** (behavioral, no byte-goldens of bundled text): a `.fn.ts` entry importing a
relative `./util.ts` bundles to a string that (1) passes `validateHandlerSource` with zero
findings, (2) executes via `runHandler` and returns the expected value proving the util was
inlined; bare import → build error naming the specifier; `../../../etc/passwd`-style import
→ confinement error; symlink escape → confinement error (`it.skipIf(!canSymlink)` pattern
from `test/build.test.ts:152`); `export function handler` (named, no default) also works;
missing export → the appended tail yields `handler === undefined` — make this a bundle-time
error by checking esbuild metafile exports or asserting the harness error is clear
(implementer picks; test the chosen behavior).

**Done when**: `cd packages/cli && pnpm test` fully green (build + all suites, not just the
new file), and `git status` shows the root `pnpm-lock.yaml` updated and committed.

Commit: `feat(cli): esbuild .fn.ts handler bundling core + bffless/handlers types`

### - [x] Task B2 — wire .fn.ts into build / validate / test / pull

**Files**:
- Modify `packages/cli/src/compile/build.ts` (the two read points), `src/commands/validate.ts`
  (discovery + lint of bundles), `src/commands/test.ts` + `src/harness/run-handler.ts`
  (`.fn.ts` fixtures), `src/commands/pull.ts` (warn when decompiling over TS sources),
  `src/lib.ts` (export `bundleHandler` + types, additive), `docs/reference.md`
- Create `packages/cli/test/fixtures/synthetic/ts-handlers/` (a small set: `ruleset.yaml`,
  one rule with `code: ./transform.fn.ts`, `lib/shared.ts` util, `transform.fn.test.yaml`)
- Modify `packages/cli/test/build.test.ts`, `test/validate.test.ts`, `test/rules-test.test.ts`

**Consumes**: B1's `bundleHandler`.

- `compilePipeline` (build.ts:167 area): when the `code:` ref ends `.ts`, call
  `bundleHandler(file, setDir)` (no sourcemap) instead of `readFileSync`; propagate its
  warnings into `BuildResult.warnings`. Make the affected chain async. `$file` refs stay
  raw-read (document: TS bundling applies to the `code:` sugar only).
- `validateRuleSet`: extend `discoverFnJsFiles` to `\.fn\.(js|ts)$`; for `.ts` files, lint
  the BUNDLE (bundle then `validateHandlerSource`) — raw TS import statements would be
  invisible to the regexes anyway; the bundle is what ships.
- `runFnTests`/`runHandlerFile`: when `handler:` resolves to a `.ts` file, bundle with
  `{ sourcemap: true }` and run the bundled string; pass the original entry path as the vm
  `filename` so failures name the source file. (Full line-number mapping needs
  `NODE_OPTIONS=--enable-source-maps` — say so in reference.md, don't build more.)
- `pull --decompile`: before writing, if the target set dir contains `*.fn.ts`, print a
  warning that decompile emits `.fn.js` and will not regenerate TS sources (do not block).
- Byte-golden `synthetic/basic/expected.json` must be UNTOUCHED (no TS in that fixture);
  the new `ts-handlers` fixture is asserted behaviorally (build succeeds, compiled
  `config.code` passes lint + runs in harness + `rules test` passes its fixture).
- reference.md: add a "TypeScript handlers" section after "Rule manifest reference"
  (authoring contract, import confinement, no typechecking, `bffless/handlers` types,
  test fixtures with `.fn.ts`), and delete the corresponding "Not yet" line.

**TDD**: failing tests first for each surface — build compiles the ts-handlers fixture and
`config.code` contains `var handler` + passes `validateHandlerSource`; validate flags a
`.fn.ts` whose bundle violates a prohibited pattern (e.g. a util calling `process.env`);
`rules test` runs the `.fn.ts` fixture green; pull warning fires.

**Done when**: `cd packages/cli && pnpm test` fully green including untouched goldens.

Commit: `feat(cli): .fn.ts handlers in build/validate/test + ts-handlers fixture`

### - [x] Task B3 — `rules dev` watch mode

**Files**:
- Modify `packages/cli/package.json` (add `chokidar ^4.0.1`; root `pnpm install`)
- Create `packages/cli/src/commands/dev.ts`
- Modify `packages/cli/src/index.ts` (register command), `src/lib.ts` (export runner,
  additive), `docs/reference.md` (new "rules dev" section; shrink "Not yet")
- Create `packages/cli/test/dev.test.ts`

**Produces**:

```ts
export interface DevOptions { push?: boolean; nameSuffix?: string; apiUrl?: string; apiKey?: string; project?: string }
export interface DevDeps { createWatcher?: (dirs: string[]) => DevWatcher; pushDeps?: PushDeps; log?: (line: string) => void; debounceMs?: number }
export interface DevWatcher { on(event: 'change', cb: (file: string) => void): void; close(): Promise<void> }
export async function runDev(dirs: string[], opts: DevOptions, cwd: string, deps?: DevDeps): Promise<{ close: () => Promise<void> }>;
```

Behavior: startup guard — `--push` without `--name-suffix` is a hard error (the operator
decision: never touch the live set from dev mode). Initial pass per set: build → validate →
`runFnTests`; then watch each set dir (default watcher = chokidar, ignore `dist/`),
debounce (default 200ms) per set, rerun the pass for the changed set only; after a fully
green pass with `--push`, call `runPushOne(dir, { nameSuffix, dryRun: false, ... }, cwd,
pushDeps)`. Every pass logs a single timestamped status line (`[12:01:03] reader ✓ build ✓
validate ✓ 3 tests` / `✗` with the first error). Failures never exit the loop. SIGINT
closes the watcher and resolves. Command registration copies the `build` shape + the
server option triple; the returned `close` handle exists for tests.

**TDD** (injected fake watcher — never test chokidar itself): initial pass runs for every
resolved dir; a fired `change` under set X reruns only X after debounce; two rapid changes
coalesce into one pass; red build logs `✗` and keeps watching; `--push` triggers
`runPushOne` only after a green pass and with the suffix; `--push` without suffix rejects
before any watcher is created.

**Done when**: `cd packages/cli && pnpm test` fully green; `node dist/index.js rules dev
--help` shows the command after `pnpm build`.

Commit: `feat(cli): rules dev watch mode (local-first, opt-in suffixed push)`

### - [ ] Task B4 — `rules revisions` + `rules rollback` commands

**Files**:
- Modify `packages/cli/src/api/client.ts` (add `post<T>(apiPath, body, lookup?)` — one-liner
  onto the private `request`), `src/api/sync-types.ts` (add `RevisionListItem`,
  `RevisionListResponse`, `RevisionDetailResponse` per the cross-cutting wire contract)
- Create `packages/cli/src/commands/revisions.ts`, `src/commands/rollback.ts`
- Modify `packages/cli/src/index.ts` (register both), `src/lib.ts` (additive exports),
  `docs/reference.md` (sections + shrink "Not yet")
- Create `packages/cli/test/revisions.test.ts`, `test/rollback.test.ts`

**Consumes**: A4/A5 endpoints (stubbed via `stubFetch` — no live calls in tests).

```ts
// revisions.ts
export interface RevisionsOptions { apiUrl?: string; apiKey?: string; project?: string }
export async function runRevisionsList(setName: string, opts: RevisionsOptions, cwd: string, deps?: ClientDeps): Promise<{ ok: boolean; revisions?: RevisionListItem[] }>;
// rollback.ts
export interface RollbackOptions extends RevisionsOptions { to?: string; dryRun?: boolean }
export interface RollbackOutcome { ok: boolean; response?: SyncResponse; revisionId?: string }
export async function runRollback(setName: string, opts: RollbackOptions, cwd: string, deps?: ClientDeps): Promise<RollbackOutcome>;
```

Both: `createClient` → `requireProject` → `resolveProjectId` → `resolveRuleSetId` (exact
pattern of `diff.ts:95–112`). `revisions` prints a table: short id (8 chars), age, trigger,
rule count, `current` marker, `repo@shortSha` when present. `rollback`: `--to <revisionId>`
targets that revision; default = **newest revision with `current === false`** (error with
a helpful message when none exists); POST `/api/proxy-rule-sets/:id/rollback/:revisionId`
with `{ dryRun }`; print the change plan via the existing `formatSyncReport`; `--dry-run`
exits 0 without mutating. CLI registration: `rules revisions <set>` and
`rules rollback <set>` with the option triple + `--to <revisionId>` + `--dry-run`.

**TDD**: stubFetch routes for list/rollback (extend a local copy of `happyRoutes`); list
maps + orders correctly; rollback default picks newest non-current; explicit `--to` wins;
404 from server → `ok: false` with the server message surfaced; dryRun sends
`{"dryRun":true}` (assert recorded call body); `post()` sets `X-API-Key` (client test).

**Done when**: `cd packages/cli && pnpm test` fully green.

Commit: `feat(cli): rules revisions + rules rollback commands`

---

## Track C — ce#459: CI npm publish for the CLI (`repos/ce`, same branch)

### - [ ] Task C1 — release-please package + publish job

**Files**:
- Modify `release-please-config.json`, `.release-please-manifest.json`
- Modify `.github/workflows/release-please.yml` (READ IT FIRST — adapt job/step names to
  what exists; the content below is the contract, not a paste-over)

Config — add a second package (root stays exactly as-is):

```json
"packages/cli": {
  "release-type": "node",
  "component": "bffless",
  "include-component-in-tag": true,
  "bump-minor-pre-major": true,
  "bump-patch-for-minor-pre-major": false
}
```

Manifest — add `"packages/cli": "0.1.0"`. Resulting tag scheme: root keeps `vX.Y.Z`
(`include-component-in-tag: false` at root), CLI gets `bffless-vX.Y.Z`; a `feat` touching
`packages/cli` yields a minor bump (0.1.0 → 0.2.0 for this phase's work).

Publish job appended to the release-please workflow (gate on the CLI path having been
released; expose the action's outputs on the existing job):

```yaml
publish-cli:
  needs: release-please
  if: ${{ contains(needs.release-please.outputs.paths_released, 'packages/cli') }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with: { version: 9 }
    - uses: actions/setup-node@v4
      with: { node-version: 20, registry-url: 'https://registry.npmjs.org' }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter ./packages/cli publish --access public --no-git-checks
      env:
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

(`prepublishOnly` already builds; `pnpm publish` respects it. `paths_released` is a JSON
array string — `contains()` on it is the standard idiom; match the output names the
installed release-please-action version actually emits.)

**TDD-equivalent** (workflows can't run locally): validate both JSON files parse
(`python3 -m json.tool` or `node -e`), run `npx --yes release-please@latest manifest-pr
--dry-run`-style validation only if it needs no auth — otherwise the gate is:
`actionlint` the workflow if available (`command -v actionlint`), plus a careful re-read of
the release-please-action docs for the pinned major version in the workflow. First real
run is verified in Track G.

**Done when**: JSON valid; workflow YAML parses (`node -e "require('js-yaml')..."` or
`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-please.yml'))"`);
no other workflow modified.

Commit: `ci: release-please + npm publish for packages/cli (ce#459)`

---

## Track F — skills-as-synced-resources memo (`repos/ce`, same branch)

### - [ ] Task F1 — evaluation memo (design §3.5)

**Files**:
- Create `docs/plans/skills-as-synced-resources-memo.md`

A decision memo, not code. Required content (ground every claim in the actual source —
read `apps/backend/src/**/skills.service.ts` (resolution from
`{owner}/{repo}/commits/{sha}/.bffless/skills/`), the CLI's `collectSkillRefs`
(`packages/cli/src/compile/build.ts:198–207`), and how `repos/apps` studio uploads skills
today):

1. **Status quo mechanics** — two transports (rules via DB sync, skills via artifact
   upload), where they desync, what the Phase 0–2 cross-reference check already catches at
   build time vs what still fails at runtime.
2. **Options**: (a) keep as-is; (b) full sync — project-scoped skills table, `rules push`
   bundles referenced skills, `SkillsService` resolves DB-first with storage fallback;
   (c) middle path(s) the author identifies (e.g. drift *detection* only: sync stamps a
   skills content hash and the nightly drift job compares).
3. **Evaluation** against: atomicity of rules+skills changes, versioning semantics lost
   (skills pinned to the serving deployment — argue whether that's a feature in real usage,
   citing how studio actually uses skills), CE surface cost (schema + dual resolution),
   migration/rollout, revision-feature interaction (should skills be IN the rule-set
   snapshot? state a position).
4. **Recommendation** with explicit trigger conditions for revisiting (e.g. "adopt (b)
   when a second app ships selected-mode skills" — author's call, but concrete).

**Done when**: memo exists, every mechanism claim carries a file:line citation, and it ends
with a single unambiguous recommendation. Reviewer's job: refute citations + attack the
recommendation.

Commit: `docs: skills-as-synced-resources evaluation memo (design §3.5)`

---

## Track D — docs-public guide (`repos/docs-public`, branch `proxy-rules-as-code-guide`)

### - [x] Task D1 — "Proxy Rules as Code" recipe

**Files**:
- Create `docs/recipes/proxy-rules-as-code.md`
- Modify `sidebars.ts` (append `'recipes/proxy-rules-as-code'` to the Recipes `items`)
- Modify `docs/features/proxy-rules.md` (cross-link in its related/next-steps area)

Frontmatter:

```
---
sidebar_position: 7
title: Proxy Rules as Code
description: Manage proxy rule sets in git with the bffless CLI and sync them from CI
---
```

Section skeleton (write real content for each; source material = the CLI's README +
`packages/cli/docs/reference.md` + the deploy-proxy-rules action README; audience = a CE
self-hoster who has never cloned a bffless repo):

1. **Why** — export/import drift, PR previews, review-able API changes.
2. **Install & adopt an existing set** — `npx bffless rules pull <set> --decompile`
   (the migration command), `.bffless/config.json` (`apiUrl`, `project`, `ruleSets`;
   API key via `BFFLESS_API_KEY` only — never in the file).
3. **Layout** — `ruleset.yaml`, `rules/**` route derivation, `*.rule.yaml`, schemas.
4. **Handlers** — `.fn.js` verbatim contract; **TypeScript handlers** (`.fn.ts`, default
   export, relative imports confined to the set dir, no typechecking at build); sandbox
   constraints + lint preset.
5. **Testing** — `*.fn.test.yaml` + `rules test`; `runHandler` in Vitest for power users.
6. **The loop** — `rules build` / `validate` / `diff` / `push --dry-run` / `push`;
   `rules dev` watch mode (`--push --name-suffix dev-you`).
7. **CI** — `bffless/deploy-proxy-rules@v1` snippet (sync → upload → attach order), PR
   preview rule sets with `name-suffix: pr-N` + cleanup, nightly drift check.
8. **Revisions & rollback** — automatic server-side history (cap 20), `rules revisions`,
   `rules rollback [--to] [--dry-run]`, dashboard History panel; the blanked-secret caveat
   for deleted-then-restored rules.
9. **Troubleshooting** — drift (`rules diff` before trusting sources), managed-set banner,
   methods-split sets can't sync (known limitation), name-suffix previews.

Style rules from ground truth: absolute internal links, `:::note`/`:::caution`
admonitions, pipe tables, no trailing period in `description`.

**Done when**: `pnpm build` and `pnpm typecheck` succeed in `repos/docs-public`; the new
page renders in the sidebar build output (check `build/recipes/proxy-rules-as-code/`
exists).

Commit: `docs: proxy rules as code recipe (CLI, CI sync, PR previews, rollback)`

---

## Track E — rules-as-code skill (`repos/skills`, branch `rules-as-code-skill`)

### - [x] Task E1 — `bffless:rules-as-code` skill

**Files**:
- Create `plugins/bffless/skills/rules-as-code/SKILL.md`
- Modify `README.md` (alphabetical row in the Skills Included table)

Frontmatter (first line MUST be `---` — CI checks):

```
---
name: rules-as-code
description: Manage BFFless proxy rule sets as code in git with the bffless CLI, deploy action, and PR previews
---
```

Content (~130–140 lines, style model `proxy-rules/SKILL.md`): `# Rules as Code`;
`**Docs**: https://docs.bffless.app/recipes/proxy-rules-as-code/`; sections: When to use
(vs editing in the dashboard/MCP); Directory layout; CLI command table (build / validate /
test / pull / diff / push / dev / revisions / rollback with one-line purpose + key flags);
`.bffless/config.json` (and the api-key-never-in-config rule); Authoring handlers (JS
verbatim contract, TS handlers + import confinement, multi-line formatting rule — link the
pipelines skill like proxy-rules does); Testing (`*.fn.test.yaml` shape, exact schema);
CI recipe (action snippet, sync → upload → attach ordering, PR previews via `name-suffix`,
drift check); Revisions & rollback (when to reach for server-side rollback vs `git
revert` + push); Troubleshooting (drift, managed banner warning, methods-split limitation,
suffix cleanup). README row (alphabetical — after **repository**, before **share-links**):

```
| **rules-as-code**     | Manage proxy rule sets as code in git with the bffless CLI and CI sync |
```

Do NOT touch versions or CHANGELOG (release-please owns them).

**Done when**: first line of SKILL.md is `---`; `python3 -m json.tool` passes on both
plugin JSONs (unchanged); the skills dir listing shows the new skill; README row present
and alphabetical.

Commit: `feat: rules-as-code skill (CLI, CI sync, PR previews, rollback)`

---

## Track G — reviews & release

### - [ ] Task G1 — whole-branch adversarial review per repo

One review subagent per repo (most capable model): `repos/ce` (Tracks A+B+C+F),
`repos/docs-public` (D), `repos/skills` (E). Prompt: refute correctness/completeness
against `proxy-rules-as-code.md` (§3.3/§3.5/§4.4) and THIS plan; check every Done-when
gate actually holds by running the named suites (`apps/backend pnpm test -- proxy-rule`,
`pnpm --filter frontend build`, `packages/cli pnpm test`, docs `pnpm build`); for docs/skill
content, verify every documented flag/command against the actual CLI source (`git show` of
`packages/cli/src/index.ts`), since D/E were written from plan contracts. Fix rounds +
re-review until clean.

### - [ ] Task G2 — release checklist (operator-gated, in order)

1. **Operator**: `cd repos/ce/apps/backend && pnpm db:generate` (expect one new migration
   creating `proxy_rule_set_revisions`; name suggestion: accept default or
   `proxy-rule-set-revisions`). Claude reviews the generated SQL; commit it to the branch.
2. **Ask** to push `phase3/proxy-rules-as-code` + open the ce PR (squash-merge; remember:
   Release-As footers do NOT survive squash — verify the squash message or push an empty
   `chore: release` commit after if a specific version is needed; default expectation is a
   normal version bump, no Release-As).
3. **Operator**: set the `NPM_TOKEN` secret on `bffless/ce` before merging (the publish job
   needs it on the first CLI release).
4. Merge ce PR → verify release-please opens BOTH release PRs (root + `bffless` component);
   merge the CLI release PR → **verify the first CI npm publish** (`bffless@0.2.0` on npm,
   `npm view bffless version`). Docker images build on the root release as usual.
5. **Operator**: bump j5s.dev to the new CE image + deploy; migration runs at container
   start. Live-verify: `bffless rules revisions studio` lists a backfill/sync revision
   after the next sync; run a `--dry-run` rollback against a scratch set (NOT studio).
6. **Ask** to push + PR `repos/docs-public` (deploys to docs.bffless.app on merge) and
   `repos/skills` (release-please → 1.11.0 plugin release on merge).
7. Confirm the nightly `rules-drift-check.yml` in `repos/apps` stays green post-deploy.
8. Update `proxy-rules-as-code-phase3-kickoff.md` status header (or add a short "shipped"
   note) and check off this plan.

---

## Known limitations carried into Phase 3 (do not "fix" in passing)

- Methods-split sets still 400 on sync — and therefore on rollback replay of their
  snapshots (surfaced as the sync error).
- ce#460: `resolveProjectId` creator-scope fragility applies to the new `revisions`/
  `rollback` commands too (they use the same resolution path).
- ce#461 (lib error wording, `applyNameSuffix`, final name on `PushOutcome`) untouched.
- Header `add` secret values are blanked in snapshots; rules deleted-then-rolled-back come
  back with `''` values (warned in the sync report; operator re-enters values).
- Revision capture is post-commit best-effort — a crash between commit and capture loses
  that one revision (accepted trade-off; hash-dedupe keeps history consistent).
- `pull --decompile` emits `.fn.js` only; TS sources are one-way (warned, documented).
