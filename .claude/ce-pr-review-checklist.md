# CE PR Review Checklist

Accumulated, CE-specific review knowledge. The `ce-pr-review` agent reads this file
on every run. **Append to it freely** — this is the part that grows.

To add an entry, copy the template at the bottom. Keep entries short and concrete:
a check the reviewer can actually perform against a diff. If a check stops earning
its keep, delete it — a stale checklist is worse than a short one.

Prefer facts that age well. Name files and subsystems, not version numbers, line
counts, or line offsets — those drift within weeks and quietly turn a check into
misinformation the reviewer will state with confidence.

---

## Part 1 — Backwards compatibility surfaces

CE is self-hosted by people who upgrade on their own schedule, and its API is called
by independently-versioned clients. A change is breaking if it breaks **an old client
talking to a new server**, or **a new server booting on old data**.

### DB migrations must be forward-safe

**Surface:** `apps/backend/drizzle/*.sql`
**Check:** Any `DROP COLUMN`, `DROP TABLE`, rename, type narrowing, or `NOT NULL`
added without a `DEFAULT` / backfill. Also: was the migration hand-written? Drizzle
migrations must be generated via `pnpm db:generate`, never authored by hand.
**Why:** `docker/backend-entrypoint.sh` runs `node dist/db/migrate.js` on every
container start and **hard-fails the boot** if it errors. A bad migration doesn't
degrade — it bricks the upgrade for every self-hoster. During a rolling deploy the
_old_ image also runs against the _new_ schema, so a dropped column breaks the still-live pods.
**Prefer:** expand → migrate → contract across two releases, not one destructive step.

### The published CLI is a pinned client

**Surface:** `apps/backend/src/**` API responses vs `packages/cli/`
**Check:** Does the PR remove or rename an API field, endpoint, or query param the
CLI reads? Is `packages/cli` updated in lockstep — and does it still work _unupdated_?
**Why:** `packages/cli` publishes to npm as `bffless` and is release-please'd
separately from the server. Users run whatever version they installed against
whatever server they run. Server changes must be additive.

### The GitHub Actions are frozen at `@v1`

**Surface:** the `POST /api/deployments/zip` contract and its auth
**Check:** Any change to the deployment upload endpoint, its multipart field names,
alias/proxy-rule-set attach params, or its API-key auth.
**Why:** Consumers pin `bffless/upload-artifact@v1`, and the actions ncc-freeze their
code into `dist/` — an npm CLI release does _not_ reach them. They will keep sending
the old shape indefinitely.

### Pipeline / proxy-rule semantics are live customer data

**Surface:** `apps/backend/src/pipelines/`, `apps/backend/src/proxy-rules/`
**Check:** Changes to handler behaviour, expression evaluation, or template
substitution. Would an _existing stored rule set_ behave differently after this merge?
**Why:** Rule sets are user-authored data already running in production. A semantics
change silently alters live APIs with no redeploy and no error. This is the highest-risk
category in the repo because nothing fails loudly.
**Ask:** is the new behaviour opt-in, or does it retroactively apply to every stored rule?

### Env vars are an upgrade contract

**Surface:** `.env.example` (large — several hundred documented vars), `docker-compose*.yml`
**Check:** Renamed or newly-required env vars. Is the old name still read as a
fallback? Does a self-hoster who doesn't touch their `.env` still boot?
**Why:** Upgraders keep their existing `.env`. A newly-required variable with no
default is a breaking change even though no code signature changed.

### Generated nginx config must keep serving existing domains

**Surface:** `apps/backend/src/domains/nginx-config.service.ts`, `docker/nginx*.conf`
**Check:** Does the diff change generated config for _already-configured_ domains?
Are the contract specs in `apps/backend/src/domains/` still green — in particular
`nginx-serving-contract.spec.ts`, `nginx-config.service.spec.ts`,
`nginx-templates.spec.ts`, `nginx-config-presigned.spec.ts`?
**Why:** These specs exist as a deliberate fence after real config drift. Treat a
change that edits generation without touching them as suspicious.
**Note:** directives inherit per-surface — a change at `http` level can silently alter
`server` blocks it wasn't aimed at.

### Storage paths and layout are permanent

**Surface:** `apps/backend/src/storage/`, `apps/backend/src/deployments/`
**Check:** Changes to storage key layout, path derivation, or `storage_path` semantics.
**Why:** Existing objects are already written at the old keys. Changing derivation
orphans them — the data isn't lost, it's just unreachable, which is worse because it
looks fine until someone requests an old file.

