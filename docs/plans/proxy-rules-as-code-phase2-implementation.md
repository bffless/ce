# Proxy Rules as Code — Phase 2 Implementation Plan

> **For agentic workers:** execute with superpowers:subagent-driven-development — fresh
> implementer subagent per task, independent adversarial review per task, final
> whole-branch review per repo. Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI for proxy rules — a new `bffless/deploy-proxy-rules` GitHub Action
(build → validate → push with change report), convert studio + reader in `bffless/apps`
to the authoring layout and delete the raw JSON exports, per-PR preview rule sets for
reader with close-PR cleanup, a scheduled drift check, and the `@bffless/artifact-client`
plural-serialization fix.

**Architecture:** the action ncc-bundles the (newly npm-published) `bffless` CLI's
programmatic API (`bffless/lib`) — no runtime install. Deploy order per workflow:
sync rule sets → upload artifact → attach by name (attach stays upload-artifact's job).
The plural fix is two-sided: CE DTOs gain a normalize-to-array `@Transform` (rides the
same CE release the sync endpoints need) and the client/action send real arrays.

**Tech stack:** TypeScript, `@vercel/ncc`, `@actions/core`/`@actions/github`, Vitest,
release-please, pnpm. CE backend: NestJS + class-validator/class-transformer (Jest).

Companion docs: `proxy-rules-as-code.md` (§5 spec), `proxy-rules-as-code-phase2-kickoff.md`
(status handoff), `proxy-rules-as-code-phase1-implementation.md` (Phase 1 record).

Date: 2026-07-12

## Resolved decisions (operator, 2026-07-12)

1. **CLI acquisition — publish `bffless` to npm + ncc-bundle.** The unscoped name
   `bffless` is confirmed unclaimed (registry 404, 2026-07-12). The action lists it as a
   dependency and bundles it; development uses a `file:` dep on `../ce/packages/cli`,
   switched to the published version before the final `dist/` build.
2. **npm publish is an operator step**, run from the operator's authenticated
   environment after the CE PR merges (auth verified working, 2026-07-12).
3. **PR previews: per-PR for reader, shared alias for studio.** Reader gets the full
   headline flow (`reader-pr-N` rule set + `reader-pr-N` alias + close-PR cleanup).
   Studio keeps the shared `studio-preview` alias (each new alias is a new origin needing
   its own GCS-bucket CORS entry for studio's direct-to-GCS uploads); studio previews get
   a **dry-run** sync report instead. Studio can adopt per-PR later.
4. **Handoff is NOT converted** this phase — it keeps its raw JSON, workflows only migrate
   to the plural attach inputs. Fast-follow after the pattern is proven.
5. **Next CE release must be 0.2.0.** CE release-please has
   `bump-patch-for-minor-pre-major: true`, so `feat:` alone yields 0.1.106. Put
   `Release-As: 0.2.0` in the squash-merge body of the Phase 2 CE PR.

## Repos, branches, dependency order

| Track | Repo | Branch | Depends on |
|---|---|---|---|
| A | `repos/ce` | `feat/proxy-rules-phase2` off `origin/main` (`e884652`) | — |
| B | `repos/artifact-client` (freshly cloned) | `fix/plural-proxy-rule-sets` off `main` | — |
| C | `repos/upload-artifact` | `fix/plural-proxy-rule-sets` off `main` | B (types), for final dist: B published |
| D | `repos/deploy-proxy-rules` (**new local repo**, `git init`) | `main` (new repo) | A1 (lib entry), for final dist: `bffless` published |
| E | `repos/apps` | `proxy-rules-phase2` off `pilot/reader-proxy-rules-as-code` (`ddd047c`, has reader's authored layout + main merged) | A (CLI), D (action), C (plural inputs) — workflows only run after releases |

Each repo under `repos/` is its own git repo — always `cd` into it. **Operator-gated
steps** (never do without asking): any push, any PR, npm publish, creating the
`bffless/deploy-proxy-rules` GitHub repo (operator's step), merging.

## Ground truth & key facts (recon 2026-07-12 — don't re-derive)

### CLI (`repos/ce/packages/cli`, ESM, commander/yaml/zod)

- `exports` map today: `"."` → `dist/index.js` (**NOT import-safe** — `program.parseAsync()`
  runs at module top level; exports nothing), `./harness`, `./eslint`. No library entry —
  Task A1 creates one. All target functions already exist and are exported from their
  modules:
  - `buildOne(setDir, opts?: {output?: string}): Promise<BuildOutcome>` (`src/commands/build.ts`) — never throws.
  - `validateRuleSet(setDir): Promise<{errors: Issue[]; warnings: Issue[]}>`; `Issue {file; line?; message}` (`src/commands/validate.ts`).
  - `runPushOne(setDir, opts: PushOptions, cwd, deps?: PushDeps): Promise<PushOutcome>` with
    `PushOutcome = {ok: boolean; report?: string; response?: SyncResponse; error?: string}`;
    compiles in-memory, collects source metadata, PUTs
    `/api/proxy-rule-sets/project/${projectId}/sync` (`src/commands/push.ts`). `PushOptions`
    fields: `dryRun?, prune?, strictSchemas?, nameSuffix?, apiUrl?, apiKey?, project?`.
  - `runDiffOne(setDir, opts, cwd, deps?): Promise<DiffOutcome>`;
    `DiffOutcome = {status: 'clean'|'drift'|'error'; setName?; message?; diffs?: string[]}` (`src/commands/diff.ts`).
  - `formatSyncReport(setName, res: SyncResponse): string` (`src/commands/push.ts`).
  - `decompileExport`/`writeDecompiled` (`src/compile/decompile.ts`),
    `canonicalizeExport`/`stringifyExport`/`exportsEquivalent` (`src/format/canonical.ts`).
- **Dependency injection for tests**: `ClientDeps = {fetchImpl?; env?; config?}`;
  `PushDeps extends ClientDeps` adds `execGit?`. `ApiClient` auth header hardcoded
  `X-API-Key`; no retries; `ApiError` carries `status` (0 = network) and `url`.
- Config precedence: apiUrl `--api-url` > `BFFLESS_API_URL` > config `apiUrl`; apiKey
  `--api-key` > `BFFLESS_API_KEY` **only** (never config); project `--project` > config
  `project` (UUID, `owner/name`, or bare name via `GET /api/projects`).
  `.bffless/config.json` = `{apiUrl?, project?, ruleSets?}` (strict zod), discovered
  walking UP from cwd. `resolveRuleSetDirs(cwd, args)`: explicit args must contain
  `ruleset.yaml`; else config `ruleSets` globs relative to the config file's dir.
- Source metadata: `GITHUB_REPOSITORY`/`GITHUB_SHA` env first, git fallback; injectable.
- CLI exit codes: `rules diff` **0 in-sync / 1 drift / 2 error** (the CI contract).
- Tests: `test/*.test.ts` flat, vitest, `testTimeout: 20000`; `pnpm test` = `pnpm build && vitest run`
  (tests exercise built dist cross-module). Golden fixtures under `test/fixtures/{real,synthetic}`.
- **ncc hazards: none** (no `__dirname`/`import.meta`/dynamic import; `node:fs.globSync`
  feature-probe is a plain property access). Bundle-safety must still be smoke-tested (D5).
- Publish gaps: `version 0.0.0`; `license: "O'Saasy"` (not SPDX — npm rejects/warns);
  no `repository`/`homepage`/`bugs`/`keywords`; no `prepublishOnly`; `dist/` gitignored
  (fine — build-then-publish); **not wired into any CE CI workflow**; root `build` script
  doesn't build it. `bin: {"bffless": "./dist/index.js"}`, shebang preserved by tsc.

### CE backend (deployments DTOs — the server side of the plural bug)

- `POST /api/deployments/zip` → `CreateDeploymentZipDto`; same plural fields on
  `CreateDeploymentDto`, `PrepareBatchUploadDto`, `FinalizeUploadDto`
  (`apps/backend/src/deployments/deployments.dto.ts`):
  `@IsOptional() @IsArray() @IsString({each:true}) proxyRuleSetNames?: string[]` and
  `@IsOptional() @IsArray() @IsUUID('4',{each:true}) proxyRuleSetIds?: string[]`.
  **No `@Transform`**; global ValidationPipe `{whitelist, transform, forbidNonWhitelisted}`
  **without** implicit conversion → a comma string fails with exactly
  `"proxyRuleSetNames must be an array"`.
- Multipart caveat: multer/busboy only yields an array when a field repeats **≥2 times**;
  a single occurrence arrives as a bare string. → Task A3's `@Transform` must wrap
  string → `[string]` (splitting on commas for back-compat with old clients).
- `resolveProxyRuleSetIds` (`deployments.service.ts` ~120–146) uses plural when either
  array is non-empty, else falls back to singular. Backend tests are Jest, DB mocked.
- Rule-set delete: `DELETE /api/proxy-rule-sets/:id` (UUID, ApiKeyGuard) → `{success:true}`;
  **409 while attached to an alias** → cleanup must delete the alias first.
- Alias delete: `DELETE /api/repo/:owner/:repo/aliases/:aliasName` (ApiKeyGuard) → 204.
- List sets: `GET /api/proxy-rule-sets/project/:projectId` → `{ruleSets:[{id,name},…]}`;
  projects: `GET /api/projects` → bare array `{id, owner, name}`.

### artifact-client (`repos/artifact-client`, plain tsc → dist, CJS via `main`)

- `src/{index,types,http,upload,download}.ts`. `postJson` sends JSON
  (`JSON.stringify(body)`). The bug is the **type contract**: `PrepareBatchUploadRequest`
  and `FinalizeUploadRequest` declare `proxyRuleSetNames?: string` / `proxyRuleSetIds?:
  string` ("comma-separated"), forcing callers to `.join(',')`.
- **Zero tests** (`vitest run --passWithNoTests`). No vitest config (implicit).
- Release: release-please on main; on release commit, publish job runs
  `pnpm build && pnpm publish --access public --no-git-checks` with `NPM_TOKEN`.
  Publishing a fix = two merges (the fix, then the release PR).

### upload-artifact (`repos/upload-artifact`, the model for the new action)

- `run()` in `src/index.ts`: getInputs → try presigned path, warn+fall back to ZIP →
  setOutput per field → `writeSummary` → `writePrComment` → `process.exit(0)`;
  catch → `core.setFailed` + `process.exit(1)`; finally unlink temp zip.
- The comma-join sites (all `src/upload.ts`): prepare (~51–52) and finalize (~115–116)
  `inputs.proxyRuleSetNames?.join(',')`, ZIP form (~176/179)
  `form.append('proxyRuleSetNames', inputs.proxyRuleSetNames.join(','))`.
- `__tests__/upload.test.ts` has a plural-fields test that **asserts the buggy comma-join**
  (`expect(receivedBody).toContain('stripe-webhook,ai-proxy')`) — must flip.
- Test idiom: per-file `vi.mock('@actions/core')`; network unmocked — real
  `http.createServer` on `listen(0)`, assert on received body.
- PR comment: marker `<!-- bffless-deploy:${alias||basePath||'default'} -->` prepended;
  list per_page 100 → find → update else create; failures only `core.warning`.
- Build/release: `ncc build src/index.ts -o dist --license licenses.txt`; dist committed;
  ci.yml = pnpm 9 / node 20 → test → build → **fail if `git diff --name-only dist/` non-empty**;
  release.yml = release-please then force-move major tag
  (`git tag -fa "$MAJOR" && git push origin "$MAJOR" --force`).
  tsconfig: `target ES2021, module CommonJS, strict, declaration, outDir ./lib` (tsc for
  typecheck only; ncc ships dist). release-please-config: node, bump-minor-pre-major +
  bump-patch-for-minor-pre-major.

### apps repo (`repos/apps`, pnpm@10.33.0, node ≥20)

- Pilot branch adds only `apps/reader/.bffless/proxy-rules/reader/**` (1 ruleset.yaml,
  13 rule manifests, 21 `.fn.js`, 2 schemas, 1 `pick.fn.test.yaml`, `dist/.gitignore` = `*`).
  Raw `apps/reader/bffless/reader.proxy-rules.json` still present. apps#228 = this pilot.
- Layout convention: rule without code → flat `<method>.rule.yaml`; with code →
  `<method>/rule.yaml` + sibling `<step>.fn.js` (`code: ./prep.fn.js`); schemas by name
  (`schemaId: $schema:reader_items`), schema YAML keeps original `id:` UUID.
- Studio: `apps/studio/bffless/studio.proxy-rules.json` (**40 rules**, 23 fn steps, 4
  embedded schemas, references `{{secrets.HF_TOKEN}}`) + `studio-blog.proxy-rules.json`
  (4 rules, 1 fn step, 2 schemas). Both sets attach to the single `studio` alias.
  `apps/studio/.bffless/skills/**` (AI skills) is separate and must keep deploying via
  upload-artifact with `base-path: .bffless`.
- Workflows (all use `vars.BFFLESS_URL` + `secrets.BFFLESS_API_KEY`, checkout@v4 →
  pnpm/action-setup@v4 → setup-node@v4 node 20 cache pnpm → `pnpm install --frozen-lockfile`):
  - `deploy-reader.yml`: push main/`bapps-**`, alias `reader`, singular
    `proxy-rule-set-name: reader` + workaround comment; runs `test:run`.
  - `preview-reader.yml`: PR → shared alias `reader-preview`, singular attach, pr-comment,
    concurrency `preview-reader-${{ github.event.pull_request.number || github.ref }}`
    cancel-in-progress. No test step.
  - `deploy-studio.yml`: push main, alias `studio`, **no rule-set attach today** (manual
    import), second step uploads skills. `preview-studio.yml`: shared `studio-preview`,
    singular attach `studio`, second skills upload step.
  - `deploy-handoff.yml` / `preview-handoff.yml`: alias `handoff`, singular attach `handoff`.
  - `app-conventions.yml` runs `scripts/check-app-conventions.mjs` which **hard-requires**
    `apps/<app>/bffless/<app>.proxy-rules.json` + `bffless/README.md` with two headings.
  - **No PR-close cleanup workflow exists anywhere.**
- Raw-JSON consumers that break on deletion (Task E2 must fix): reader
  `apps/reader/src/lib/enrich.test.ts:7,12` (reads `bffless/reader.proxy-rules.json`,
  extracts the refresh `enrich` step's `config.code` + `config.map` and the
  `reader_items` schema fields); `scripts/check-app-conventions.mjs`. Handoff's many
  consumers are untouched (handoff keeps its JSON).
- Docs referencing raw JSON / "re-export from dashboard" (Task E3):
  `apps/reader/bffless/README.md` (esp. :185), `apps/studio/bffless/README.md`
  (:120, :131, counts at :11 — says "39 rules", file has 40), `apps/studio/CLAUDE.md:32`,
  `GETTING-STARTED.md:36,159–195`, `.sandcastle/prompt.md:28,30,40,54,94`,
  `docs/app-pipelines-convention.md:13`, skills
  `.claude/skills/install-app/SKILL.md:42-44,55` + `.agents/...` mirror (byte-identical —
  `skills-parity.yml` runs `node scripts/sync-skills.mjs --check`), stories
  `apps/studio/stories/12-companion-blog-post.md:109`, `13-cut-first-build-editor.md:98`.
- j5s.dev project for these apps: `bffless/apps` (owner/name — derived from
  `GITHUB_REPOSITORY`). Verify once at E1 with `GET /api/projects`.

## Cross-cutting definitions

**The action's contract** (`bffless/deploy-proxy-rules@v1`):

```yaml
inputs:
  path:            # required; one or more rule-set dirs (comma or newline separated),
                   # each containing ruleset.yaml
  api-url:         # required
  api-key:         # required (core.setSecret)
  project:         # optional; falls back to .bffless/config.json `project`
  prune:           # 'false'
  dry-run:         # 'false'
  name-suffix:     # optional; pushes <name>-<suffix>
  strict-schemas:  # 'false'
  working-directory: '.'
  summary: 'true'
  summary-title: 'Proxy Rules Sync'
  pr-comment: 'false'
  comment-header:  # default '🔀 BFFless Proxy Rules'
  github-token:    # default github.token / env GITHUB_TOKEN
outputs:
  rule-set-ids:    # comma-separated, order of `path`
  rule-set-names:  # comma-separated, post-suffix names
  changed:         # 'true' if any set had created/updated/deleted non-empty
  report:          # JSON: [{name, dir, response: SyncResponse}]
runs: { using: node20, main: dist/index.js }
```

Per-set flow: `validateRuleSet` (errors → setFailed listing `file:line message`) →
`runPushOne(dir, {dryRun, prune, strictSchemas, nameSuffix, apiUrl, apiKey, project}, cwd)`
→ `!ok` → setFailed with `outcome.error`. Validation warnings and `missingSecrets` are
`core.warning`s, not failures (matches CLI exit semantics).

**Release order (operator gates, after all tracks reviewed):**

1. CE PR → squash-merge with `Release-As: 0.2.0` footer → CE 0.2.0.
2. `npm publish` `bffless@0.1.0` from `repos/ce/packages/cli` on the merged main (VPS token).
3. artifact-client PR merge → release-please PR merge → `@bffless/artifact-client@1.2.0`.
4. upload-artifact: bump client dep to `^1.2.0`, rebuild dist (C1 final step), PR merge →
   release → `v1` tag moves.
5. deploy-proxy-rules: operator creates the GitHub repo; switch dep to published
   `bffless@^0.1.0`, rebuild dist (D5), push, initial release `v1.0.0`
   (`Release-As: 1.0.0` footer), `v1` tag.
6. apps PR merge **last** (its workflows reference `deploy-proxy-rules@v1` and the fixed
   `upload-artifact@v1`).
7. Operator bumps + deploys CE 0.2.0 on j5s.dev — sync endpoints + DTO transform must be
   live before any apps workflow runs. Until then pushes 404 and attaches with plural
   inputs 400.

## Process

Subagent-driven, mirroring Phases 0–1: fresh implementer subagent per task (TDD: failing
test first, then code, run the suite), independent adversarial review subagent per task
(reviews the diff intending to refute correctness/completeness), fixes applied before the
next task, and a final whole-branch review per repo (F1).

**Every subagent prompt must include:** the repo's absolute path and branch; **forbidden:
`git stash`, `git restore`, `git checkout`, `git reset`** (parallel agents share the
working tree — use `git show HEAD:<path>` for baseline reads); per-task commits are
pre-approved on the feature branches, **never push / never open PRs**; no local DB on
this VPS (backend tests mock the DB); curl commands single-line (no backslash
continuations); GitHub Actions can't run locally — unit-test the TS and smoke-test the
ncc bundle instead.

Task order within a track is dependency order. A, B, D1 can start in parallel; C needs B;
D2+ needs A1; E needs nothing to *start* (E1–E3) but E4–E6 write workflows that reference
the actions' final input names — keep D's `action.yml` frozen after D2 or reconcile.

---

## Track A — CE (`repos/ce`, branch `feat/proxy-rules-phase2`)

### - [x] Task A1 — CLI library entry (`bffless/lib`)

**Files**: new `packages/cli/src/lib.ts`; modify `packages/cli/package.json` (`exports`);
new `packages/cli/test/lib.test.ts`.

`src/lib.ts` — pure re-export barrel (no side effects):

```ts
export { buildRuleSet } from './compile/build.js';
export type { BuildResult } from './compile/build.js';
export { buildOne } from './commands/build.js';
export type { BuildOutcome } from './commands/build.js';
export { validateRuleSet } from './commands/validate.js';
export type { Issue } from './commands/validate.js';
export { runFnTests } from './commands/test.js';
export { runPushOne, formatSyncReport } from './commands/push.js';
export type { PushOptions, PushOutcome, PushDeps } from './commands/push.js';
export { runDiffOne } from './commands/diff.js';
export type { DiffOptions, DiffOutcome } from './commands/diff.js';
export { decompileExport, writeDecompiled } from './compile/decompile.js';
export { canonicalizeExport, stringifyExport, exportsEquivalent } from './format/canonical.js';
export type { RuleSetExport, ExportedRule, ExportedSchema } from './format/types.js';
export type { SyncRequestBody, SyncResponse, SyncRuleRef, SyncSchemaResolution } from './api/sync-types.js';
export { ApiClient, createClient, ApiError } from './api/client.js';
export type { ClientDeps, FetchLike } from './api/client.js';
```

(If a listed type name doesn't exist verbatim, export what the module actually declares —
verify against the source, don't invent.) package.json `exports` gains
`"./lib": "./dist/lib.js"` (keep `.`, `./harness`, `./eslint`).

**TDD**: `test/lib.test.ts` — (1) `import * as lib from '../dist/lib.js'` exposes
`runPushOne`, `validateRuleSet`, `formatSyncReport`, `runDiffOne`, `buildOne`,
`exportsEquivalent` as functions; (2) side-effect check: spawn
`node -e "import('<abs>/dist/lib.js').then(()=>console.log('OK'))" --- --bogus-flag`
via `execFile` and assert stdout `OK`, exit 0 (proves importing lib never runs commander).

**Done when**: `cd packages/cli && pnpm test` green (build runs first via the test script).

### - [x] Task A2 — CLI publish readiness + CE CI wiring

**Files**: `packages/cli/package.json`, new `packages/cli/LICENSE.md` (copy repo-root
license file; if the root has none, copy `repos/upload-artifact/LICENSE.md` — same
O'Saasy text), new `packages/cli/README.md`, modify `.github/workflows/pr-tests.yml`.

package.json changes:

```jsonc
{
  "version": "0.1.0",
  "license": "SEE LICENSE IN LICENSE.md",
  "repository": { "type": "git", "url": "git+https://github.com/bffless/ce.git", "directory": "packages/cli" },
  "homepage": "https://docs.bffless.app",
  "bugs": { "url": "https://github.com/bffless/ce/issues" },
  "keywords": ["bffless", "proxy-rules", "cli", "backend-for-frontend"],
  "files": ["dist", "LICENSE.md", "README.md"],
  "scripts": { /* existing + */ "prepublishOnly": "pnpm build" }
}
```

README.md: ~40 lines — what it is (proxy rules as code), install (`npm i -g bffless`),
the six `rules` commands with one-line descriptions, auth/env precedence, link to
docs.bffless.app and the authoring-layout doc. No fabricated URLs — link only
`https://github.com/bffless/ce` and `https://docs.bffless.app`.

CI: in `pr-tests.yml` add a `cli-tests` job (same runner/pnpm/node setup as the existing
jobs — read the file and mirror it): `pnpm --filter ./packages/cli test`. Keep it a
separate job so a CLI failure is legible.

**TDD**: `npm pack --dry-run` from `packages/cli` (after `pnpm build`) lists `dist/**`,
`LICENSE.md`, `README.md`, `package.json` and **nothing else**; `npm publish --dry-run`
exits 0 (name availability + metadata sanity; does not publish). Record both outputs in
the commit message body.

**Done when**: pack contents correct, dry-run publish clean, `pnpm --filter ./packages/cli test` green.

### - [x] Task A3 — Deployments DTO plural normalize `@Transform`

**Files**: `apps/backend/src/deployments/deployments.dto.ts` (4 DTOs:
`CreateDeploymentDto`, `CreateDeploymentZipDto`, `PrepareBatchUploadDto`,
`FinalizeUploadDto`), a shared helper in the same file or a sibling util, new/extended
Jest spec `apps/backend/src/deployments/deployments.dto.spec.ts`.

Helper (top of `deployments.dto.ts` or `dto-transforms.util.ts`):

```ts
import { Transform } from 'class-transformer';

/** Normalize a multipart/legacy value into string[]: arrays pass through;
 *  a lone string is comma-split (CSV back-compat) and trimmed; empties dropped. */
export function NormalizeStringArray() {
  return Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const parts = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      return parts.length > 0 ? parts : undefined;
    }
    return value; // let @IsArray reject other shapes
  });
}
```

Apply `@NormalizeStringArray()` **above** the existing `@IsArray()` on
`proxyRuleSetNames` and `proxyRuleSetIds` in all four DTOs (transform runs before
validation). Do not touch the singular fields.

**TDD** (spec first, `plainToInstance` + `validate` from class-transformer/class-validator,
mirroring the global pipe options `{whitelist: true, transform: true, forbidNonWhitelisted: true}`):
- `proxyRuleSetNames: 'a,b'` → validates, transformed to `['a','b']`.
- `proxyRuleSetNames: 'solo'` → `['solo']` (the multer single-field case).
- `proxyRuleSetNames: ['a','b']` → unchanged, valid.
- `proxyRuleSetIds: '<uuid1>,<uuid2>'` → valid; `proxyRuleSetIds: 'not-a-uuid'` → fails `IsUUID`.
- absent → stays undefined, valid. Empty string → undefined (not `['']`).
- number → fails `IsArray` (helper passes it through).
Run each of the four DTOs through at least the CSV + array cases.

**Done when**: `cd apps/backend && pnpm test -- deployments.dto` green; full backend suite green.

**CE PR (operator gate)**: after A1–A3 + F1(A), ask the operator to open/merge the PR with
`Release-As: 0.2.0` in the squash body. Then `npm publish` from `packages/cli` on merged
main (operator-gated; runs `prepublishOnly` build).

---

## Track B — artifact-client (`repos/artifact-client`, branch `fix/plural-proxy-rule-sets`)

### - [x] Task B1 — plural fields as real arrays + first test suite

**Files**: `src/types.ts`, `src/upload.ts`, new `__tests__/upload.test.ts`.

Types: change the plural fields on `PrepareBatchUploadRequest` and
`FinalizeUploadRequest` to

```ts
/** Proxy rule set names to attach to the deployed alias. Arrays are sent as-is;
 *  a comma-separated string is accepted for back-compat and normalized. */
proxyRuleSetNames?: string[] | string;
proxyRuleSetIds?: string[] | string;
```

In `src/upload.ts`, before building each JSON body (`requestPrepareBatchUpload` and
`finalizeUpload`), normalize:

```ts
function toArray(v?: string[] | string): string[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}
```

and send `proxyRuleSetNames: toArray(req.proxyRuleSetNames)` (likewise ids, both
functions) so `postJson` emits **real JSON arrays**.

**TDD** (the repo has zero tests — bootstrap the suite with the upload-artifact idiom:
real `http.createServer` on `listen(0)` capturing the request body, no vitest config
file needed): failing tests first —
- `requestPrepareBatchUpload` with `proxyRuleSetNames: ['a','b']` → captured JSON body has
  `proxyRuleSetNames: ['a','b']` (an array, not `'a,b'`).
- with `proxyRuleSetNames: 'a,b'` (legacy string) → body has `['a','b']`.
- with `'solo'` → `['solo']`; omitted → key absent from the JSON body.
- same four for `finalizeUpload`; one case for `proxyRuleSetIds`.

Commit message: `fix: send proxyRuleSetNames/proxyRuleSetIds as JSON arrays` (release-please
will cut 1.1.1 → but `feat`-worthy type widening: use `fix:` — the API contract was always
arrays; this corrects serialization).

**Done when**: `pnpm test` green; `pnpm build` clean.

---

## Track C — upload-artifact (`repos/upload-artifact`, branch `fix/plural-proxy-rule-sets`) — after B1

### - [x] Task C1 — pass arrays through; repeated multipart fields; migrate tests

**Files**: `src/upload.ts`, `__tests__/upload.test.ts`, `package.json` + lockfile
(temporarily `"@bffless/artifact-client": "file:../artifact-client"`, final commit
switches to `^1.2.0` once published — see Release order), `dist/` (rebuild).

Changes in `src/upload.ts`:
1. Prepare call: `proxyRuleSetNames: inputs.proxyRuleSetNames?.join(',')` →
   `proxyRuleSetNames: inputs.proxyRuleSetNames` (likewise ids). Same at the finalize call.
2. ZIP form:

```ts
if (inputs.proxyRuleSetNames && inputs.proxyRuleSetNames.length > 0) {
  for (const name of inputs.proxyRuleSetNames) form.append('proxyRuleSetNames', name);
}
if (inputs.proxyRuleSetIds && inputs.proxyRuleSetIds.length > 0) {
  for (const id of inputs.proxyRuleSetIds) form.append('proxyRuleSetIds', id);
}
```

(Single-element arrays arrive at the backend as a bare string — Task A3's `@Transform`
normalizes that; document this in a code comment referencing the CE release requirement.)

**TDD**: flip the existing plural test — assert the multipart body contains **two**
`name="proxyRuleSetNames"` parts (count occurrences) with values `stripe-webhook` and
`ai-proxy` and no `stripe-webhook,ai-proxy` substring; add a single-element case (exactly
one part, value intact even when the name contains no comma). If prepare/finalize aren't
covered, add a captured-body test asserting real arrays in the JSON.

Also: `action.yml` + README — remove/soften the "Legacy — prefer plural" caveat wording
that documents the CSV bug; note plural inputs now require CE ≥ 0.2.0.

Final steps (operator-gated timing): after `@bffless/artifact-client@1.2.0` exists, set
dep `^1.2.0`, `pnpm install`, `pnpm test`, `pnpm build`, commit the regenerated `dist/`
(CI enforces freshness — GitHub runs `dist/`, not `src/`).

**Done when**: tests green against the file: dep; final commit has registry dep + fresh dist.

---

## Track D — deploy-proxy-rules (new repo at `repos/deploy-proxy-rules`)

### - [x] Task D1 — scaffold

**Files** (all new): `package.json`, `tsconfig.json`, `action.yml` (full contract from
Cross-cutting definitions — freeze input names here), `.gitignore` (`node_modules/`,
`lib/`, `*.tsbuildinfo` — **dist/ is committed**), `LICENSE.md` (copy from
upload-artifact), `README.md` (stub: title + "docs land in D5"),
`release-please-config.json` + `.release-please-manifest.json` (`{".": "0.0.0"}`),
`.github/workflows/ci.yml` + `release.yml` — all four config files modeled byte-close on
upload-artifact's (pnpm 9→ use pnpm@10, node 20, test → build → dist-freshness check;
release-please + force-moved major tag).

package.json:

```jsonc
{
  "name": "@bffless/deploy-proxy-rules",
  "version": "0.0.0",
  "description": "GitHub Action: build, validate and push BFFless proxy rule sets from source",
  "main": "dist/index.js",
  "scripts": {
    "build": "ncc build src/index.ts -o dist --license licenses.txt",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write 'src/**/*.ts' '__tests__/**/*.ts'",
    "format:check": "prettier --check 'src/**/*.ts' '__tests__/**/*.ts'"
  },
  "dependencies": {
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0",
    "bffless": "file:../ce/packages/cli"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@vercel/ncc": "^0.38.1",
    "prettier": "^3.2.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  },
  "license": "SEE LICENSE IN LICENSE.md"
}
```

tsconfig: copy upload-artifact's, but `module: "Node16"` / `moduleResolution: "Node16"`
and keep `target ES2021` — required so TS resolves the ESM `bffless/lib` export map from
CJS-emitting code via dynamic `import()`; if that fights ncc, fall back to
`module: CommonJS` + a `const lib = await import('bffless/lib')` behind
`/* webpackMode: "eager" */`. **Resolve this here in D1 with a build spike**: a trivial
`src/index.ts` that imports `runPushOne` from `bffless/lib`, `pnpm build`, then
`node dist/index.js` must not throw on import. Record the working recipe in the README stub.

Init: `git init -b main` in the workspaces `repos/deploy-proxy-rules` (nothing to
clone — the GitHub repo is created by the operator at release time). Run
`cd ../ce/packages/cli && pnpm build` first so the file: dep has dist.

**Done when**: `pnpm install && pnpm test` (no tests yet → passWithNoTests not set; add
one placeholder assert-true test), the D1 import spike bundles and runs, initial commit made.

### - [x] Task D2 — inputs module

**Files**: `src/inputs.ts`, `src/types.ts`, `__tests__/inputs.test.ts`.

```ts
export interface ActionInputs {
  paths: string[];            // parsed from `path` (comma OR newline separated)
  apiUrl: string;
  apiKey: string;
  project?: string;
  prune: boolean;
  dryRun: boolean;
  nameSuffix?: string;
  strictSchemas: boolean;
  workingDirectory: string;
  summary: boolean;
  summaryTitle: string;
  prComment: boolean;
  commentHeader?: string;
  githubToken?: string;
}
```

`getInputs()` mirrors upload-artifact's idiom exactly: `{required: true}` for
path/api-url/api-key; `core.setSecret(apiKey)`; booleans via
`(core.getInput('x') || 'false').toLowerCase() === 'true'` (summary defaults `'true'` →
`!== 'false'`); `splitList(raw)` splits on `/[\n,]/`, trims, drops empties, throws via
`core.setFailed`-able Error if result is empty.

**TDD** (mock `@actions/core` per-file like upload-artifact): defaults; multi-path comma
AND newline forms; empty path → throws; boolean parsing (`'True'`, `''`, `'false'`);
setSecret called with the key.

**Done when**: vitest green.

### - [ ] Task D3 — sync runner + outputs

**Files**: `src/run-sets.ts`, `__tests__/run-sets.test.ts`.

```ts
import type { SyncResponse } from 'bffless/lib';
export interface SetResult { dir: string; name: string; response: SyncResponse }
export interface RunDeps { fetchImpl?: typeof fetch }  // threaded into PushDeps
export async function runSets(inputs: ActionInputs, deps?: RunDeps): Promise<SetResult[]>
```

For each `inputs.paths` entry (resolved against `workingDirectory`): `validateRuleSet` —
errors → throw `Error` with all `file:line message` lines joined; warnings →
`core.warning` each. Then `runPushOne(dir, {dryRun, prune, strictSchemas, nameSuffix,
apiUrl, apiKey, project}, workingDirectory, {fetchImpl})`; `!outcome.ok` → throw with
`outcome.error`; `missingSecrets` → one `core.warning`. Return collected results;
**fail fast** (first bad set stops the run — partial earlier syncs are idempotent, note
in README).

Output setting lives in `src/index.ts` (D5) but define the mapping here as a pure
function `toOutputs(results: SetResult[]): {ruleSetIds: string; ruleSetNames: string;
changed: boolean; report: string}` — `changed` = any `created/updated/deleted` non-empty;
name = `ruleSet name + ('-' + nameSuffix if set)` — take it from
`response`-adjacent data: use the `SetResult.name` captured from the push (read
`ruleset.yaml` name via the lib's build, or extract from `runPushOne`'s report — whichever
the lib exposes cleanly; verify at implementation and keep it exact, do not re-parse YAML
by hand if the lib exports a parser).

**TDD**: fixture rule-set dir under `__tests__/fixtures/basic/` (copy the minimal shape
from `repos/ce/packages/cli/test/fixtures/synthetic/basic/` — ruleset.yaml + one rule +
expected wire shape). Tests inject `fetchImpl` that (a) serves `GET /api/projects` →
`[{"id":"<uuid>","owner":"o","name":"p"}]` and (b) captures the `PUT
/api/proxy-rule-sets/project/<uuid>/sync` body and returns a canned `SyncResponse`.
Assert: sync body contains the compiled rules; `nameSuffix` reflected in
`ruleSet.name`; dryRun/prune/strictSchemas forwarded in `options`; invalid fixture
(broken ruleset.yaml) → throws with the validation message; HTTP 400 from fetchImpl →
throws with server message; `toOutputs` cases (changed true/false, multi-set CSV order).

**Done when**: vitest green with no real network.

### - [ ] Task D4 — change report: step summary + PR comment

**Files**: `src/report.ts`, `src/summary.ts`, `src/pr-comment.ts`, tests for each.

`src/report.ts`: `buildReportMarkdown(results: SetResult[], opts: {dryRun: boolean}):
string` — per set: `### <name>` + one-line totals (`N created, N updated, N deleted, N
unchanged` + `(dry run — nothing written)` when dryRun) + a table of changed rules
(`| rule | change |` rows from created/updated/deleted with `+`/`~`/`-`), a
`Prune candidates` list when non-empty and prune off, `⚠ missing secrets: …`, warnings
as blockquote lines. Deterministic ordering (server response order).

`src/summary.ts`: `writeSummary(inputs, results)` — early-return unless `inputs.summary`;
`## ${summaryTitle}` + report markdown via `core.summary.addRaw(...).write()`.

`src/pr-comment.ts`: mirror upload-artifact's marker-upsert verbatim with marker
`<!-- bffless-deploy-proxy-rules:${inputs.nameSuffix || 'default'} -->`; body = header
(default `🔀 BFFless Proxy Rules`) + report markdown; wrap in try/catch → `core.warning`;
skip silently when not a PR event or `prComment` false; warn when token missing.

**TDD**: report golden — one test with a two-set fixture `SyncResponse[]` asserting the
exact markdown (snapshot inline string, not a snapshot file); dryRun banner; empty-diff
set renders `unchanged` only. Summary: hoisted `core.summary` mock asserting addRaw
content. PR comment: mock `@actions/github` (context + octokit) asserting create when no
marker match, update when a comment contains the marker.

**Done when**: vitest green.

### - [ ] Task D5 — wire `src/index.ts`, README, dist, bundle smoke test

**Files**: `src/index.ts`, `README.md`, `__tests__/dist-smoke.test.ts`, `dist/` (committed).

`src/index.ts` (upload-artifact's run() shape):

```ts
import * as core from '@actions/core';
import { getInputs } from './inputs';
import { runSets, toOutputs } from './run-sets';
import { writeSummary } from './summary';
import { writePrComment } from './pr-comment';

async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const results = await runSets(inputs);
    const out = toOutputs(results);
    core.setOutput('rule-set-ids', out.ruleSetIds);
    core.setOutput('rule-set-names', out.ruleSetNames);
    core.setOutput('changed', String(out.changed));
    core.setOutput('report', out.report);
    await writeSummary(inputs, results);
    await writePrComment(inputs, results);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
run();
```

README: quick start (sync on deploy), PR-preview example with `name-suffix` +
close-PR cleanup pointer, dry-run report example, inputs/outputs tables (from action.yml,
keep in lockstep), the deploy-order note (sync → upload-artifact → attach by name), CE
version requirement (≥ 0.2.0), and the "runs dist/, rebuild after src changes" warning.

**Bundle smoke test** (`dist-smoke.test.ts`): build first (`pnpm build` in a
`beforeAll` via execFile or document `pnpm test` as `build && vitest run` — prefer making
package.json `"test": "pnpm build && vitest run"` like the CLI). Spawn
`node dist/index.js` with env `INPUT_PATH=<fixture dir> INPUT_API-URL=http://localhost:<port>
INPUT_API-KEY=k GITHUB_OUTPUT=<tmpfile>` (note: `@actions/core` reads inputs from
`INPUT_<NAME with spaces/dashes>` — use the exact encoding `INPUT_API-URL`; verify against
@actions/core source) against an ephemeral http server; assert exit 0, GITHUB_OUTPUT
contains `changed=`, and the server saw the sync PUT. This is the proof the ESM CLI
bundles correctly — the single riskiest integration point of the phase.

Final (operator-gated timing): once `bffless@0.1.0` is on npm — switch dep to
`"bffless": "^0.1.0"`, `pnpm install`, full `pnpm test`, `pnpm build`, commit dist.
Operator then creates `bffless/deploy-proxy-rules` on GitHub, we push `main`
(initial-release commit carries `Release-As: 1.0.0`).

**Done when**: smoke test green against the file: dep; final commit uses the registry dep
with fresh dist.

---

## Track E — apps (`repos/apps`, branch `proxy-rules-phase2` off `pilot/reader-proxy-rules-as-code`)

### - [x] Task E1 — repo config + studio/studio-blog conversion

**Files**: new `.bffless/config.json` (repo root); new
`apps/studio/.bffless/proxy-rules/studio/**` and `.../studio-blog/**` (generated);
`apps/studio/bffless/README.md` (counts fix only — full doc pass is E3).

Root `.bffless/config.json`:

```json
{
  "apiUrl": "https://j5s.dev",
  "project": "bffless/apps",
  "ruleSets": ["apps/*/.bffless/proxy-rules/*"]
}
```

Verify the project identifier once:
`curl -s -H "X-API-Key: $KEY" https://j5s.dev/api/projects` and confirm an entry with
owner `bffless`, name `apps` (ask the operator for a key via MCP config if none is at
hand — the MCP server for j5s.dev is connected in the main session; the orchestrator
verifies this, not the subagent).

Conversion (CLI from the ce checkout; build it first:
`cd <workspace>/repos/ce/packages/cli && pnpm build`):

```bash
cd <workspace>/repos/apps/apps/studio
node <workspace>/repos/ce/packages/cli/dist/index.js rules pull --from-file bffless/studio.proxy-rules.json --decompile
node <workspace>/repos/ce/packages/cli/dist/index.js rules pull --from-file bffless/studio-blog.proxy-rules.json --decompile
```

(default output `.bffless/proxy-rules/<set-name>/` relative to cwd — expect
`apps/studio/.bffless/proxy-rules/{studio,studio-blog}/`; coexists with
`apps/studio/.bffless/skills/` — do not touch skills).

**Round-trip gate (the make-or-break invariant)** — for each set: build, then compare
against the original raw JSON with the CLI's own equivalence:

```bash
node <workspace>/repos/ce/packages/cli/dist/index.js rules build .bffless/proxy-rules/studio
node -e 'import("<workspace>/repos/ce/packages/cli/dist/format/canonical.js").then(m=>{const fs=require("node:fs");const a=JSON.parse(fs.readFileSync("bffless/studio.proxy-rules.json","utf8"));const b=JSON.parse(fs.readFileSync(".bffless/proxy-rules/studio/dist/studio.proxy-rules.json","utf8"));const r=m.exportsEquivalent(a,b);console.log(JSON.stringify(r));process.exit(r.equal?0:1)})'
```

(equivalent invocation for studio-blog). Also `rules validate` (0 errors) and
`rules test` on both sets. Then verify `.bffless/proxy-rules/*/dist/` is git-ignored
(the CLI drops `dist/.gitignore` = `*`) — `git status --porcelain` shows no dist JSON.

**Done when**: both sets round-trip `equal:true`, validate clean, everything committed
(sources only, no dist), raw JSONs still present (deleted in E2).

### - [ ] Task E2 — migrate raw-JSON consumers, delete the three raw exports

**Files**: `apps/reader/src/lib/enrich.test.ts`; `scripts/check-app-conventions.mjs`;
`apps/reader/package.json` (add `yaml` devDep); delete
`apps/reader/bffless/reader.proxy-rules.json`,
`apps/studio/bffless/studio.proxy-rules.json`,
`apps/studio/bffless/studio-blog.proxy-rules.json`. (Handoff's JSON and its
consumers/tests/scripts are untouched.)

`enrich.test.ts` rewrite — read the authored layout instead of the export: the refresh
rule manifest is `apps/reader/.bffless/proxy-rules/reader/rules/api/refresh/post/rule.yaml`
(step `enrich` has `code: ./enrich.fn.js` and its `config.map` inline) and the handler
body is the sibling `enrich.fn.js`; schema fields come from
`.bffless/proxy-rules/reader/schemas/reader_items.schema.yaml`. New header:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
const setRoot = resolve(process.cwd(), '.bffless/proxy-rules/reader')
const refreshRule = parse(readFileSync(resolve(setRoot, 'rules/api/refresh/post/rule.yaml'), 'utf8'))
const enrichSource = readFileSync(resolve(setRoot, 'rules/api/refresh/post/enrich.fn.js'), 'utf8')
const itemsSchema = parse(readFileSync(resolve(setRoot, 'schemas/reader_items.schema.yaml'), 'utf8'))
```

Preserve every behavioral assertion; adapt the structural ones (step lookup by id within
`refreshRule.pipelineConfig.steps` or wherever the manifest nests steps — read the actual
rule.yaml shape first; `config.code` is now the file content). The handler-materialization
helper keeps working on `enrichSource`.

`check-app-conventions.mjs`: an app now passes the rules requirement if **either** the
raw `bffless/<app>.proxy-rules.json` exists **or** at least one authored set exists at
`apps/<app>/.bffless/proxy-rules/*/ruleset.yaml`:

```js
// (readdirSync, not fs.globSync — the conventions job runs plain Node 20)
function hasAuthoredSet(app) {
  const root = join(appsDir, app, '.bffless', 'proxy-rules')
  if (!existsSync(root)) return false
  return readdirSync(root).some((d) => existsSync(join(root, d, 'ruleset.yaml')))
}
```

with the error message updated to name both accepted shapes. README requirement unchanged.

**TDD order**: rewrite enrich.test.ts FIRST and get it green against the authored layout
while the raw JSON still exists; update the conventions script + run
`node scripts/check-app-conventions.mjs` (passes with both shapes present); THEN delete
the three raw JSONs; re-run reader tests (`pnpm --filter reader test:run`), studio tests
(`pnpm --filter studio test:run` — recon found no studio test reading the JSON, confirm),
handoff tests (`pnpm --filter handoff test:run` — must stay green, its JSON remains), and
the conventions script again (reader/studio pass via authored layout, handoff via raw JSON).
Also `grep -rn "reader.proxy-rules.json\|studio.proxy-rules.json\|studio-blog.proxy-rules.json"
--include="*.ts" --include="*.mjs" --include="*.js"` (excl. node_modules) → zero live-code hits.

**Done when**: full `pnpm -r test:run` (or per-app equivalents) green with the raw JSONs gone.

### - [ ] Task E3 — docs & skills pass

**Files**: `apps/reader/bffless/README.md`, `apps/studio/bffless/README.md`,
`apps/studio/CLAUDE.md`, `GETTING-STARTED.md`, `docs/app-pipelines-convention.md`,
`.sandcastle/prompt.md`, `.claude/skills/install-app/SKILL.md` **and**
`.agents/skills/install-app/SKILL.md` (byte-identical — run
`node scripts/sync-skills.mjs --check` after; if the repo has a sync command that writes,
use it), `apps/studio/stories/{12,13}-*.md` (one-line pointer fixes).

Content rules:
- "Re-export from the dashboard and commit the JSON" → "edit the source under
  `.bffless/proxy-rules/<set>/`, CI syncs on deploy (`bffless/deploy-proxy-rules`); check
  drift with `npx bffless rules diff`". Reader + studio sections only; handoff docs keep
  the old instruction, with a one-line "(handoff is not yet converted)" only where the doc
  contrasts apps.
- `GETTING-STARTED.md` install path for converted apps: build the import JSON locally —
  `npx bffless rules build apps/<app>/.bffless/proxy-rules/<set> -o /tmp/<set>.json` —
  then import via dashboard as before (or `bffless rules push` for CLI users). Keep the
  handoff raw-JSON path documented.
- install-app skill table rows for reader/studio point at the authored layout + build
  step; handoff row unchanged.
- Fix stale counts while touching `apps/studio/bffless/README.md` (says 39 rules; the
  set has 40) and `apps/studio/CLAUDE.md:32`.

**Verify**: `node scripts/check-app-conventions.mjs` green;
`node scripts/sync-skills.mjs --check` green; `grep -rn "re-export" apps/reader apps/studio
GETTING-STARTED.md` shows no stale dashboard instructions for converted apps.

**Done when**: greps clean, both checks green.

### - [ ] Task E4 — deploy workflows: sync step + plural attach migration

**Files**: `.github/workflows/deploy-reader.yml`, `deploy-studio.yml`,
`deploy-handoff.yml`, `preview-handoff.yml` (plural migration only for the handoff pair).

`deploy-reader.yml` — after tests, before upload, insert:

```yaml
      - name: Sync proxy rules to BFFless
        uses: bffless/deploy-proxy-rules@v1
        with:
          path: apps/reader/.bffless/proxy-rules/reader
          api-url: ${{ vars.BFFLESS_URL }}
          api-key: ${{ secrets.BFFLESS_API_KEY }}
          summary-title: Reader Proxy Rules
```

and change the upload step's attach to the plural input (dropping the workaround comment):

```yaml
          proxy-rule-set-names: reader
```

`deploy-studio.yml` — same sync step with
`path: |` newline list of both studio set dirs, and the app upload step gains
`proxy-rule-set-names: studio,studio-blog` (today it attaches nothing — this makes the
manual attach explicit and idempotent; both sets belong on the `studio` alias per
`apps/studio/bffless/README.md`). The skills upload step is untouched.

`deploy-handoff.yml` / `preview-handoff.yml` — replace `proxy-rule-set-name: handoff`
with `proxy-rule-set-names: handoff` and delete the workaround comments.

Add a comment atop each sync step: `# Requires CE >= 0.2.0 on the instance.`

**Verify**: `yamllint`-equivalent — parse each workflow with
`node -e 'require("yaml").parse(...)'` or `npx --yes yaml-lint`; grep the repo for
remaining `proxy-rule-set-name:` (singular) → zero hits; grep for the old workaround
comment text → zero hits.

**Done when**: workflows parse, no singular inputs remain anywhere.

### - [ ] Task E5 — reader per-PR previews + close-PR cleanup; studio dry-run preview

**Files**: `preview-reader.yml` (rewrite), new
`.github/workflows/cleanup-preview-reader.yml`, `preview-studio.yml` (add dry-run report
step + plural attach).

`preview-reader.yml` — per-PR flow (PR events only; keep `workflow_dispatch` deploying to
the shared `reader-preview` alias with the base `reader` set, computed via an env step):

```yaml
      - name: Compute preview identifiers
        id: ids
        run: |
          if [ -n "${{ github.event.pull_request.number }}" ]; then
            echo "suffix=pr-${{ github.event.pull_request.number }}" >> "$GITHUB_OUTPUT"
            echo "alias=reader-pr-${{ github.event.pull_request.number }}" >> "$GITHUB_OUTPUT"
            echo "set-name=reader-pr-${{ github.event.pull_request.number }}" >> "$GITHUB_OUTPUT"
          else
            echo "suffix=" >> "$GITHUB_OUTPUT"
            echo "alias=reader-preview" >> "$GITHUB_OUTPUT"
            echo "set-name=reader" >> "$GITHUB_OUTPUT"
          fi

      - name: Sync PR preview proxy rules
        uses: bffless/deploy-proxy-rules@v1
        with:
          path: apps/reader/.bffless/proxy-rules/reader
          api-url: ${{ vars.BFFLESS_URL }}
          api-key: ${{ secrets.BFFLESS_API_KEY }}
          name-suffix: ${{ steps.ids.outputs.suffix }}
          summary-title: Reader Preview Proxy Rules
          pr-comment: true
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Deploy preview to BFFless
        uses: bffless/upload-artifact@v1
        with:
          path: apps/reader/dist
          api-url: ${{ vars.BFFLESS_URL }}
          api-key: ${{ secrets.BFFLESS_API_KEY }}
          alias: ${{ steps.ids.outputs.alias }}
          proxy-rule-set-names: ${{ steps.ids.outputs.set-name }}
          description: 'Reader preview for PR #${{ github.event.pull_request.number }}'
          summary-title: Reader Preview
          pr-comment: true
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

(`name-suffix: ''` must be a no-op in the action — D2 treats empty string as unset;
double-check that behavior exists, it's load-bearing here. Update the header comment
block that currently explains the shared-alias tradeoff — per-PR is now real; note the
CORS caveat only applied to studio.)

`cleanup-preview-reader.yml` (new):

```yaml
name: Cleanup Reader PR Preview
on:
  pull_request:
    types: [closed]
    paths:
      - 'apps/reader/**'
      - '.github/workflows/preview-reader.yml'
      - '.github/workflows/cleanup-preview-reader.yml'
permissions:
  contents: read
jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Delete preview alias and rule set
        env:
          URL: ${{ vars.BFFLESS_URL }}
          KEY: ${{ secrets.BFFLESS_API_KEY }}
          N: ${{ github.event.pull_request.number }}
        run: |
          set -euo pipefail
          # 1. Alias first — the rule set 409s on delete while attached.
          code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-API-Key: $KEY" "$URL/api/repo/bffless/apps/aliases/reader-pr-$N")
          echo "alias delete: HTTP $code"   # 204 deleted, 404 never existed — both fine
          [ "$code" = "204" ] || [ "$code" = "404" ] || exit 1
          # 2. Resolve project id, then the rule set id by name, then delete it.
          project_id=$(curl -sf -H "X-API-Key: $KEY" "$URL/api/projects" | jq -r '.[] | select(.owner=="bffless" and .name=="apps") | .id')
          set_id=$(curl -sf -H "X-API-Key: $KEY" "$URL/api/proxy-rule-sets/project/$project_id" | jq -r --arg n "reader-pr-$N" '.ruleSets[] | select(.name==$n) | .id')
          if [ -z "$set_id" ]; then echo "rule set reader-pr-$N not found — nothing to delete"; exit 0; fi
          curl -sf -X DELETE -H "X-API-Key: $KEY" "$URL/api/proxy-rule-sets/$set_id" > /dev/null
          echo "deleted rule set reader-pr-$N ($set_id)"
```

`preview-studio.yml` — keep the shared `studio-preview` alias and its existing steps;
migrate attach to `proxy-rule-set-names: studio`; ADD (before the deploy step) a dry-run
rules report so rule changes are reviewable per PR without touching the live set:

```yaml
      - name: Proxy rules change report (dry run)
        uses: bffless/deploy-proxy-rules@v1
        with:
          path: |
            apps/studio/.bffless/proxy-rules/studio
            apps/studio/.bffless/proxy-rules/studio-blog
          api-url: ${{ vars.BFFLESS_URL }}
          api-key: ${{ secrets.BFFLESS_API_KEY }}
          dry-run: true
          summary-title: Studio Proxy Rules (dry run)
          pr-comment: true
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

(Keep the existing header comment about why studio stays on a shared alias, updating it
to mention reader now demonstrates the per-PR flow.)

**Verify**: workflows parse (same YAML check as E4); walk the curl logic once against
j5s.dev manually IF the operator has deployed CE 0.2.0 by then (otherwise leave a
checklist item in the PR body); confirm `jq` availability is safe (ubuntu-latest ships jq).

**Done when**: three workflows parse; cleanup logic reviewed against the endpoint facts
(alias-before-set ordering, 404 tolerated).

### - [ ] Task E6 — scheduled drift check

**Files**: new `.github/workflows/rules-drift-check.yml`.

```yaml
name: Proxy Rules Drift Check
# `bffless rules diff` exits 0 in sync / 1 drift / 2 error — the job fails on drift so
# the team notices manual dashboard edits to git-managed sets. Requires CE >= 0.2.0.
on:
  schedule:
    - cron: '23 6 * * *'
  workflow_dispatch:

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Diff authored rule sets against live
        env:
          BFFLESS_API_URL: ${{ vars.BFFLESS_URL }}
          BFFLESS_API_KEY: ${{ secrets.BFFLESS_API_KEY }}
        run: |
          set -o pipefail
          npx --yes bffless@^0.1.0 rules diff 2>&1 | tee "$GITHUB_STEP_SUMMARY"
```

(no `path` args — the root `.bffless/config.json` `ruleSets` glob covers
reader/studio/studio-blog; a future handoff conversion is picked up automatically).

**Verify**: workflow parses; dry-run the equivalent locally against j5s.dev once CE 0.2.0
is deployed (orchestrator step, same caveat as E5).

**Done when**: workflow parses and the local diff (post-CE-deploy) exercises cleanly.

---

## Track F — reviews & release

### - [ ] Task F1 — whole-branch adversarial review per repo

One review subagent per repo (ce, artifact-client, upload-artifact, deploy-proxy-rules,
apps), fresh eyes, prompt = "refute correctness/completeness against
`proxy-rules-as-code.md` §5 and this plan; check every Done-when gate actually holds;
run the suites". Fix findings before any operator gate.

### - [ ] Task F2 — release checklist (operator-gated, in order)

Execute the **Release order** list from Cross-cutting definitions, asking the operator
at each gate. Post-release verification: trigger `workflow_dispatch` on
`deploy-reader.yml` and confirm sync step summary; open a scratch PR touching
`apps/reader` to watch the per-PR preview + close it to watch cleanup; run the drift
check by dispatch. Then close apps#228 (superseded by the real conversion) and file the
CE-CI-npm-publish follow-up issue (publishing stays manual from the VPS for now).

## Known limitations carried into Phase 2 (do not "fix" in passing)

- Methods-split sets still 400 on sync (Phase 1 limitation; stretch item only if trivial).
- Set `description`/`environment` omission preserves live values → `rules diff` reports
  drift until set explicitly (reader/studio ruleset.yaml SHOULD set description — reader's
  already does).
- `bffless/ce#452` (plaintext header `add` values in `copy()`) is separate,
  `ready-for-agent`, not this phase.
