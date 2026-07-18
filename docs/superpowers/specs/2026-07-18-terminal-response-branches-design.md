# Terminal Response Branches — Design

**Date:** 2026-07-18
**Repo:** bffless/ce (frontend only)
**Motivating case:** `landing-episodes` `/api/episodes` rule — two conditional
`response_handler` steps (`unavailable`: 503 when `!steps.fetch_playlist.ok`,
`respond`: 200 when `steps.fetch_playlist.ok`).

## Problem

The pipeline editor (`apps/frontend/src/components/pipelines/PipelineConfig.tsx`)
models "the Terminal Step" as a singleton:

1. It `.find()`s the **first** `response_handler`/`proxy_forward` and shows it as
   the Terminal Step; every other terminal-type step is filtered out and rendered
   **nowhere**.
2. Every `onChange` (even editing the pipeline name) recombines the steps array as
   `[...regularSteps, theOneTerminalStep]`, **permanently deleting** the other
   terminal steps on save.
3. The terminal editor exposes no `condition` field, and `updateTerminalConfig`
   replaces the step config wholesale — expanding the card fires
   `ResponseHandlerConfig`'s mount-time `onChange` and **strips an existing
   `condition`**.

The backend has no single-terminal concept: steps run sequentially, each step's
`config.condition` is evaluated (skipped when falsy, preserving the previous
step's output), and the response is the output of the last step that ran.
Multiple conditional response handlers are a valid, useful pattern. This is
purely a frontend editor limitation.

## Design (Option B — approved in conversation)

### Data model / split logic

No wire-format, API, or backend changes. In `PipelineConfig.tsx`:

- **Terminal branches** = the *trailing contiguous run* of
  `response_handler`/`proxy_forward` steps at the end of `config.steps`
  (`terminalSteps: PipelineStep[]`, order preserved).
- Any terminal-type step that appears **before** a non-terminal step is not part
  of the trailing run; it renders as a **regular pipeline step**
  (`HandlerConfigWrapper` already supports `response_handler`) instead of being
  hidden and dropped.
- **Recombine** everywhere as `[...regularSteps, ...terminalSteps]`. All update
  paths (`updateConfig`, `setTerminalType`, branch edits, add/remove/move
  branch) carry the full branch list. Round-tripping is lossless — untouched
  branches pass through byte-identical (no minted `id`s, `condition` intact).

### UI

- **Zero branches:** unchanged — "Terminal Step" heading, type dropdown
  (Default Response / Custom HTTP Response / Forward Request), default-response
  preview card.
- **One branch:** today's single card plus:
  - a **"Respond When (optional)"** `ExpressionInput` at the top of the expanded
    card body (reads/writes `config.condition`, autocomplete from prior steps);
  - an **"Add Branch"** button beside the type dropdown.
- **Two+ branches:** heading becomes "Terminal Branches"; the type dropdown is
  replaced by the "Add Branch" button. Each branch renders as a card:
  - collapsed header: number badge, step name (fallback "HTTP Response" /
    "Forward Request"), Terminal/Proxy badge, a condition summary badge
    (`when <expr>` or `always`), move up/down, delete (with confirm dialog),
    enable/disable switch is *not* added (branches use conditions, and
    `isEnabled` passes through untouched);
  - expanded body: condition input + `AvailableVariables` +
    `ResponseHandlerConfig`/`ProxyForwardConfig`.
  - helper text under the heading: "Branches run in order; the response comes
    from the last branch whose condition matches. A branch without a condition
    always matches."
- "Add Branch" appends a `response_handler` branch
  (`{status: 200, body: '', contentType: 'application/json'}`, unique name,
  minted `id` — same as `addStep`) and expands it.
- Per-branch expansion state: `Set<number>` (replaces the single
  `terminalExpanded` boolean), same index-shifting helpers as regular steps.
- AI-chat streaming implicit terminal behavior unchanged.

### Condition preservation

Branch config edits follow the regular-step idiom already used at lines
671-677: `condition ? { ...newConfig, condition } : newConfig`. The condition
input itself writes `{ ...step.config, condition: value || undefined }`.

### Post-steps / variables

`previousStepsForPost` includes **all** terminal branches (not just the first).
Each branch's condition/body autocomplete sees all regular steps.

## Out of scope

- Per-branch handler-type switch (delete + re-add covers it).
- Backend validation changes (none needed).
- Drag-and-drop reordering (move buttons match existing step UX).

## Testing

Vitest (`PipelineConfig.test.tsx` conventions — the fixture there is already the
landing-episodes pipeline):

1. Two conditional response handlers both render as branch cards; renaming the
   pipeline (an `updateConfig` path) emits **both** branches unchanged.
2. Expanding + editing one branch's body preserves its `condition` and does not
   touch the other branch.
3. Add Branch appends a response branch; delete (confirmed) removes only that
   branch; move up/down swaps order in the emitted steps.
4. Single-terminal pipeline: dropdown behavior unchanged (`none` clears it,
   switching to proxy replaces it); no `id` minted onto id-less branches on
   unrelated edits.
5. A `response_handler` occurring before a non-terminal step renders in the
   regular steps list and survives edits.