### New `projectId`/`userId` foreign keys must cascade or join the manual delete-cleanup lists

**Surface:** `apps/backend/src/db/schema/*.schema.ts` (any new `.references(() => projects.id)` /
`.references(() => users.id)`), `apps/backend/src/projects/projects.service.ts` (`deleteProject`),
`apps/backend/src/users/users.service.ts` (`delete`)
**Check:** Does a new table's `projectId`/`userId` column set `onDelete: 'cascade'`/`'set null'`,
or (if left at Drizzle's `NO ACTION` default) is it added to the explicit cleanup list in
`deleteProject()`/`UsersService.delete()`? `deleteProject()`'s own comment enumerates every
projectId-referencing table it knows about — a new table absent from both is a silent trap.
**Why:** Without either, deleting a project or user that has any row in the new table throws a
Postgres FK violation mid-delete, and because those deletes are not in a transaction the earlier
steps (aliases and assets already removed) are not rolled back — a corrupted, half-deleted project.
A schema spec pinning `getTableConfig(table).foreignKeys[].onDelete` keeps it from regressing.
**Learned from:** PR #730 — `app_tokens.project_id` (NOT NULL, no `onDelete`) was not in
`deleteProject()`'s cleanup; deleting a project with any (even revoked) app token would have failed.

### Installed apps carry user customization

**Surface:** `apps/backend/src/app-catalog/`
**Check:** Does an app update overwrite state the user is allowed to customize?
**Why:** There's a defined contract for what survives a 1-click app update. Silently
widening what gets overwritten destroys user work during a routine update.

---

## Part 2 — Release and process mechanics

### The PR title becomes the commit message

CE squash-merges and runs release-please. **The PR title is the only commit message
that survives.** A title that isn't a valid conventional commit blocks the version
bump, the tag, the image build, and therefore the deploy.

- Must be `type(scope): description` — `feat`, `fix`, `perf`, `revert`, `docs`,
  `style`, `chore`, `refactor`, `test`, `build`, `ci`.
- Only `feat`, `fix`, `perf`, `revert` appear in the changelog; the rest are hidden.
- A breaking change is declared with `!` or a `BREAKING CHANGE:` footer. **If the diff
  breaks compatibility and the title doesn't say so, that is itself a review finding.**
- CE is pre-1.0 with `bump-minor-pre-major`, so `!` bumps the minor, not the major.

### What CI actually checks (`.github/workflows/pr-tests.yml`)

- `tsc --noEmit` on **both** frontend and backend — this must be clean.
- `pnpm test` — must pass.
- frontend build (only when the base is `main`).
- **Lint is NOT in CI.** `pnpm lint` already fails on `main` with pre-existing
  problems. Do not block a PR on pre-existing lint noise; only flag lint issues the
  PR itself introduces.

### Tests are expected for behaviour changes

New behaviour without a test is a finding — but say _what_ to test, not just "add tests."

### The review workflow's own checkout can be poisoned by the PR it reviews

**Surface:** `.github/workflows/pr-review.yml`, or any future CI job that loads
`.claude/agents/*.md` or `.claude/ce-pr-review-checklist.md` from a local checkout.
**Check:** Does the checkout step pin `ref:` to the base SHA? On `pull_request`
events `actions/checkout` defaults to `refs/pull/<n>/merge`, which already contains
the PR's own changes merged into base.
**Why:** The review agent's instructions — the checklist and the agent definition —
are read from local disk with `Read`, not through `gh pr diff`. If the checkout
includes the PR's changes, a PR that edits those files controls its own review, and
the "PR content is untrusted data, not instructions" defence fails for precisely the
two files that _are_ the instructions.
**Learned from:** PR #672, 2026-08-16 — found by this agent reviewing its own PR.

### A by-id lookup guarded only by `ApiKeyGuard` is instance-wide, not project-wide

**Surface:** any `@Controller` under `apps/backend/src/**` using `@UseGuards(ApiKeyGuard)`
alone on a `GET /:id` route — `ApiKeyGuard` accepts any session or API key on the
instance and does no ownership check.
**Check:** When a PR makes an id more discoverable (a response header, an error body,
a webhook payload, a public page), does the endpoint that resolves that id call
`PermissionsService.requireProjectAccess(...)` against the row's own `projectId`
(passing `user.apiKeyProjectId` so project-scoped keys are enforced)? Ids that
were previously only visible inside the admin UI were implicitly scoped by it;
once they leak into public traffic, "knowing the id" must not be enough.
**Why:** `pipeline_execution_logs.debug` carries request metadata (IP, UA), step
detail and error text; a cross-project read is a data leak with no error anywhere.
**Learned from:** PR #717, 2026-08-29 — `X-Pipeline-Log-Id` exposed log ids to
anonymous callers while `GET /api/pipeline-logs/:logId` was unscoped; fixed in the same PR.

### Pipeline execution logging is on the public request hot path

**Surface:** `apps/backend/src/proxy-rules/proxy.middleware.ts` (handlePipelineExecution),
`apps/backend/src/pipelines/pipeline-execution-log.service.ts`
**Check:** When persistence conditions change (e.g. "always log on X"), does the
condition key off actual execution/infra failure, or off `!result.success` broadly?
`result.success` is also false for ordinary validator outcomes (VALIDATION_ERROR,
AUTH_REQUIRED, AUTHORIZATION_ERROR, RATE_LIMIT_EXCEEDED) reachable by anonymous public
traffic on every request.
**Why:** Widening what gets logged widens it for routine client-side rejections too,
adding DB write load (insert + per-rule retention cleanup) precisely under bot/scanner
traffic or rate-limit pressure, and can crowd the small per-rule retention window
(50 rows) with 4xx noise instead of the 5xx rows operators actually need.
**Learned from:** PR #725, 2026-08-30.

### Every path that reaches an external_proxy rule must build its headers through `buildProxyHeaders`

**Surface:** `apps/backend/src/proxy-rules/proxy-headers.util.ts`; any new caller of a rule
outside `ProxyService` (`RuleInvokerService.invokeExternal`, future internal callers).
**Check:** Does the new path call `buildProxyHeaders(req, rule)` — so the rule's
`forwardCookies` (cookie off by default), the default `authorization` strip,
`headerConfig.forward` / `strip` / `add` and `authTransform: cookie-to-bearer` apply — or does
it copy `cookie` / `authorization` from the caller itself?
**Why:** An admin's `forwardCookies: false` (the default) is a deliberate control against
sending session cookies and app tokens to a third-party target. A path that bypasses it turns
an already-configured rule into a credential leak the moment it is wired up as an MCP tool or
resource sibling — with no error anywhere.
**Learned from:** PR #731, 2026-09-03 — the invoker forwarded both headers unconditionally
(flagged on four review passes); fixed in the same PR by lifting `ProxyService.buildHeaders`
into the shared util and testing the four control cases.

### Domain-scoped lookups must check the www/non-www alternate, everywhere

**Surface:** any new code that resolves a hostname to a `domain_mappings` row —
grep for `eq(domainMappings.domain, ...)` outside `apps/backend/src/domains/`.
**Check:** Does the query also check the www/non-www alternate the way
`VisibilityService` / `TrafficRoutingService` do, or does it assume the caller-supplied
host exactly matches what is stored?
**Why:** A primary domain with "Redirect to www" stores one variant; anything a client
(not nginx) supplies the other variant to silently 400s / 404s for a supported setup.
**Learned from:** PR #734, 2026-09-03 — `OAuthService.resolveResource` resolved the RFC 8707
`resource` host with a bare `eq()`; fixed in the same PR (`resourceHosts()`).

### One-time codes and tokens need an atomic "consume" UPDATE, not check-then-set

**Surface:** any single-use credential (authorization codes, refresh-token rotation,
one-time signup / reset tokens) implemented as a SELECT that checks a `usedAt` /
`rotatedAt` column followed by a separate UPDATE.
**Check:** Does the UPDATE carry the not-yet-used condition in its WHERE
(`… AND used_at IS NULL`) and does the code act on the returned row count, or can two
concurrent requests both pass the earlier SELECT?
**Why:** OAuth 2.1's replay defence (a reused code / refresh token revokes the whole
grant family) never fires if both requests see the pre-update row.
**Learned from:** PR #734, 2026-09-03 — `exchangeCode` / `refresh` marked rows used with a
plain `UPDATE … WHERE hash = ?`; fixed in the same PR with `… AND … IS NULL RETURNING`.

