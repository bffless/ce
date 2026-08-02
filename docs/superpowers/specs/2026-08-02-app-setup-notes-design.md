# App setup notes — readable copy, and a home on the card

**Date:** 2026-08-02
**Status:** design approved, plan pending
**Repos:** `bffless/ce` (backend + frontend), `bffless/apps` (manifests + READMEs)

## Problem

An app manifest's `install.manualSteps` renders as a checklist on the install
dialog's Done screen. Two things are wrong with it.

**The copy is unreadable.** Rivulet's two steps are 447 and 571 characters of
unbroken prose in a `sm:max-w-lg` dialog; Handoff's are 201 and 542. Each one
buries its action inside a conditional ("if this project applies a
cross-origin-isolation policy elsewhere…"), so a reader has to parse the whole
paragraph before learning it doesn't apply to them.

**The list is one-shot.** It renders only on the Done screen
(`InstallDialog.tsx:541-566`). Closing unmounts the dialog, and an installed
app's card has no Install button, so the only way back is to trigger an
Update. The advice you were given at install time is unreachable exactly when
you go looking for it.

A third fact shapes both fixes: **the checkboxes do nothing.** Ticking one
appends a string to `installed_apps.manual_steps_acked`, and the only consumer
of that column is the checkbox's own `checked` state. Nothing gates on it, no
install fails without it, and the acked state is invisible everywhere else.
The copy is dense partly because it is straining to carry meaning the control
doesn't.

## Approach

Stop calling them steps you complete and start treating them as **notes you
read**: short, plain, linked to the place in the dashboard where the work
actually happens, and permanently visible on the installed app's card.

Three consequences:

1. Rewrite the copy against a stated rule, and delete the notes that don't
   apply to almost anyone.
2. Delete the ack mechanism entirely — with no ticks, there is no state to
   persist, no endpoint, and no column.
3. Put the notes on the card, not behind a modal.

## 1. Copy

### Rule (to be documented alongside the manifest schema)

A note's **title is the action**. Its **body is at most three short lines**:
what is true, what to do, when to skip. A note that needs a conditional to
decide whether it applies to the reader is not a note — it is a troubleshooting
entry, and it belongs in the app's README. Every note that has a destination in
the admin UI carries a `deepLink`.

### Rewrites

| Step | Before | After |
| --- | --- | --- |
| `reader/grant-access` | 447 ch | **Give other people access** — "Rivulet is private — only signed-in users with access to this project can read feeds. Add each person as a guest. Just you? Nothing to do here." → `/repo/{projectPath}/settings?tab=members` |
| `reader/embed-headers` | 571 ch | **Cut.** Moves to the Rivulet README as "Posts won't render inline". |
| `handoff/bucket-cors` | 201 ch | **Let the browser upload to your bucket** — "Uploads go straight from the browser to your storage bucket, so the bucket needs a CORS rule allowing `PUT` and `Content-Type` from `{appHost}`. CE can't set this for you — do it in your cloud console." → docs link |
| `handoff/iframe-headers` | 542 ch | **Cut.** Moves to the Handoff README (same COOP/COEP note). |

CE synthesizes one note of its own, and it breaks the same rule, so it is
rewritten here too — `AppCertStepService` (`app-cert-step.service.ts:153`, id
`provision-wildcard-cert`, currently five lines):

> **Turn on HTTPS for this app** — "Your app is live, over HTTP. Provision a
> wildcard certificate and it switches to HTTPS on its own." → `/domains`
> (deep link unchanged)

### Placeholders

A manifest cannot hardcode `/repo/acme/site/settings?tab=members` — it does not
know the project it will be installed into. The backend interpolates a **closed
set** of placeholders into `title`, `body` and `deepLink` when it builds the
note list:

| Token | Expands to |
| --- | --- |
| `{projectPath}` | `owner/name` of the installed project |
| `{appHost}` | the app's host, e.g. `reader.example.com` |

`app-manifest.util.ts` rejects any other `{token}` at validation time, so a typo
fails the manifest rather than shipping a literal brace to a user.

The `manualSteps` manifest key keeps its name. Renaming it would break
`schemaVersion: 1` for manifests already published to the registry; the change
here is how CE presents them, not what an app declares.

## 2. Removing the ack mechanism

Deleted:

- `POST /api/admin/apps/installed/:id/ack-manual-step`
  (`app-catalog.controller.ts:90`)
- `AckManualStepDto` (`app-catalog.dtos.ts:82`)
- `AppCatalogService.ackManualStep` (`app-catalog.service.ts:274`)
- `manualStepsAcked` from `CatalogEntry['installed']`
  (`app-catalog.service.ts:83`)
- `useAckManualStepMutation` and its RTK Query endpoint (`appCatalogApi.ts`)
- the `manual_steps_acked` column
  (`db/schema/installed-apps.schema.ts:46`)

The column drop needs a generated Drizzle migration. `pnpm db:generate` is
interactive and must be run by the operator, not the agent:

```bash
cd repos/ce/apps/backend && pnpm db:generate
```

Kept: the `manualSteps` manifest key, and `appliesWhen` filtering via
`manualStepApplies` (`app-manifest.util.ts:381`).

## 3. Surfacing the notes

### `SetupNotes.tsx` (new)

One component, rendering a heading ("Setup notes"), the line "CE can't do
these for you", and one entry per note: title, body, deep link. A
`defaultExpanded` prop controls whether bodies start open.

### On the installed card (`AppCard.tsx`)

The permanent home. An installed card grows a Setup notes block between its
badges and its footer, listing each note's **title only**, as a disclosure
button; clicking one expands its body and deep link in place.

```
┌─ Rivulet ────────────────────────┐
│  [banner image]                  │
│  Rivulet                         │
│  A quiet, multi-user RSS reader  │
│  [reading] [Installed · v1.0.0]  │
│                                  │
│  Setup notes — CE can't do       │
│  these for you                   │
│   › Give other people access     │
│   › Turn on HTTPS for this app   │
│                                  │
│  Details    Open ↗         ⋮     │
└──────────────────────────────────┘
```

Titles-only-by-default is deliberate: the catalog is a 3-up grid, and the
banner is already unconditional so that one card with a thumbnail isn't twice
the height of its neighbour (`AppCard.tsx:104-112`). Two three-line bodies
inline would reintroduce exactly that unevenness, permanently. Collapsed, every
installed card differs by at most a line or two.

The block renders only when the app has notes. No badge, no count, no ⋮ menu
item — the notes are on the card, so a modal to reach them would be a second
door to the same room.

### On the install dialog (`InstallDialog.tsx`)

The Done screen's inline block (`:541-566`) is replaced by `<SetupNotes
defaultExpanded />` — same content, bodies open, because the dialog has the
room and this is the moment the notes are most relevant.

### Cert note on read (`app-catalog.service.ts`)

`buildInstalledSummary` appends the cert note by calling
`certStepService.execute(await certStepService.plan(host))` and taking
`result.manualStep` when present. The host is already resolved there for
`resolveAppUrl`, so this adds no new lookup path.

This fixes an existing gap: the cert note is synthesized during the install run
and attached to the **in-memory** job (`app-installer.service.ts:306`), while
the Done screen prefers `entry.installed?.manualSteps ?? job?.manualSteps`
(`InstallDialog.tsx:292`). Once the catalog query refetches, the manifest-only
list wins and the HTTPS advice vanishes. Re-deriving on read also makes it
self-healing: the note disappears on its own once a wildcard covers the host.

## Data flow

```
manifest.install.manualSteps
        │
        ├─ manualStepApplies(step, {bucketStorage, platformMode})   filter
        │
        ├─ interpolate({projectPath, appHost})                      expand
        │
        └─ + certStepService step, when the host has no cert
                │
                ├─→ CatalogEntry.installed.manualSteps → AppCard → SetupNotes
                └─→ InstallJob.manualSteps → InstallDialog → SetupNotes
```

Both paths converge on the same component. No state is written at any point.

## Error handling

- **Cert lookup fails while listing the catalog.** `AppCertStepService` never
  throws by contract (every `execute` branch degrades). If `plan` throws
  anyway, `buildInstalledSummary` catches and omits the note — a catalog that
  fails to list is worse than one missing an advisory line.
- **A note references a placeholder CE can't resolve** (no domain yet, so no
  `{appHost}`). Substitute the alias URL if there is one, otherwise leave the
  sentence out rather than emitting an empty gap. Validation guarantees the
  token itself is known; only its value can be absent.
- **Stale acked ids.** None — the column is gone.

## Testing

Backend:

- `interpolateStep` expands both tokens across title/body/deepLink; leaves
  text with no tokens untouched.
- `validateAppManifest` rejects an unknown `{token}`, naming it.
- `buildInstalledSummary` appends the cert note when the plan is
  `direct-no-wildcard`, and omits it when a wildcard exists.
- The ack route is gone: a request to it 404s.

Frontend:

- `SetupNotes` renders titles collapsed, expands one body on click, and
  renders the deep link as a link.
- `AppCard` shows the block only when installed and only when notes exist.
- `InstallDialog`'s Done screen renders notes expanded.
- No component references `manualStepsAcked`.

Manifests (`bffless/apps`): both rewritten manifests pass `validateAppManifest`
(the repo's manifest test), and every remaining note's body is ≤ 220
characters — the measurable stand-in for "three short lines" at the dialog's
width.

## Out of scope

- Verifying notes rather than describing them (CE checking member counts, or
  probing bucket CORS). Discussed and deferred: it is a per-note check to write
  and test, and it changes the notes from advice into status. Worth revisiting
  once the notes themselves are readable.
- Any change to `appliesWhen`'s enum, including a `crossOriginIsolated` value
  that would let the cut COOP/COEP notes return as conditional ones.
