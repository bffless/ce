# App Catalog — 1-Click App Install — Design Spec

**Date:** 2026-07-30
**Status:** Draft for review
**Scope:** `repos/ce` (new backend `apps` module, `installed_apps` table, admin **Apps** page), `repos/apps` (bundle-build CI job, manifest per app, registry publish)
**Depends on:** `2026-07-30-local-fs-presigned-uploads-design.md` — **ship that first.** It's what lets Handoff pass the storage preflight on a stock install instead of being permanently gated behind a bucket decision.

## Problem

Installing Handoff onto a self-hosted CE today means: fork `bffless/apps`, set two repo variables and a secret, register the BFFless MCP against your instance, provision a project in the admin panel, import a rule set and attach it to an alias, create data tables by hand, run a GitHub Actions workflow, and configure a domain mapping. `GETTING-STARTED.md` walks through it in seven numbered steps with a variables checklist.

That flow has real teaching value and stays supported. But it is a poor first experience: a new CE install has nothing running on it, and the shortest path to seeing the platform actually *do something* runs through GitHub. An app that installs from the dashboard in one click is a far better demo, and it doubles as a worked reference configuration the user can read — real pipelines, real data tables, real ACLs — rather than a blank project.

Concretely, a Handoff install has seven obligations (from `apps/handoff/bffless/README.md`):

1. A project (`owner/name`)
2. Two rule sets — `handoff` (27 rules) and `handoff-rss-feed` (2) — attached to an alias
3. Three data tables — `handoff_nodes`, `handoff_share_links`, `handoff_comments`
4. A deployment: the built `dist/` on the `handoff` alias
5. A domain mapping at `handoff.<primary>`, `isPublic`, `isSpa`, path `/apps/handoff/dist`
6. Presigned-capable storage
7. CE new enough to have `GET /api/users/directory`

## What already exists (and why this is smaller than it looks)

The single most important finding: **CE already has the applier for rule sets.**

`PUT /api/proxy-rule-sets/project/:projectId/sync` (`proxy-rules/proxy-rule-sets.controller.ts:119`) is the declarative rules-as-code endpoint. Per its own description it is idempotent, matches rules on `(pathPattern, method)`, writes only real differences, deletes live-only rules **only** under `options.prune`, **resolves bundled schemas by name**, preserves live secrets on blank header values, returns a full change plan under `options.dryRun`, stamps `repo`/`path`/`gitSha` provenance, and regenerates nginx when anything changed. `schema-sync.util.ts` implements resolve-or-create-by-name with field-mismatch reporting (`SchemaResolution`).

`bffless rules push` is a thin client over this endpoint. So the "remap the source project's table UUIDs by hand" chore that a dashboard import suffers is already solved server-side — the installer calls the same endpoint the CLI does, and there is no second implementation to keep in sync.

Also already present:

- `POST /api/deployments/zip` accepts `proxyRuleSetNames[]` / `proxyRuleSetIds[]` (`deployments/deployments.dto.ts:152,163`) — so *upload the dist*, *set the alias*, and *attach the rule sets* are *one* call, the same one `upload-artifact` makes.
- `POST /api/domains` takes `domainType: 'subdomain'`, `path`, `isPublic`, `isSpa` (`domains/dto/create-domain.dto.ts`).
- `bootstrap-dns-preflight.service.ts` — a self-probe that reports whether a hostname actually reaches this server.
- `pipeline-schemas` (data tables) and `pipeline-schedules` modules, for apps that declare schedules.
- The feature-flag registry (`FLAG_DEFINITIONS`, `@RequireFeatureFlags`, client exposure) — `ENABLE_PRIMARY_SSL_MANAGEMENT` is the shape to copy.

## Scope decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trigger | **Admin → Apps catalog, 1-click** | Not first-boot seeding: an install has real preconditions (storage, DNS) that deserve a preflight and an opt-in, and a catalog generalizes to Studio/Reader. |
| Generality | **General mechanism, Handoff as the first entry** | The apps repo already enforces a per-app convention (`pnpm apps:check`, `docs/app-pipelines-convention.md`) that makes a shared manifest tractable. |
| Bundle source | **Fetched from a GitHub release** | Keeps the CE image small and decouples app releases from CE releases. |
| Registry | **Remote index, first-party apps only** | No arbitrary-URL install field. An app bundle contains server-side executable handler code, so the trust surface stays curated. |
| Target project | **Picker with a sensible default** | A project's `owner/name` can never be renamed, so auto-creating one the user didn't choose is a permanent decision made on their behalf. |
| Lifecycle | **Tracked record: version, update, uninstall** | What makes it a catalog rather than a one-off importer. Drift detection is deliberately out. |
| Relationship to forking | **An "eject to your own repo" path** | 1-click to try; fork when you want to change it. The install becomes the fork's deploy target, so ejecting is continuous. |
| App URL | **Subdomain + serving-model-aware cert step** | Reuse the DNS preflight, then branch on how the box serves TLS. |
| Engine | **CE applier over a CI-prebuilt bundle** | CI compiles (the CLI already does), CE applies. No node runtime in the backend container; no duplicated push semantics. |
| Platform mode | **Supported, with the cert step delegated** | See below — this was corrected during review. |

