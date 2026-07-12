# Skills as Synced Resources — Evaluation Memo (design §3.5)

Status: **evaluation only — no code change proposed for Phase 3**
Companion to: `docs/plans/proxy-rules-as-code.md` §3.5
Date: 2026-07-12
Question: now that proxy rules sync to the DB via `bffless rules push`, should the AI
skills those rules reference sync the same way — instead of riding the uploaded deployment
artifact as they do today?

This memo answers §3.5's Phase-3 question. It grounds every mechanism claim in current
source on branch `phase3/proxy-rules-as-code`, evaluates three options, and commits to one
recommendation with explicit revisit triggers.

## 1. Status quo mechanics — two transports from one repo

A pipeline sources two git-authored inputs, and they reach the running instance by
different roads.

**Rules travel by DB sync.** `bffless rules build` compiles the `.bffless/proxy-rules/<set>/`
layout to the v2 export envelope (`packages/cli/src/compile/build.ts:230` `buildRuleSet`,
envelope assembled at `build.ts:418-425`), and `bffless rules push` applies it to
`proxy_rule_sets` / `proxy_rules` through the sync endpoint. The DB is the runtime source of
truth for rules.

**Skills travel by artifact upload.** `ai_handler` steps name skills
(`skills: { mode: "selected", enabled: ["image-prompts"] }`), and CE's `SkillsService`
resolves them *at request time from the serving deployment's storage*, not from any DB
table. The storage prefix is
`{owner}/{repo}/commits/{commitSha}/{skillsPath}/`, with `skillsPath` defaulting to
`.bffless/skills` (`apps/backend/src/pipelines/skills.service.ts:66-68` for `listSkills`,
`:126` for `loadSkill`). The `owner/repo/commitSha` triple comes from the deployment context
of the request being served: `ai.handler.ts:327-336` reads `context.deployment.{owner,repo}`
and resolves the commit via `resolveSkillsCommitSha(...) ?? context.deployment.commitSha`.
If there is no deployment context, skills are silently disabled
(`ai.handler.ts:377-380`), and any load failure is swallowed — the request proceeds
skill-less (`ai.handler.ts:373-376`). So skills are delivered by `bffless/upload-artifact`
publishing `.bffless/skills` as served content (`repos/apps/.github/workflows/deploy-studio.yml:69-77`,
scoped with `base-path: .bffless/skills` per the §3.1 caveat), on a wholly separate CI step
from the rules sync (`deploy-studio.yml:43-54`).

**Deployment-pinning is the default, not an invariant.** Every project carries an optional
`settings.skillsAlias` (`apps/backend/src/projects/project-ai-settings.service.ts:678-716`,
admin-facing at `GET`/`PUT :id/ai/skills-alias`,
`apps/backend/src/projects/projects.controller.ts:273-297`). `resolveSkillsCommitSha`
(`project-ai-settings.service.ts:724-745`) looks up that alias's current `commitSha` when one is
set, and `ai.handler.ts:327-336` uses the result in place of the serving deployment's own commit:
`resolveSkillsCommitSha(context.projectId, context.deployment.commitSha) ?? context.deployment.commitSha`.
So there are really three skills-resolution modes, not one: (1) `skillsAlias` unset (today's
default) → deployment-pinned, as described above; (2) `skillsAlias` set → every `ai_handler` step
in the project resolves skills from *that alias's* commit, project-wide, regardless of which
deployment or preview alias is actually serving the request; (3) no deployment context → skills
disabled (`ai.handler.ts:377-380`). Mode (2) already exists in CE today and is off by default —
but once a project turns it on, per-PR preview scoping of skills (assumed through the rest of
this memo) is gone: every preview reads the pinned alias's skills, not its own.

**Where they desync.** Because the two transports are independent, four states are
reachable that git says are impossible:

- Rules pushed, artifact not re-uploaded (or upload step failed): a new `ai_handler` names a
  skill that isn't in the serving deployment yet → runtime skill-not-found (logged warn at
  `skills.service.ts:150`, request continues degraded).
