# Pipeline Schedules UI — Design

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Related:** issue #408 (`pipeline_schedules` cron primitive), #406/#407 (sibling primitives)

## Problem

The `pipeline_schedules` feature (issue #408) shipped **backend-only**: a project-scoped
REST API, an every-minute scheduler, a DB table, and MCP tools. There is **no frontend UI**
to view or edit schedules, so today a user must use curl/Swagger, the MCP tools, or direct
DB access. This design adds the missing UI.

## Existing backend (unchanged, for reference)

Feature lives in `apps/backend/src/pipeline-schedules/`.

REST surface — `PipelineSchedulesController`, base `/api/pipeline-schedules`, guarded by
`ApiKeyGuard` (session auth **and** API keys; a project-scoped key is authorized only for its
own project):

- `GET    /projects/:projectId/schedules` — list
- `POST   /projects/:projectId/schedules` — create
- `GET    /schedules/:id` — get one
- `PUT    /schedules/:id` — update (rename, re-cron, retimezone, enable/disable)
- `DELETE /schedules/:id` — delete

DB table `pipeline_schedules` (`apps/backend/src/db/schema/pipeline-schedules.schema.ts`):
`id, projectId, name, targetProxyRuleId, cronExpression, timezone, enabled, lastRunAt,
nextRunAt, executionStartedAt, lastError, createdAt, updatedAt`.

DTO fields (`pipeline-schedules.dto.ts`):
- **Create:** `name` (≤100), `targetProxyRuleId` (uuid), `cronExpression` (5- or 6-field, ≤120),
  `timezone?` (IANA, default `UTC`), `enabled?` (default true).
- **Update:** all of the above optional **except `targetProxyRuleId` is not updatable** — a
  schedule's target is fixed at creation.
- **Response:** the full row, including `lastRunAt`, `nextRunAt`, `lastError`.

A proxy rule is a valid target when `proxyType === 'pipeline'` and it carries a
`pipelineConfig` object.

## Scope

**In scope:** frontend management UI (list, create, edit, enable/disable, delete, status
display) + one small backend convenience endpoint to populate the target-rule picker.

**Out of scope:**
- Manual "run now" trigger — no backend endpoint exists; noted as a follow-up.
- Any change to the scheduler, claim/execution logic, or existing CRUD endpoints.
- Cross-project schedule views.

## Backend change (one endpoint)

Add a convenience endpoint so the create form has a single clean dropdown of targetable rules
(there is no existing flat "all pipeline rules for a project" endpoint — rules are nested under
rule sets).

```
GET /api/pipeline-schedules/projects/:projectId/pipeline-rules
→ [{ id, name, ruleSetId, ruleSetName, pathPattern, method }]
```

- Returns every proxy rule with `proxyType === 'pipeline'` across the project's rule sets.
- `name` derives from `pipelineConfig.name`, falling back to `pathPattern`.
- Same `ApiKeyGuard` + project-scope authorization as the sibling routes (reuse the service's
  existing project-scope check helper).
- New `PipelineSchedulesService.listPipelineRules(projectId, userId, role, apiKeyProjectId)`
  method + a unit test. Response DTO added to `pipeline-schedules.dto.ts`.

## Dependency

Add **`cronstrue`** (tiny, zero runtime deps) to `apps/frontend` — used only for the
human-readable cron description and client-side validity check (it throws on an invalid
expression). `date-fns@4` (already present) formats timestamps. **No `cron-parser`**: the
"next run" value shown to the user comes from the backend's authoritative `nextRunAt`, so the
UI never diverges from the scheduler's own cron evaluation.

## Frontend components

All paths under `apps/frontend`. Project pages are URL-scoped by `owner/repo`; the numeric
`projectId` is obtained via `useGetProjectQuery({ owner, name: repo })`.

### `src/services/pipelineSchedulesApi.ts`
Modeled on `src/services/proxyRulesApi.ts` (`api.injectEndpoints`). Endpoints:
- `getSchedules(projectId)` → `PipelineSchedule[]` (unwrap `{ data }`), provides
  `[{ type: 'PipelineSchedule', id: 'project-<id>' }, 'PipelineSchedule']`.
- `getPipelineRules(projectId)` → target-picker rows.
- `createSchedule({ projectId, data })`, `updateSchedule({ id, projectId, data })`,
  `deleteSchedule({ id, projectId })` — each invalidates
  `{ type: 'PipelineSchedule', id: 'project-<id>' }`.

Add `'PipelineSchedule'` to the `tagTypes` array in `src/services/api.ts`.

### `src/pages/PipelineSchedulesPage.tsx`
Resolves `projectId`, then loads `getSchedules` + `getPipelineRules` (parallel). Renders a
`Table` with columns:

| Name | Target rule | Cron | Timezone | Last run | Next run | Status | Actions |

- **Cron** cell: raw expression + cronstrue description in a tooltip.
- **Last run / Next run:** `date-fns` relative/absolute; em-dash when null.
- **Status:** enabled `Switch` (inline toggle); if `lastError` is set, a destructive `Badge`
  with the message in a tooltip.
- **Actions:** edit (opens dialog), delete (opens confirm). Gated by
  `useProjectRole(owner, repo).canEdit` — read-only users see values but no controls.
- Empty state (no schedules) with a "New schedule" CTA; `Skeleton` rows while loading.

### `src/components/pipeline-schedules/ScheduleFormDialog.tsx`
One dialog for **create and edit** (modeled on `CreateRuleSetDialog.tsx`). Props
`{ projectId, owner, repo, schedule?, open, onOpenChange }` (`schedule` present = edit mode).
Fields:
- **Name** — `Input`, required, ≤100.
- **Target rule** — `Select` populated from `getPipelineRules`, showing
  `name (ruleSetName)`. **Disabled in edit mode** (target is immutable). If no pipeline rules
  exist, show guidance linking to Proxy Rules.
- **Cron** — `Input` + preset chips (Every 15m `*/15 * * * *`, Hourly `0 * * * *`,
  Daily 2am `0 2 * * *`, Weekly `0 2 * * 0`, Custom). Live below: cronstrue description +
  valid/invalid indicator. Invalid cron blocks submit.
- **Timezone** — searchable `Select` over `Intl.supportedValuesOf('timeZone')`, default `UTC`.
- **Enabled** — `Switch`, default on.

Submit → `create`/`update` mutation `.unwrap()` → success `toast` → reset + close. Errors read
`err?.data?.message` into a toast. Closing resets form state.

### `src/components/pipeline-schedules/DeleteScheduleDialog.tsx`
`AlertDialog` confirm → `deleteSchedule` → toast.

### Wiring
- `src/App.tsx` — add `schedules` route under `/repo/:owner/:repo`.
- `src/utils/routes.ts` — `routes.schedules(owner, repo)` helper.
- `src/pages/RepositoryLayout.tsx` — add a `Schedules` `TabsTrigger` next to Proxy Rules and
  extend the `currentTab` pathname-matching chain.

## Data flow

1. Page mounts → resolve `projectId` → fire `getSchedules` + `getPipelineRules` in parallel.
2. Create/edit → dialog mutation `.unwrap()` → toast → `PipelineSchedule` tag invalidated →
   list refetches and shows the backend-computed `nextRunAt`.
3. Toggle/delete → same mutation + invalidation path.

## Error handling

- Mutation failures surface `err?.data?.message` via `toast({ variant: 'destructive' })`.
- Invalid cron is caught client-side (cronstrue throws) and blocks submit with an inline message.
- Empty pipeline-rules list → create dialog shows guidance instead of an empty dropdown.
- Query errors on the page → an error state with a retry, matching sibling pages.

## Testing

**Backend**
- Unit test for `listPipelineRules`: returns only `proxyType === 'pipeline'` rules for the
  project; respects project-scoped API key authorization (rejects/omits other projects).

**Frontend (Vitest)**
- `ScheduleFormDialog`: preset chip fills the cron field; invalid cron disables submit; edit
  mode disables the target-rule select and pre-fills fields.
- `PipelineSchedulesPage`: renders schedule rows from a mocked query; the enable/disable
  `Switch` dispatches `updateSchedule`.
- Cron helper (description + validity wrapper around cronstrue): unit-tested in isolation.

## Decisions (chosen defaults, all reversible)

- **Placement:** project-level "Schedules" tab (matches how Proxy Rules is a tab).
- **Target rule is immutable after creation** (backend Update DTO omits it) — target select is
  disabled in edit mode.
- **Timezone default `UTC`** (matches backend default).
- **Next run is backend-authoritative** (shown from `nextRunAt`, not client-computed).
- **No "run now"** in this pass (no backend endpoint).
