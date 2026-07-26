# Docs Deep Links in Onboarding and Day 2 — Design

**Date:** 2026-07-26
**Status:** Approved
**Source:** Operator request — the setup wizard and `/admin/settings/infrastructure` ask people to configure GCS/S3/Azure buckets and Cloudflare DNS + origin certificates, while `docs.bffless.dev` already has a page for each. Nothing in the portal points at them.
**Precedent:** `WelcomeStep.tsx` (#542, merged 2026-07-26) introduced the bordered docs-link row and the click-to-load YouTube facade. This change generalizes that row rather than re-implementing it.

## Problem

An operator picking **Google Cloud Storage** in the storage step is handed a Project ID / Bucket / Service Account JSON form with no explanation of where those values come from. The same is true for S3, Azure, and MinIO, on both the first-run wizard and the day-2 edit/migrate surfaces. The Cloudflare path is worse: the DNS phase and the origin-certificate paste form describe multi-step work inside a *third-party dashboard* in one paragraph of body copy, and there is a walkthrough video covering exactly those steps that the portal never mentions.

Every one of these has a published docs page. The links simply do not exist.

## Non-goals

- **No new docs content.** `docs-public` is untouched. All target pages and anchors already exist and were verified live with `curl` on 2026-07-26.
- **No portal-wide sweep.** Only storage and domain/SSL. API keys, proxy rules, pipelines, aliases, and users have docs pages too, but they are out of scope for this pass; the registry established here is what makes a later pass cheap.
- **No embedded player outside `WelcomeStep`.** The video appears as a text link, not an iframe (see "Video treatment").
- **No live-URL checking in CI.** Tests are offline and structural.

## Prior finding: anchors drift

The local `repos/docs-public` working copy has *Create DNS Records* as **Step 4**; the live site has it as **Step 5**, because the web-bootstrap work inserted a step. Both anchors requested for this change are correct against **live**, not against the local checkout:

- `#step-5-create-dns-records`
- `#step-6-generate-an-origin-certificate`

This is the direct motivation for centralizing URLs: when a heading moves again, the audit is one file.

## Design

### 1. `apps/frontend/src/lib/docsLinks.ts` — the registry

Every docs URL and video reference in the portal lives here as a named const. Nothing else in the codebase writes a `docs.bffless.dev` string literal.

```ts
const DOCS_BASE = 'https://docs.bffless.dev';

export const DOCS = {
  storage: {
    overview:  `${DOCS_BASE}/storage/overview/`,
    gcs:       `${DOCS_BASE}/storage/google-cloud-storage/`,
    s3:        `${DOCS_BASE}/storage/aws-s3/`,
    azure:     `${DOCS_BASE}/storage/azure-blob-storage/`,
    minio:     `${DOCS_BASE}/storage/minio/`,
    migration: `${DOCS_BASE}/storage/migration-guide/`,
  },
  cloudflare: {
    dns:  `${DOCS_BASE}/getting-started/cloudflare-setup/#step-5-create-dns-records`,
    cert: `${DOCS_BASE}/getting-started/cloudflare-setup/#step-6-generate-an-origin-certificate`,
  },
  letsencrypt: {
    dns: `${DOCS_BASE}/getting-started/letsencrypt-setup/#step-2-configure-dns-records`,
  },
  gettingStarted: {
    firstDeployment: `${DOCS_BASE}/getting-started/first-deployment/`,
  },
} as const;
```

Alongside it:

```ts
export const VIDEOS = {
  cloudflareSetup:  { id: 'zTGi5M0mcCo', dnsStart: 249, certStart: 249 },
  firstDeployment:  { id: 'cNqh02HyD0s', title: 'BFFless: your first deployment' },
} as const;

export function youtubeUrl(id: string, startSeconds?: number): string;  // https://youtu.be/ID?t=249
export function formatTimestamp(seconds: number): string;               // 249 -> "4:09"
```

**Provider mapping.** `storageDocsFor(provider: StorageProvider): { href: string; label: string } | null` is backed by an exhaustive `Record<StorageProvider, …>` literal, so adding a member to the `StorageProvider` union fails type-checking until someone decides what it links to. `local` and `managed` map to `null`: neither has a dedicated page, and local filesystem is a paragraph inside `storage/overview` rather than a setup guide worth interrupting the form for.

`WelcomeStep`'s existing `DOCS_URL` moves into the registry as `DOCS.gettingStarted.firstDeployment`, and its `VIDEO_ID` into `VIDEOS.firstDeployment`, so no docs string is left outside the registry.

### 2. `apps/frontend/src/components/common/DocsLink.tsx` — three presentations

Prominence is matched to stakes. A first-run operator is stuck and needs the link to be unmissable; someone editing settings already succeeded once and is on a dense page.

- **`<DocsLink href label />`** — the bordered row: `BookOpen` icon in `#d96459`, label, trailing `ExternalLink`, `hover:border-[#d96459]/50 hover:bg-muted/50`. The markup is lifted verbatim from `WelcomeStep`, and **`WelcomeStep` is refactored to consume it**, so exactly one copy of that markup exists.
- **`<DocsInlineLink href>text</DocsInlineLink>`** — underlined anchor with a small trailing `ExternalLink`, sized to flow inside a `CardDescription`.
- **`<WatchLink videoId start />`** — compact `Play`-icon text link rendering `Watch this step (4:09)`, with the label built from `formatTimestamp(start)` so the timestamp cannot drift out of sync with the URL.