### On `PLATFORM_MODE`

An earlier draft disabled the feature in platform mode by analogy with the bootstrap/SSL work. That was wrong. Domain mappings are a first-class platform-mode feature: `nginx-config.service.ts` has dedicated `generateCustomDomainConfigPlatformMode` (:419) and `generateSubdomainConfigPlatformMode` (:618) branches, and `domains.service.ts` notifies the Control Plane to provision SSL for platform domains (:333, :405) including deferred SSL (:1498).

The only genuinely platform-incompatible piece is **primary-domain certificate issuance**, which `primary-ssl.service.ts:41` and `setup.service.ts:231` already refuse under `PLATFORM_MODE || SSL_MANAGED_EXTERNALLY` because there it is Traefik's job.

So: the catalog is **available in platform mode**, and the applier's cert step becomes *delegate to the Control Plane* — which is what `domains.service.create` already does. The preflight additionally requires `CONTROL_PLANE_URL` and `WORKSPACE_ID` to be configured, and reports one honest constraint rather than papering over it: a workspace serves at `<workspace>.<platform>`, so a subdomain mapping is `handoff.<workspace>.<platform>` — **two labels deep, which a `*.<platform>` wildcard does not cover.** The preflight surfaces the resulting certificate-coverage question instead of assuming it resolves.

## The bundle (produced by `repos/apps` CI)

On release, a new CI job emits `<app>-v<version>.bundle.zip`:

```
bffless-app.json          # manifest, schemaVersion: 1
rulesets/
  handoff.json            # exactly `bffless rules build` output
  handoff-rss-feed.json
dist/                     # what deploy-handoff.yml uploads today
```

The manifest declares four things:

```jsonc
{
  "schemaVersion": 1,
  "id": "handoff", "name": "Handoff", "version": "1.4.0",
  "summary": "…", "iconUrl": "…", "docsUrl": "…", "sourceUrl": "…",

  "requires": { "presignedStorage": true, "ceMin": "0.2.0" },

  "install": {
    "alias": "handoff",
    "deployment": { "path": "dist", "basePath": "/apps/handoff/dist" },
    "ruleSets": [
      { "file": "rulesets/handoff.json",          "attachToAlias": true },
      { "file": "rulesets/handoff-rss-feed.json", "attachToAlias": true }
    ],
    "domain":    { "subdomain": "handoff", "isPublic": true, "isSpa": true },
    "schedules": [],
    "manualSteps": [
      { "id": "bucket-cors", "title": "…", "body": "…", "deepLink": "…",
        "appliesWhen": "bucketStorage" }
    ]
  },

  "eject": {
    "repo": "bffless/apps", "appPath": "apps/handoff",
    "deployWorkflow": "deploy-handoff.yml",
    "variables": ["BFFLESS_URL", "BFFLESS_PROJECT"],
    "secrets": ["BFFLESS_API_KEY"]
  }
}
```

Notes on the shape:

- **`requires` is read only by the preflight**, so a future app that needs no bucket simply omits `presignedStorage`. `ceMin: "0.2.0"` is Handoff's real floor: the people-picker's `GET /api/users/directory` landed in ce#368, whose first containing tag is `bffless-v0.2.0`.
- **`manualSteps`** carries the human-only residue each app's README documents — AI provider tokens, bucket CORS, response-header rules — rendered as a post-install checklist instead of being silently skipped. `appliesWhen` keeps the checklist honest: after the presigned prerequisite ships, a local-FS install is same-origin and the bucket-CORS step genuinely doesn't apply.

  `appliesWhen` is a **closed enum evaluated by CE**, not an expression language — `always` (the default when omitted), `bucketStorage`, `localStorage`, `platformMode`, `selfHosted`. Anything else fails manifest validation. A mini-expression evaluator would be an unbounded, and unnecessary, surface.
- **`eject`** exists so the take-ownership panel is generated per app rather than hand-written.
- **The built rule-set JSON, not the authored `.fn.js`/YAML tree.** The sync endpoint's payload *is* the built form and `bffless rules build` already produces it, so CI does the compiling and CE never parses YAML or handler source.

## The registry

Published from the apps repo by CI as a static deployment at `apps.bffless.dev/registry.json` — which dogfoods the product and gives a stable URL with its own cache rules.

