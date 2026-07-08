# data_upsert_many: optional update-on-conflict (`updateFields`)

**Date:** 2026-07-08
**Issue:** [bffless/ce#438](https://github.com/bffless/ce/issues/438)
**Status:** Approved — ready for implementation plan

## Problem

`data_upsert_many` is strictly insert-only: on a re-run, any row whose dedup key
already exists is skipped. This is deliberate — it's what preserves per-record
state (an RSS reader's `read`/`starred`/`fetchedAt`) across a 15-minute refresh.

The downside: edits to an already-ingested item never propagate. Rivulet (the
`bffless/apps` RSS reader) ingests feed items keyed by a stable `guid`. When a
Handoff feed's `<title>`/`<description>` is edited after sharing
(`bffless/apps#202`), the feed emits the new values, but Rivulet never shows them
— the `guid` already exists, so the refresh skips the row. New items work; edits
to old ones are lost. Deleting + re-adding the feed doesn't help (item rows are
keyed by guid, not purged with the feed).

There is no `data_update_many` handler, and `data_update` is single-record-by-id,
so there's no bulk-refresh-existing primitive today.

## Solution

Add an optional `updateFields: string[]` to `DataUpsertManyHandlerConfig`.

- **Absent (default):** current behavior — insert new, skip existing. No breaking
  change, no extra DB cost.
- **Present:** for a row whose dedup key already exists, `UPDATE` **only** the
  whitelisted columns from the item's mapped values — but only when a whitelisted
  value has actually changed. Every other column (`read`, `starred`, `fetchedAt`,
  the dedup column) is left untouched. Newly-seen items still insert as today.

Unchanged existing rows are **not** written (no needless `updatedAt` churn /
re-sorting on every refresh). This was the key semantic decision: skip unchanged
rows rather than blind-update every match.

## Design

### Config — `DataUpsertManyHandlerConfig`

```ts
/**
 * Optional whitelist of columns to refresh when a row with the dedup key already
 * exists. Absent → insert-only (existing rows never overwritten). Present → those
 * columns (and only those) are updated from the item's mapped values when they
 * differ from the stored row; all other columns (including per-record state and
 * the dedup column) are preserved.
 */
updateFields?: string[];
```

### Validation — `validateConfig` (config-only, no schema access)

When `updateFields` is present:

- Must be a non-empty array of non-empty strings.
- Every entry must be a key of `map` → else `ConfigurationError`
  ("updateFields may only name columns present in map").
- Must not include `dedupField` → else `ConfigurationError`
  ("updateFields cannot include the dedup column").

Schema-column validity is covered transitively: `updateFields ⊆ map`, and map
columns are the same values written on insert.

### Execution flow — `execute`

The map / dedup-key / within-batch-dedupe phase is unchanged. After building
`candidates` (`{ key, data }[]`):

**`updateFields` absent** — unchanged:
```
existing = findExistingKeys(...)
toInsert = candidates not in existing
createMany(toInsert)
```

**`updateFields` present:**
```
existingRows = findExistingRecordsByKeys(schemaId, projectId, dedupField, keys)
  → Map<key, { id, data }>

for each candidate:
  if key not in existingRows:
    → insert (collect into toInsert)
  else:
    partial = pick(candidate.data, updateFields)
    stored  = existingRows.get(key).data
    if some updateField differs (stored[f] vs partial[f]):
      → collect { id, fields: partial } into toUpdate
    else:
      → unchanged (counts toward skipped)

createMany(toInsert)
updateManyFields(toUpdate)   // per-row JSONB merge: data = data || partial, updatedAt = now
```

Field comparison is by value (scalar whitelisted fields: title/content/summary/
publishedAt). Implementation compares serialized values so type mismatches
(stored `"5"` vs mapped `5`) count as changed.

### Output — `DataUpsertManyOutput`

Add two fields:

```ts
updated: number;      // existing rows whose whitelisted fields changed
updatedIds: string[]; // ids of those rows
```

Counter semantics:

| field       | meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `inserted`  | newly-seen rows inserted                                       |
| `updated`   | existing rows whose whitelisted fields changed                 |
| `skipped`   | within-batch duplicates **+** existing rows that were unchanged |
| `errored`   | per-item mapping/validation failures (unchanged)              |
| `total`     | source array length (unchanged)                                |

`emptyOutput()` gains `updated: 0`, `updatedIds: []`.

### Data service — `pipeline-data.service.ts`

Two new trusted-context methods (no permission check — callers have already
resolved schema + project, matching `createMany` / `findExistingKeys`):

- `findExistingRecordsByKeys(schemaId, projectId, field, values): Promise<Map<string, { id: string; data: Record<string, unknown> }>>`
  — chunked `inArray` on the JSONB dedup field, like `findExistingKeys`, but
  returns id + data so the handler can compare.

- `updateManyFields(updates: { id: string; fields: Record<string, unknown> }[]): Promise<string[]>`
  — per-row `UPDATE ... SET data = data || $fields::jsonb, updatedAt = now()`
  in a loop; `$fields` is a bound param (no SQL injection). Returns updated ids.
  Per-row loop is fine for expected feed-refresh batch sizes; a bulk
  `UPDATE ... FROM (VALUES ...)` is a noted future optimization.

### MCP tool description — `proxy-rules.tools.ts` (line ~89)

Document the optional `updateFields` config and the new `updated` / `updatedIds`
outputs on the `data_upsert_many` entry.

### Tests — `data-upsert-many.handler.spec.ts`

- Extend the `dataService` mock with `findExistingRecordsByKeys` + `updateManyFields`.
- New cases:
  - changed row updates (stored title differs → `updateManyFields` called with the
    new title; `updated: 1`, correct `updatedIds`).
  - unchanged row skips (stored == mapped → no update; `skipped: 1`, `updated: 0`).
  - insert + update mix in one batch.
  - validation: `updateFields` naming a column not in `map` → `ConfigurationError`.
  - validation: `updateFields` including `dedupField` → `ConfigurationError`.
- Existing insert-only tests must stay green (default path untouched).

## Out of scope (separate `bffless/apps` PR)

Rivulet's `/api/refresh` pipeline setting
`updateFields: ["title","content","summary","publishedAt"]` and its live-rules
sync. Tracked in the issue; not part of this CE change.

## Alternatives considered (rejected)

- **Delete + re-insert on refresh** — loses `read`/`starred` (the reason it's
  insert-only).
- **Change the item guid on edit** — breaks stable-guid semantics; spams readers
  with duplicate items on every edit.
- **Second per-item `data_update` pass** — no bulk update primitive;
  `data_update` is one-record-by-id.
- **Blind-update every matched row** — simpler, but bumps `updatedAt` on every
  item every refresh, re-sorting anything ordered by `updatedAt`. Rejected in
  favor of change-detection.
