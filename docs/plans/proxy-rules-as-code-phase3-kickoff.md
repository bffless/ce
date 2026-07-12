# Proxy Rules as Code — Phase 3 Kickoff & Status Handoff

Status doc for resuming after a context clear. Phases 0–2 are shipped and live; this doc
is the starting point for **Phase 3 (polish: revisions/rollback, TS handlers, watch mode,
skills-as-synced-resources evaluation, public docs + skill)**.

Date: 2026-07-12

> **STATUS UPDATE 2026-07-12 — PHASE 3 SHIPPED.** Everything below is historical context.
> Shipped: CE v0.2.3 on j5s.dev (revisions + rollback live-verified on a scratch set),
> `bffless@0.2.0` on npm (first CI publish via release-please component `bffless`, ce#463/#467),
> docs-public recipe live (/recipes/proxy-rules-as-code/), skills plugin v1.11.0
> (`bffless:rules-as-code`). Plan of record with review results:
> `proxy-rules-as-code-phase3-implementation.md`. Follow-ups filed: ce#464 (generator
> services bypass revision capture), ce#465 (8-char revision ids vs `--to` UUID), ce#466
> (stale missingSecrets doc bullet), apps#233/#234 (drift-check pin bump).

## Where things stand

**Phases 0–1 — DONE** (see `proxy-rules-as-code-phase2-kickoff.md` for that history).

**Phase 2 — DONE, shipped and live-verified 2026-07-12** (plan of record with review
results: `proxy-rules-as-code-phase2-implementation.md`; ce PR #454 + hotfixes #455/#457,
apps PR #229). The shipped artifacts:

- **`bffless@0.1.0` on npm** — the CLI, now with a side-effect-free library entry
  (`bffless/lib`: `buildRuleSet`/`buildOne`/`validateRuleSet`/`runFnTests`/`runPushOne`/
  `runDiffOne`/`formatSyncReport`/`decompileExport`/canonicalizers + sync wire types).
  Published MANUALLY from the operator env — CI publishing is ce#459.
- **`bffless/deploy-proxy-rules@v1`** (v1.0.0, new public repo) — build → validate → push
  per set via `runPushOne`; change report as step summary + marker-upsert PR comment
  (marker keyed on `name-suffix`); inputs `path` (multi, comma/newline), `api-url`,
  `api-key`, `project`, `prune`, `dry-run`, `name-suffix` ('' = unset), `strict-schemas`,
  summary/pr-comment knobs; outputs `rule-set-ids/names`, `changed`, `report` JSON.
  ncc-bundles `bffless/lib` via dynamic import → a numbered chunk file in `dist/` that
  MUST stay committed (`git add -A dist/`; CI freshness check catches untracked chunks).
- **`@bffless/artifact-client@1.1.1` + `bffless/upload-artifact@v1.4.1`** — plural
  `proxyRuleSetNames`/`proxyRuleSetIds` now real arrays end to end (JSON bodies +
  repeated multipart fields); CE DTOs normalize CSV/bare strings for back-compat.
- **CE v0.2.2 deployed on j5s.dev** (v0.2.0's images never built — nest build compiled
  specs + Dockerfiles missed `tsconfig.build.json`; both fixed forward). Contains the
  Phase 1 sync surface + the plural DTO transform + `packages/cli` in PR CI.
- **`bffless/apps` converted** (#229): reader + studio + studio-blog authored under
  `apps/<app>/.bffless/proxy-rules/<set>/**`; raw JSON exports deleted; root
  `.bffless/config.json` (`apiUrl: https://admin.j5s.dev` — NOT the apex, it serves SPA
  HTML — `project: bffless/apps`, ruleSets glob); deploy workflows sync → upload →
  attach (plural, all apps incl. handoff's attach); **reader per-PR previews live-proven**
  (`reader-pr-229` created + attached on PR, alias-then-set deleted by
  `cleanup-preview-reader.yml` on close); studio previews post a dry-run change report;
  nightly `rules-drift-check.yml` (all sets in sync as of ship). Forkers: set the
  `BFFLESS_PROJECT` repo var; docs carry repoint caveats.

**Lessons that must not be relearned** (encoded in review fixes; details in the plan doc):
- The dry-run report caught REAL two-writer drift pre-merge: live `studio-blog` had a
  `blogClaude` ai_handler feature absent from git — reconciled with `rules pull` before
  merge. Norm going forward: **check `rules diff` before trusting committed sources.**
- reader's `build` runs `tsc -b` over test files — verify test rewrites with
  `pnpm --filter <app> build`, not just `test:run`.
- The API origin is `admin.j5s.dev`; `preview-reader`'s sync step is gated
  `if: github.event_name == 'pull_request'` so dispatch never pushes onto the live set.

**Open follow-ups (filed 2026-07-12):** ce#459 (CI npm publish), ce#460 (CLI
`resolveProjectId` creator-scope fragility → use `GET /api/projects/:owner/:name`),
ce#461 (`bffless/lib`: parameterizable error wording, exported `applyNameSuffix`, final
name on `PushOutcome` — kills the action's triple-compile), apps#230 (studio duplicate
`order` values 1/45/46 — build warnings), apps#231 (handoff conversion fast-follow, incl.
the live-only `handoff-rss-feed` set), apps#232 (thumbnail/draft `debugEnabled` policy).
Also unfiled: delete the merged `pilot/reader-proxy-rules-as-code` branch; ce#452
(pre-existing `copy()` plaintext header values) still open.

## Phase 3 scope (design doc §6 + §3.5)

