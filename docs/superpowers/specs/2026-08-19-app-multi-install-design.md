# App catalog: one app, many installs

**Date:** 2026-08-19 · **Status:** implemented alongside this note · **Builds on:** [2026-07-30 app-catalog 1-click install](./2026-07-30-app-catalog-1-click-install-design.md)

## Problem

The catalog treated app↔install as one-to-one. Once an app was installed anywhere the card
hid **Install**, and Update / Open / Uninstall / Eject all acted on "the" install. The real use
case is installing the same app (e.g. Studio) into project `foo` *and* project `bar`, each on
its own version, with update becoming one-to-many.

## What was already true

- `installed_apps` is unique on **`(app_id, project_id)`**, not `app_id`. `version`,
  `installed_at`, `updated_at` are per row. **No schema change was needed.**
- `POST /api/admin/apps/installed/:id/update`, uninstall, eject and undo are keyed by
  `installed_apps.id`. Three-way "preserve your edits" sync is per rule set ⇒ per project, so
  it works unchanged per install.
- Preflight's name-collision gate scopes rule-set/alias checks to the target project; the only
  cross-install collision is the **host** (`domain_mappings.domain` is global, plus the
  cross-namespace alias trap), already addressable via the `subdomain` override.

The one-to-one lived in exactly two places: the read model (`CatalogEntry.installed` singular,
`pickPrimaryRow` collapsing N rows) and the UI bound to it.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | `CatalogEntry.installs: InstalledSummary[]` (rename, always present) replaces `installed?` | A rename makes TypeScript flag every consumer; `updateAvailable`, `installedAt`, `updatedAt` are per element — the per-install version trail. |
| 2 | Update fan-out is **client-serialised** (`useSequentialUpdates`), no bulk endpoint | The install-job registry is single-flight; a queue server-side would be a second job system for one button. A failed job does not stop the batch; a *rejected start* does. |
| 3 | Card = summary, **details dialog = per-install list** | A grid tile can act on one install; with several it shows "Installed in N projects · k updates" + *Update all* + *Manage installs*, and the dialog's `InstallsList` carries Open/Update/Uninstall/Eject per row. A single install keeps today's card exactly, plus "Install in another project" in the overflow. |
| 4 | Preflight returns **`suggestedSubdomain`** when the manifest default host is already mapped | `<default>-<project>` (slugified, `-2`, `-3`… on collision, reserved names skipped). The wizard prefills it only while the field is untouched, and names which install owns the default. |
| 5 | Done screen matches the install by the job's `installedAppId` | So a second install's notes/URL are its own, never the first install's. |

## Out of scope

- Installing the same app twice **into the same project** — `(app_id, project_id)` stays unique.
- A server-side bulk-update job; a CLI/MCP surface for installs.
- `bffless/docs` app-catalog page update (follow-up PR).