All three render `target="_blank" rel="noopener noreferrer"`.

### 3. Video treatment

`WatchLink` opens `https://youtu.be/zTGi5M0mcCo?t=249` in a new tab. No iframe: the operator on the DNS phase is already alt-tabbing to the Cloudflare dashboard, and a 16:9 player inside a form step competes with the fields it is meant to explain. `WelcomeStep`'s facade embed stays as-is — a welcome screen is the one place where watching *is* the task.

**Timestamp decision.** Only one timestamp (`t=249`, the start of the Cloudflare section) was supplied. `dnsStart` and `certStart` are both set to it, and are separate registry fields specifically so the certificate one can be refined to its own moment in the video without touching any component.

### 4. Wire-ups

**Wizard — bordered row, plus watch link where the video covers the step:**

| File | Change |
| --- | --- |
| `components/setup/StorageStep.tsx` | `<DocsLink>` rendered under the provider `Select`, driven by `storageDocsFor(storageProvider)`; renders nothing for `local` / `managed` |
| `components/setup/domain-ssl/DomainDnsPhase.tsx` | Below the per-mode description block: `cloudflare` → `DOCS.cloudflare.dns` + `<WatchLink start={dnsStart} />`; `none` with `bootstrapSslMode === 'letsencrypt'` → `DOCS.letsencrypt.dns`; `proxy` → nothing, since the work happens in the operator's own CDN dashboard and our docs cannot describe it |
| `components/setup/domain-ssl/PasteCertificateForm.tsx` | The `COPY` record gains optional `docs?: { href; label }` and `video?: { id; start }` fields. Only the `cloudflare` entry populates them (`DOCS.cloudflare.cert`, `certStart`); `proxy` and `none` opt out by omission, which keeps the "no link for third-party CAs" decision visible in the same table as the copy it belongs to |

**Day 2 — inline links:**

| File | Change |
| --- | --- |
| `components/settings/StorageSettings.tsx` | `<DocsInlineLink>` in the main storage card, resolved from the current provider — "View the Google Cloud Storage setup guide" |
| `components/storage/EditStorageCredentials.tsx` | `<DocsInlineLink>` appended to the `CardDescription`, for the provider being edited |
| `components/storage/MigrationWizard.tsx` | `<DocsInlineLink>` beside the **target** provider selection — the one moment an operator deliberately picks a backend they have not used before |
| `components/settings/primary-ssl/ServingModelEditor.tsx` | When `servingMode === 'cloudflare'`, inline DNS and origin-certificate links near the paste fields |

All four surfaces route through `storageDocsFor` / `DOCS`, so a provider with no page degrades to no link rather than a broken one.

## Tests

New `apps/frontend/src/lib/docsLinks.test.ts` (Vitest, colocated per the `normalizeDomain.test.ts` convention):

1. **Shape.** Walk every leaf of `DOCS` recursively and assert each: starts with `https://docs.bffless.dev/`; the path segment ends with `/` before any `#`; any fragment matches `/^#[a-z0-9-]+$/`. This catches the realistic authoring mistakes — a missing trailing slash (Docusaurus redirects, losing the fragment), a `TitleCased` anchor, an accidental relative path.
2. **Provider coverage.** `storageDocsFor` returns a URL present in `DOCS.storage` for each of `s3`, `gcs`, `azure`, `minio`, and `null` for `local` and `managed`.
3. **Timestamp helpers.** `formatTimestamp(249) === '4:09'`, `formatTimestamp(59) === '0:59'`, `formatTimestamp(3600) === '60:00'`; `youtubeUrl('abc', 249) === 'https://youtu.be/abc?t=249'` and omitting the start omits the query string.

`WelcomeStep.test.tsx` is updated for the refactor to `<DocsLink>` — it must still assert the docs link renders with the first-deployment URL, now sourced from the registry.

No component test is added for each wire-up site; the links are static markup, and the registry test plus existing render tests cover the failure modes that matter.

## Files touched

**New:** `lib/docsLinks.ts`, `lib/docsLinks.test.ts`, `components/common/DocsLink.tsx`

**Modified:** `components/setup/onboarding/WelcomeStep.tsx` (refactor), `components/setup/onboarding/WelcomeStep.test.tsx`, `components/setup/StorageStep.tsx`, `components/setup/domain-ssl/DomainDnsPhase.tsx`, `components/setup/domain-ssl/PasteCertificateForm.tsx`, `components/settings/StorageSettings.tsx`, `components/storage/EditStorageCredentials.tsx`, `components/storage/MigrationWizard.tsx`, `components/settings/primary-ssl/ServingModelEditor.tsx`

Frontend only. No backend, schema, or migration changes.

## Verification

Beyond `pnpm test`, the wizard surfaces are checked in the headless browser per `localdev-tools/` — the storage step with GCS selected, and the Cloudflare DNS + certificate phases — confirming the rows render in the intended position and that the run reports `consoleErrors:0`.