- Artifact uploaded, rules not pushed: skill present but no rule references it — harmless but
  invisible drift.
- A live admin-UI/MCP edit adds a skill reference to a set that git never sync-checked.
- An alias is re-pointed to an older deployment (rollback of *content*): the rules are
  current but the skills regress to that commit's `.bffless/skills`, because skills are
  pinned to whatever commit the alias serves.

**What the Phase 0–2 cross-reference check catches — and what it doesn't.** The compiler and
validator statically collect referenced skill names: `collectSkillRefs`
(`build.ts:212-221`, invoked at `build.ts:362-363`, surfaced on the build result at
`build.ts:431`; the validator has its own manifest-level collector at
`packages/cli/src/commands/validate.ts:218-234`). `bffless rules validate` step 4
(`validate.ts:344-365`) then cross-checks each referenced skill against the sibling
`.bffless/skills/` root located by `findSkillsRoot` (`validate.ts:241-251`):

- A referenced skill missing from an *existing* skills root is a hard **error**
  (`validate.ts:356-362`) — the dangling reference that used to be a runtime surprise now
  fails the build.
- If the rule set isn't nested under a `.bffless/proxy-rules/` layout at all, or the skills
  root doesn't exist, it downgrades to a **warning** (`validate.ts:349-353`) — and only fires
  when the set actually references a skill (`validate.ts:347`).

This is a **same-repo, same-commit** guarantee only. It proves the skill file exists next to
the rules *in git at build time*. It cannot prove the skill will be present in the storage
prefix the alias serves at request time, because it has no visibility into which deployment
artifact is (or will be) attached to which alias. Every desync in the list above — CI step
skew, live edits, alias/content rollback — passes validate and still fails (or silently
degrades) at runtime.

## 2. Options

### (a) Keep as-is — two transports, static cross-ref only

Skills stay artifact-delivered and deployment-pinned; the build-time cross-ref check remains
the only guard. No CE change. This is the Phase 0–2 end state, carried forward unchanged.

### (b) Full sync — skills become a DB-synced, project-scoped resource

The §3.5 sketch: `rules push` bundles the referenced skills into the sync payload; CE stores
them in a new project-scoped table (`project_skills` keyed by `(projectId, name)`, holding
name/description/body/contentHash); `SkillsService` resolves **DB-first, storage fallback**.
Skills then apply atomically with the rules that reference them and exist independent of
which commit an alias serves. Cost: one new table + migration, a dual-resolution branch in
`SkillsService.listSkills`/`loadSkill`, sync-payload growth, and the loss of
skills-pinned-to-deployment semantics.

### (c) Middle path — drift *detection*, not delivery (recommended default if any action is taken)

Keep artifact delivery exactly as-is, but make the desync observable instead of silent.
Two low-surface pieces:

- **Stamp a skills content hash at sync.** `rules push` already receives the compiled result,
  which carries the resolved skill-ref list (`build.ts:431`). Have the CLI additionally hash
  the referenced skills' bytes and record `{ skillRefs[], skillsHash }` in the existing
  `source` jsonb that sync writes to `proxy_rule_sets` (design §4.3). No new table, no
  resolution change — just provenance.
- **Compare in the existing drift job.** The scheduled `bffless rules diff` job
  (`repos/apps/.github/workflows/rules-drift-check.yml`) recomputes the skills hash from git
  and compares; a mismatch, or a referenced skill absent from the currently-attached
  deployment, is reported the same way rule drift is. This closes the CI-skew and
  live-edit blind spots without touching the runtime resolution path.

Worth flagging: hashing is the first CLI codepath that reads skill file *contents* rather than
just names or existence. Today, `build`/`validate` never open a skill file: `collectSkillRefs`
only gathers referenced *names* out of `skills.enabled` (`packages/cli/src/compile/build.ts:212-221`),
and `rules validate`'s cross-ref (§1) is an `existsSync` presence test
(`packages/cli/src/commands/validate.ts:356`), never a read. So (c) is cheap, but not literally
free — it adds a real (if small) file-read-and-hash step to the CLI.