```jsonc
{ "schemaVersion": 1,
  "apps": [ { "id": "handoff", "version": "1.4.0",
              "bundleUrl": "https://github.com/bffless/apps/releases/download/…/handoff-v1.4.0.bundle.zip",
              "sha256": "…", "summary": "…", "iconUrl": "…", "requires": { … } } ] }
```

CE caches it (~1 h TTL) and degrades to "catalog unavailable" without affecting installed apps. The URL is pinned in config as `APPS_REGISTRY_URL`, overridable for air-gapped or self-published catalogs — but there is no arbitrary-URL field in the UI. The `sha256` is verified after download; a mismatch aborts before anything is written.

## CE `apps` module

Gated by `ENABLE_APP_CATALOG` (client-exposed, following `ENABLE_PRIMARY_SSL_MANAGEMENT`).

### State

An `installed_apps` row per install: `appId`, `version`, `projectId`, `alias`, `domainId`, `ruleSetIds[]`, `schemaIds[]` (captured from the sync response's `schemaResolutions`), `bundleSha256`, `installedAt`, `installedBy`, `manualStepsAcked`, `status`. This is what powers the update badge, uninstall, and eject.

### Endpoints

Admin-only — `SessionAuthGuard` + `RolesGuard` + `FeatureFlagGuard`.

| Route | Purpose |
|---|---|
| `GET /api/admin/apps` | catalog: registry ∪ installed, each with its **instance-level** gate verdicts |
| `POST /api/admin/apps/:appId/preflight` | the **project-scoped** checks for a chosen project; verdicts + remediation |
| `POST /api/admin/apps/:appId/install` | start job → `{ jobId }` |
| `GET /api/admin/apps/jobs/:jobId` | step-by-step progress |
| `POST /api/admin/apps/installed/:id/update` | update to the registry version |
| `DELETE /api/admin/apps/installed/:id` | uninstall |
| `GET /api/admin/apps/installed/:id/eject` | take-ownership payload |

Install runs as a **background job** — two network fetches plus roughly six writes is too long for a request — with a progress record the UI polls, one entry per step.

### Applier steps

Each step is idempotent and individually reported:

1. **Preflight** (below).
2. **Fetch** the bundle, verify `sha256`, unzip to a temp dir, validate the manifest.
3. **`POST /api/deployments/zip`** with `dist/`, the alias, and `proxyRuleSetNames[]` — one call covering deploy, alias, and rule-set attachment.
4. **Per rule set: `PUT /api/proxy-rule-sets/project/:id/sync`**, with **`dryRun` first** so the plan is shown before anything is written. Capture `schemaResolutions` into `installed_apps.schemaIds`.
5. **Domain**: create the `<sub>.<primary>` subdomain mapping with `path`, `isPublic`, `isSpa`.
6. **Certificate**, branching on how the box serves TLS:
   - wildcard cert present → use it (this is already what `domains.service.ts:681-686` requires: it *silently ignores* `sslEnabled` for a subdomain when no wildcard exists)
   - proxied / self-signed origin → nothing needed
   - direct + Let's Encrypt → re-issue the primary cert with the app subdomain added to the SANs
   - `PLATFORM_MODE` → delegate to the Control Plane, as `domains.service.create` already does
7. **Schedules**, if declared.
8. **Record**: write `installed_apps`; surface the `manualSteps` checklist.

### Preflight gates

The gates split by what they need to know, and the two endpoints above reflect that split:

- **Instance-level** gates — storage, CE version, platform mode — depend only on the instance, so `GET /api/admin/apps` can evaluate them for every card. These are what drive the disabled *"Requires bucket storage"* CTA.
- **Project-scoped** gates — name collisions, data-table reuse, DNS for `<sub>.<primary>` — cannot be evaluated until the user has picked a target project, so they run in the install dialog via `POST …/preflight`.

Getting this split wrong would mean either a catalog that can't render its own CTA states or one that claims a verdict it had no information to reach.

Each gate returns a verdict plus remediation text and a deep link.

| Check | Scope | Behaviour |
|---|---|---|
| Presigned storage (`supportsPresignedUrls()`) | instance | **Hard refuse.** Once the prerequisite spec ships, local FS passes this and a stock install needs no storage decision. Until then, remediation names both routes — bundled MinIO (`ENABLE_MINIO=true` + restart) and a real bucket — as *instructions*, because the backend cannot flip a compose profile. |
| CE version ≥ `requires.ceMin` | instance | Hard refuse. |
| Platform mode | instance | Requires `CONTROL_PLANE_URL` + `WORKSPACE_ID`; reports the two-label subdomain certificate-coverage constraint. |
| DNS | project | `bootstrap-dns-preflight.service` probe of `<sub>.<primary>`. **Blocking but retryable** — "add this record, then Retry" — not fatal. |
| Name collisions | project | An existing alias, domain, or rule set of the same name not owned by an install → **refuse rather than clobber.** |
| Data-table collision | project | **Warning, not a block.** Reusing a same-named table is the documented adoption path, so a `fieldMismatch` from the sync response is surfaced, not fatal. |

### Failure handling

Not a transaction. The job records what it created, so a failure past step 3 offers an undo that deletes **only this job's** objects — never a reused data table, never a pre-existing domain. Beyond that the answer is resume/re-run, which the idempotent sync endpoint makes safe.

## Admin UI

New admin-only nav item **Apps** — `pages/AppsPage.tsx` plus an `appsApi` RTK Query slice, wired like `ProxyRuleSetsPage` / `PipelineSchedulesPage`.

One card per app, with a state-derived call to action:

| State | CTA |
|---|---|
| preflight clean | **Install** |
| gate failed | disabled — *"Requires bucket storage"* / *"Requires CE ≥ 0.3.4"*, plus a "Why?" link to remediation |
| installed | **Installed · v1.4.0** + **Open ↗** |
| newer in registry | **Update to v1.5.0** |

**Install dialog, three screens.**

*Review* — the target project (picker over existing projects plus "create new", preselected when exactly one exists, noting that a project name can never be renamed), the URL the app will get, the preflight results, and the **`dryRun` sync plan** in plain language: *"27 rules created · 3 data tables: 1 reused, 2 created."* Nothing is written that wasn't shown first.

*Working* — the job's step list with live status. The DNS step can sit in a retryable "waiting for DNS" state displaying the exact record to add.

*Done* — the app URL, an Open button, and the `manualSteps` checklist with acknowledgement checkboxes.

## Lifecycle

**Update** reuses the same job machinery: fetch the new bundle, deploy the new `dist/` to the same alias (existing alias history then gives instant rollback for free), re-sync the rule sets. `prune: false` by default so a user's own added rules survive; prune is an explicit *"reset to the app's shipped rules"* toggle. Data tables are never dropped and the domain is untouched.

**Uninstall** treats the app's content as the user's, not the installer's. The default removes rule sets, alias, domain, and deployment while **keeping** `handoff_nodes` / `handoff_share_links` / `handoff_comments` and every stored object. A separate checkbox also deletes those, showing a real count first — *"this deletes 412 files"*.

**Eject** renders from the manifest's `eject` block: the fork link, the exact `BFFLESS_URL` / `BFFLESS_PROJECT` variables and `BFFLESS_API_KEY` secret (with a button to mint the API key inline, since CE can do that), the workflow to run, and a note that its first deploy lands on **this same alias**. That last property is what makes ejecting continuous rather than a restart: the 1-click install becomes the fork's deploy target.

## Testing

**Backend unit** — manifest validation (bad `schemaVersion`, missing declared files, `sha256` mismatch); each preflight gate in isolation; applier step ordering and undo bookkeeping; flag-off refusal; platform-mode cert delegation instead of issuance.

**Backend integration** — a **fixture bundle committed to CE**, applied against a real database: rule sets synced, data tables resolved by name on *both* the reuse and create paths, deployment/alias/domain rows written, `installed_apps` correct. Then update to a v2 fixture. Then uninstall both ways (content kept, content deleted).

**Contract, in `repos/apps`** — the bundle CI job validates its output against the manifest schema, and `pnpm apps:check` gains a "every app produces a valid bundle" assertion. This is the seam that stops CE and the apps repo from drifting.

**Frontend** — catalog states driven by mocked preflight verdicts; job-progress rendering; an MSW-backed install happy path.

**Live** — install Handoff on a real droplet across **all three serving models** (wildcard, proxied/self-signed, direct + Let's Encrypt), plus one platform-mode workspace. The certificate branch is exactly the class of thing that passed every unit test and was still dead on arrival twice during the bootstrap work; the only test that catches it is a real HTTPS request.

## Out of scope

- **Arbitrary bundle URLs / third-party registries** — the trust surface is deliberately curated, since a bundle carries server-side executable code.
- **Drift detection** on installed apps (the problem `rules-drift-check.yml` solves in CI). Tracked installs without drift was the explicit choice.
- **Path-mount serving** (`<primary>/handoff/`) and the runtime-configurable admin URL it would require, since Handoff derives its admin host from its own hostname and `VITE_ADMIN_URL` is build-time.
- **Auto-enabling MinIO from the backend** — no docker socket, by design.
- **Studio and Reader bundles.** The mechanism is general and their manifests are straightforward, but Handoff is the only bundle this ships.