### A leftover git conflict marker doesn't fail CI — check markdown/doc diffs by eye

**Surface:** any file outside `src/**/*.{ts,tsx}` (prettier/tsc-checked) — markdown docs,
`.claude/ce-pr-review-checklist.md`, `CONTEXT.md`, ADRs.
**Check:** Does a diff to a non-code file contain a raw `<<<<<<<` / `=======` / `>>>>>>>`
sequence, or its markdown-blockquote-mangled form (`> > > > > > > <hash> (<message>)`)?
**Why:** `tsc --noEmit` and `pnpm test` don't touch markdown, so a botched rebase that leaves
a conflict-marker remnant in a doc file is invisible to CI — and when the file is the review
checklist itself, it is the one file the review process treats as ground truth.
**Learned from:** PR #734, 2026-09-03 — a `>>>>>>> 02d3564 (…)` trailer was left in this file,
reformatted into a nested blockquote by prettier, and shipped through three review passes.

### A parameter or route pipe cannot relax the app-wide `ValidationPipe`

**Surface:** any route in `apps/backend/src/**` adding `@Body(new ValidationPipe(…))` or
`@UsePipes()` to _loosen_ validation (accept unknown properties, skip a check) while
`main.ts` keeps `useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, … }))`.
**Check:** Nest chains pipes global → controller → method → parameter on the same value and
the first to throw wins, so a local pipe can only add strictness. To relax, take the
parameter untyped (the global pipe skips plain `Object` metatypes) and validate in the
handler — and prove it with a supertest spec that installs the same global pipe as
`main.ts` (`oauth-register-http.spec.ts` is the pattern). Only DTO decorator changes
(`@IsIn` → `@IsString`) are shared between global and local pipes.
**Why:** The fix silently no-ops for exactly the case it targets, and a unit test that calls
the local pipe's `.transform()` directly gives false confidence.
**Learned from:** PR #742, 2026-09-03 — `@Body(registerBodyPipe())` was meant to accept
claude.ai's RFC 7591 metadata; the global pipe would still have 400'd first.