(c) is strictly a superset of (a)'s guarantees and a strict subset of (b)'s surface. It does
**not** fix atomicity or content-rollback pinning — it only makes them visible.

## 3. Evaluation

**Atomicity of rules + skills changes.** Only (b) delivers it: one payload, one transaction,
rules and their skills apply or fail together. (a) leaves the two-CI-step race intact; (c)
detects a post-hoc mismatch but a window still exists between the rules sync and the artifact
upload. For Studio today this window spans the workflow's rules-sync step
(`deploy-studio.yml:43-54`) and its skills-upload step (`:69-77`), with the app's own
artifact-upload step (`:56-63`) sandwiched in between them — not two adjacent steps, but small
regardless — and a failed skills upload degrades gracefully rather than erroring
(`ai.handler.ts:373-376`). Atomicity is real but low-stakes at current scale.

**Versioning semantics — is deployment-pinning a feature or a bug?** Under (a)/(c) a skill
version *with the content it serves*: roll an alias back to an old deployment and its
`ai_handler` prompts revert in lockstep with everything else that commit shipped — **provided
the project's `skillsAlias` is unset (§1).** When `skillsAlias` *is* set, that guarantee narrows:
skills follow whichever alias `skillsAlias` names, not the alias actually serving the request, so
rolling back a different, serving alias no longer touches skills at all — only rolling back (or
repointing) the pinned skills alias itself does. Under (b), skills live project-scoped and
outlive any single deployment — a content rollback would leave the newest skills in place. **In
real usage today, pinning is the more defensible default.** Studio's two skills — `image-prompts`
(referenced by `studio`'s `api/thumbnail/draft` step,
`repos/apps/apps/studio/.bffless/proxy-rules/studio/rules/api/thumbnail/draft/post/rule.yaml:18-21`)
and `bffless-docs` (referenced by `studio-blog`'s `api/blog` step,
`.../studio-blog/rules/api/blog/post/rule.yaml:135-138` — `skills:` at :135, the `bffless-docs`
name at :138) — are prompt-shaping content authored
in the same repo, same PR, same commit as the rule and the frontend that calls it. A PR
preview that changes the thumbnail prompt *wants* its skill scoped to that preview's
deployment, not promoted project-wide the instant `rules push` runs. Project-scoping (b)
would actively break per-PR skill previews — the headline feature the rules plan exists to
deliver (§5) — unless (b) were redesigned to be preview-aware (e.g. `project_skills` keyed
additionally by alias); that's a heavier design than §3.5's sketch and isn't evaluated here, so
we don't claim (b) as sketched necessarily breaks every possible DB-backed variant, only the one
under evaluation. No app currently ships skills that need to exist independent of a deployment —
and to the extent one did, `skillsAlias` (§1) already delivers most of that: a project can pin
skills to a stable alias today, project-wide, outliving whatever deployment is actually serving
traffic, with zero schema cost. That reinforces rather than weakens the case against (b): the
one property (b) chases that isn't already covered by (a)/(c) is *also* already reachable via a
mechanism CE ships today.

**CE surface cost.** (a) zero. (c) additive-only: a few fields in an already-planned `source`
jsonb and a comparison in an existing job — no schema table, no change to the runtime
resolver. (b) is the heaviest: a new table + Drizzle migration, and a dual-resolution branch
threaded through both `listSkills` (`skills.service.ts:62-107`) and `loadSkill` (`:119-152`)
plus the `load_skill` tool factory (`ai.handler.ts:1252-1289`) — every skills read path
grows a DB-vs-storage fork and a precedence rule to test.

**Migration / rollout.** (a) nothing. (c) ships behind the same CLI/action already being
built for Phase 2 — no CE deploy gating, no data backfill. (b) needs a table migration, a
backfill deciding which existing deployment's skills seed the project rows, a dual-write
period, and a story for self-hosters on older CE.