1. **Revisions + rollback** — server-side history of synced rule sets (a revisions table
   keyed by contentHash/syncedAt?), `bffless rules rollback <set> [--to <rev>]`, and/or
   dashboard restore. Design §4/§6 sketch only — needs a real design pass first.
2. **TS handlers + esbuild bundling** — author `.fn.ts` (and shared util modules) that
   compile/bundle to the ES5-ish sandbox target at `rules build` time; source maps for
   the vm harness; decide module-sharing semantics across steps/rules.
3. **`rules dev` watch mode** — rebuild on change + live push (probably `--dry-run`-first
   or a dedicated dev set via `--name-suffix dev-<user>`), tight loop with the vm test
   harness.
4. **Evaluate skills-as-synced-resources (§3.5)** — should `.bffless/skills/**` sync the
   way rules do (today studio uploads them as static assets with `base-path
   .bffless/skills`)? Evaluation/decision item, not a committed build.
5. **Public docs + skill** — docs-public guide ("proxy rules as code" for CE users) and a
   `bffless:rules-as-code` skill in `bffless/skills` (authoring layout, CLI, action,
   PR-preview recipe). The npm README + `packages/cli/docs/reference.md` are sources.

## Open questions for the operator (ask before planning)

1. **Phase 3 scope cut** — all five items, or a subset? (1)–(3) are build-heavy; (4) is a
   decision memo; (5) is docs. Natural split: 3a = DX (2+3), 3b = safety (1), 3c = docs
   (5), with (4) folded into whichever lands first.
2. **Revisions storage** (if (1) is in): CE DB table vs reusing deployments-style
   storage; retention; who can roll back (role).
3. **TS authoring target** (if (2) is in): esbuild as a CLI dependency (weight) vs
   optional peer; do shared utils bundle per-handler (duplicated) or as a shared step?
4. **`rules dev` push target** (if (3) is in): dev-suffixed set on the real project vs
   local-only compile+test loop (no live push)?
5. Should ce#459 (CI npm publish) ride along as a Phase 3 task so CLI releases stop
   being manual?

## Key grounding facts (so you don't re-derive them)

- **Repos**: `repos/ce` (CLI `packages/cli`, published as `bffless`; backend sync surface
  `apps/backend/src/proxy-rules/`), `repos/deploy-proxy-rules` (the action, cloned
  locally), `repos/apps` (converted monorepo), `repos/artifact-client` +
  `repos/upload-artifact` (plural fix shipped), `repos/skills` (where the
  `bffless:rules-as-code` skill would live), `repos/docs-public` (the guide's home).
- **CLI internals**: commands in `packages/cli/src/commands/`, compiler
  `src/compile/build.ts`, decompiler `src/compile/decompile.ts`, canonical format
  `src/format/`, vm harness `src/harness/run-handler.ts` (node:vm, ES5-ish sandbox),
  client `src/api/client.ts` (injectable fetch, `X-API-Key`), config discovery
  `src/config.ts` (walk-up `.bffless/config.json`, apiKey NEVER from config).
  Tests `test/*.test.ts` (vitest; `pnpm test` = build + run; golden fixtures under
  `test/fixtures/{real,synthetic}`). Developer reference:
  `packages/cli/docs/reference.md`.
- **Sync wire**: `PUT /api/proxy-rule-sets/project/:id/sync` (`SyncRequestBody` /
  `SyncResponse` in `src/api/sync-types.ts`); export `GET /api/proxy-rule-sets/:id/export`;
  `source` jsonb (repo/path/gitSha/syncedAt/contentHash) stamped per sync — the natural
  anchor for a revisions feature.
- **Live instance**: j5s.dev runs CE v0.2.2; project `bffless/apps`
  (id c3b71936-c5f0-4d20-bd3c-d5887289f9d0); sets: studio, studio-blog, reader, handoff,
  handoff-rss-feed. Reusing the MCP `X-API-Key` for CLI/API calls is operator-approved
  practice (key in the Claude MCP config).
- **Methods-split sets still 400 on sync** (Phase 1 limitation, still open); set
  `description`/`environment` omission preserves live values.

## Process & operator constraints (carry-overs + Phase 2 lessons)

- Subagent-driven worked a third time: bite-sized TDD plan doc
  (`docs/plans/proxy-rules-as-code-phase3-implementation.md`), fresh implementer per
  task, independent adversarial review per task, whole-branch review per repo (most
  capable model), fix rounds + re-reviews. Ask the operator's open questions FIRST.
- **Ask before push/PR/publish/merge; per-task commits pre-approved on feature branches;
  never force-push.** Parallel implementers only across DIFFERENT repos; forbid
  `git stash/restore/checkout/reset` in every subagent prompt; `git show HEAD:<path>`
  for baseline reads.
- No local DB on this VPS; backend tests mock the DB. Verify frontend-affecting test
  changes with the app's `build` (tsc), not just the vitest run.
- Release mechanics: CE release-please needs `Release-As:` in a MAIN-branch commit body
  (squash merges drop PR-body footers — verify the squash message, or push an empty
  `chore: release X.Y.Z` commit after). CE deploys pin image tags — operator bumps
  `.env` + deploys. Docker-context failures don't reproduce locally: verify Dockerfile
  changes with `docker build --target builder`.
- deploy-proxy-rules releases: rebuild dist AFTER dep changes, `git add -A dist/`
  (chunk renumbering), full `pnpm test` (smoke test runs the real bundle).
- GitHub Actions can't run locally — unit-test the TS, smoke-test bundles, and treat the
  first real workflow runs as part of verification.