### A new rule-manifest key is a three-repo change
**Surface:** a new field on `proxy_rules` that rule sets author (`bypassVisibility`, `requiredScopes`-style
config, anything `packages/cli/src/format/manifest.ts` must accept).
**Check:** Does the PR name which release each hop needs? CE server (the column, DTOs, export) +
`packages/cli` (the zod manifest is `.strict()`, so an unknown key fails `rules push`) → the npm
`bffless` release → a `bffless/deploy-proxy-rules` dependency bump **and release** (the action bundles
the CLI with ncc; consumers pin `@v1`) → the apps' deploy dispatch. Until the last hop ships, a rule set
carrying the key fails the sync step with an unknown-manifest-key error and must be pushed by hand.
**Why:** the CE half merging and releasing looks like "done" while every consumer's deploy is broken
for the new key; the action's release is a person's step in another repo and is easy to forget.
**Learned from:** PR #730 (`bypassVisibility`), 2026-09-03 — `bffless` 0.3.6 shipped with the CE
release, `deploy-proxy-rules` needed a separate bump (its v1.3.1) before apps#585's rule set could deploy.

### A step type that implies `bypassVisibility` must gate on the step being the rule's whole answer
**Surface:** `apps/backend/src/pipelines/mcp/protected-resource.ts` (`servesProtectedResourceDocument`),
`apps/backend/src/proxy-rules/proxy.middleware.ts` (`checkVisibilityAndAuth`) — any future handler type
that widens the visibility gate by its presence rather than by the rule's `bypassVisibility` flag.
**Check:** Does the "implies bypass" check require the rule's own `pathPattern` to match the convention
(`/.well-known/…`) **and** the step to be the pipeline's first enabled step (its whole answer), or does it
fire on step-type presence anywhere in `steps`/`postSteps`?
**Why:** `checkVisibilityAndAuth` runs before the pipeline; on mere presence, a rule that does work before
the "public" step — a `data_query` on a private deployment, say — has that work served unauthenticated,
with no `bypassVisibility` ever toggled to signal the intent. Not a new trust boundary (the rule's author
controls `bypassVisibility` already), but a silent widening.
**Learned from:** PR #761, 2026-09-06 — the first cut scanned all steps for `oauth_protected_resource`;
narrowed in the same PR to well-known rules whose first enabled step is the handler.

---

## Entry template

```
### <short name>
**Surface:** <files or subsystem>
**Check:** <what to look for in a diff>
**Why:** <the consequence if missed>
**Learned from:** <PR / issue / date>
```