**Revisions interaction — should skills be in the snapshot?** The revision snapshot is the v2
export envelope verbatim (`proxy_rule_set_revisions.snapshot` typed `RuleSetExport`,
`apps/backend/src/db/schema/proxy-rule-set-revisions.schema.ts:30`), and `RuleSetExport`
carries `ruleSet` / `rules` / `schemas?` and **no skills field**
(`apps/backend/src/proxy-rules/export-format.util.ts:93-99`); the dedupe content hash is
computed over `{ ruleSet, rules, schemas }` only (revisions service doc, `:25-28`). So a
server-side rollback (`rollbackToRevision`, `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts:280`,
applied as a prune=true sync) restores rules and schemas but leaves whatever skills the
serving deployment carries untouched. Position per option:

- **(a): skills correctly stay OUT of the snapshot.** The snapshot versions rules; skills are
  versioned by the deployment artifact. A rules rollback that also silently reverted skills
  would cross two version axes and surprise users. Leave as-is.
- **(c): still OUT — but the drift job should flag the seam.** After a rollback, the restored
  rules may reference a skill hash that no longer matches the attached deployment; (c)'s
  comparison surfaces exactly that, which is the honest behavior.
- **(b): skills MUST enter the snapshot,** because once skills are DB state that `push`
  writes, a revision that omits them is not a faithful point-in-time capture and rollback
  becomes partial. That means widening `RuleSetExport`, the content hash, and every
  golden-file/round-trip test — a materially larger change than the table alone. This is a
  cost of (b), not a separate option.

## 4. Recommendation

**Adopt (a) — keep skills artifact-delivered and deployment-pinned — for Phase 3. Do not
build the project-scoped skills table.** Deployment-pinning is the correct default for how
skills are actually used today (prompt content co-versioned with the rule and frontend that
use it), it is exactly what per-PR previews need, and it keeps skills correctly out of the
revision snapshot. (b) inverts that default, breaks preview-scoped skills, and buys atomicity
that is low-stakes at current scale — for a new table, a dual-resolution runtime fork, and a
widening of the revision envelope. This is reinforced by an existing mechanism (§1): CE already
gives a project an opt-in, zero-schema-cost way to source skills project-wide instead of
per-deployment — `settings.skillsAlias` — so the one legitimate need (b) targets (skills that
outlive a deployment) is *already* reachable without a table. A dedicated `project_skills` table
would only be justified by a need `skillsAlias` genuinely cannot reach (see trigger 2 below).

Treat **(c) drift detection as the pre-approved next increment**, to be pulled in *only* when
the build-time/same-commit guarantee demonstrably stops being enough — i.e. the first time a
runtime skill-not-found (`skills.service.ts:150`) is traced to CI-step skew or a live edit in
production. It is cheap, additive-only, and rides infrastructure Phase 2 already ships.

**Revisit (b) when — and only when — any one of these concrete triggers fires:**

1. **A second app ships `skills.mode: "selected"` skills** *and* at least one of them must be
   shared across rule sets or projects (a skill that is genuinely not co-versioned with one
   deployment's content). Today only Studio does, and both its skills are single-set,
   single-repo.
2. **A skill needs to outlive the deployment that introduced it, in a way `skillsAlias` (§1)
   genuinely can't cover.** `skillsAlias` already lets a project pin skills to a stable alias's
   commit independent of whichever alias is serving a given request, which covers "rolling back
   the *serving* alias must not roll back skills" today. What it can't do: materialize skill
   content with no backing commit at all (e.g. a skill edited via admin UI/MCP that was never
   part of an uploaded artifact), or give different rule sets/steps in the *same* project
   different skill provenance simultaneously (`skillsAlias` is one project-wide pin, not
   per-skill). A genuine need for either is the real trigger — not merely "a skill outlives a
   deployment," which `skillsAlias` already handles.
3. **Preview-scoped skills stop being wanted** — if the team decides skill changes should go
   project-wide on `rules push` rather than per-PR-alias, the pinning feature becomes a
   liability and (b)'s project-scoping becomes the right model.

Until one of those is observed in real usage, (a) stands and (c) is the only change worth
building.
