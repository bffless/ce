# AI Handler Attachments + Claude Scene Refiner Design

**Date:** 2026-07-02
**Status:** Approved for planning

## Problem

The Studio app's per-scene refiner (`POST /api/refine-scene`, proxy rule set
`591dab6e-51cf-4d15-8b04-36b50f5d8c6d` on the `j5s` instance) calls
`google/gemini-3.1-pro` via the `replicate` handler. Replicate is unreliable
for this workload: frequent failed predictions (4–5 s failures, 2 m 5 s
timeouts) with an apparent ~2 minute hard cap somewhere in the
Replicate/Gemini path. Each refine call sends a system prompt, a long user
prompt (word timings), up to 10 contact-sheet images, and the scene audio.

We want a parallel endpoint, `POST /api/refine-scene-claude`, that calls
Claude directly through CE's `ai_handler` instead of Replicate. The existing
`ai_handler` completion mode only supports a text user message — it has no
way to attach images. That is the CE gap this design closes.

## Decisions made

| Decision              | Choice                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attachment mechanism  | Generic `attachments` array on `ai_handler` config (Option A)                                                                                                                                 |
| Model                 | `claude-sonnet-4-6` via `provider: "anthropic"`                                                                                                                                               |
| Audio                 | Dropped for the Claude variant — the Anthropic API has **no audio input**. Word timings + contact sheets carry the boundary signal.                                                           |
| Frontend (Studio app) | Untouched. Pipeline-only; tested manually. The original `/api/refine-scene` rule is not modified.                                                                                             |
| Pipeline editor UI    | **Must** gain an Attachments input — `AIHandlerConfig.tsx` rebuilds the config object from known fields on save, so an unknown `attachments` key would be silently wiped on the next UI edit. |

## Part 1 — CE: `ai_handler` attachments (completion mode)

### Config shape

`AIHandlerConfig` (in `apps/backend/src/pipelines/execution/step-handler.interface.ts`)
gains:

```ts
/**
 * [Completion mode only]
 * Attachments to include with the user message. Each source is an
 * expression that resolves to a URL string or an array of URL strings.
 * Arrays fan out into one content part per element. Empty/null resolved
 * values are skipped silently (supports conditional attachments).
 */
attachments?: Array<{
  type: 'image' | 'file';
  source: string;      // expression, e.g. "steps.collect.images"
  mediaType?: string;  // required for type 'file' (e.g. "audio/mpeg")
}>;
```

`type: 'image'` is what the refine pipeline needs now. `type: 'file'` is
included in the schema so a future Gemini-direct variant can attach audio,
but wiring/testing beyond schema validation is out of scope.

### Runtime behavior (`apps/backend/src/pipelines/handlers/ai.handler.ts`)

In completion mode only, after resolving the text user message:

1. For each `attachments` entry, evaluate `source` with
   `ExpressionEvaluator.evaluateExpression`.
2. Normalize the result: `string` → `[string]`; array → as-is; `null` /
   `undefined` / `''` / non-string elements → skipped. No error for empty
   results (mirrors the `sign0–9` conditional-step pattern).
3. If at least one attachment part resulted, the user message becomes
   multi-part content:

   ```ts
   {
     role: 'user',
     content: [
       { type: 'text', text: userMessage },
       // per resolved URL:
       { type: 'image', image: new URL(url) },            // type 'image'
       { type: 'file', data: new URL(url), mediaType },    // type 'file'
     ],
   }
   ```

   With zero resolved attachments, behavior is byte-for-byte today's
   (plain string content).

4. URLs are passed through — the provider (Anthropic) fetches them. CE does
   not download or base64 the bytes. Signed URLs (1 h expiry) are fetched
   within seconds of minting, so expiry is not a concern.
5. Chat mode ignores `attachments` entirely (documented in the config
   JSDoc).
6. `resolvedMessages` in the step output keeps working — multi-part content
   is echoed as-is (URLs, not bytes, so no payload bloat).

### Validation (`validateConfig`)

- `attachments`, when present, must be an array.
- Each entry: `type` must be `'image'` or `'file'`; `source` must be a
  non-empty string; `mediaType` is required when `type === 'file'`.
- Violations throw `ConfigurationError` (same pattern as existing checks).

### Touch points beyond the handler

Per the "register in all places" rule for pipeline config changes:

1. **MCP tool descriptions** — the `ai_handler` config documentation string
   in CE's MCP module (`apps/backend/src/mcp/`) must document `attachments`
   so MCP-driven pipeline edits know the field exists.
2. **Pipeline editor UI** —
   `apps/frontend/src/components/pipelines/handlers/AIHandlerConfig.tsx`:
   - New **Attachments** section, shown in completion mode only, below the
     Message field.
   - Repeatable rows: Type dropdown (`image` | `file`) + Source expression
     input (same expression-input component used by the Message field, with
     previous-step autocomplete) + MediaType text input (shown only for
     `file`).
   - Rows with a blank source are dropped on save.
   - `attachments` is included in the `onChange` config rebuild
     (`undefined` when the list is empty) so it round-trips through UI
     edits.

### Tests (backend, Jest)

- Array source fans out to N image parts after the text part.
- Single string source becomes one image part.
- Empty / null / missing source values are skipped; zero attachments yields
  plain string content (regression guard).
- `validateConfig` rejects bad type, empty source, and `file` without
  `mediaType`.

## Part 2 — New pipeline `POST /api/refine-scene-claude`

Created on the `j5s` instance (rule set `591dab6e-51cf-4d15-8b04-36b50f5d8c6d`)
via MCP **after** the CE change is deployed. A copy of `/api/refine-scene`
(rule `fd3b5c8f-c84c-4a68-a77b-7e8c8faf3796`) with these deltas:

| Step                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------ |
| `prep` (function)                        | Remove the `audioUrl` requirement, `audioPath` output, and every audio paragraph from the system/user prompt text (the "AUDIO:" section, the "attached audio" line, and audio-dependent wording such as boundary alignment "listen" instructions). Word-timing and contact-sheet instructions are unchanged.                                                                                                                                                                                                 |
| `createJob` / `respond`                  | Unchanged (same schema `46f5eef6-cabe-48cf-95f8-05c9b94de2a7`, same `kind: 'refine'`, returns `{ jobId, status: 'pending' }` — the existing `GET /api/studio/job` polling works as-is).                                                                                                                                                                                                                                                                                                                      |
| `setRunning`, `sign0`–`sign9`, `collect` | Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `signAudio`                              | **Removed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `refiner`                                | `replicate` → `ai_handler`: `{ mode: 'completion', responseMode: 'message', provider: 'anthropic', model: 'claude-sonnet-4-6', systemPrompt: '{{steps.prep.system}}', messageField: 'steps.prep.prompt', attachments: [{ type: 'image', source: 'steps.collect.images' }], maxTokens: 32000, temperature: 0.5, timeout: 280000 }`. Note: template syntax for `systemPrompt` — the `$`-prefix expression path in the handler is dead code (the evaluator returns `$...` strings as literals), templates work. |
| `parse` (function)                       | Read the response text from `steps.refiner.content` (ai_handler output) instead of Replicate's `d.output`. The failed-call guard becomes `if (!d                                                                                                                                                                                                                                                                                                                                                             |     | typeof d.content !== 'string')` → same friendly error path. All JSON salvage/clamping logic unchanged. |
| `finishOk` / `finishErr`                 | Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Rule metadata: `POST`, `proxyType: 'pipeline'`, description noting it is the
Claude (no-audio) variant of the refine pipeline.

## Rollout order

1. CE PR with the `ai_handler` change (backend + frontend UI + MCP docs +
   tests). Conventional commit `feat:` so the release pipeline runs.
2. Merge → release → update the `j5s` workspace image.
3. Create the new proxy rule via MCP.
4. Manual test: POST a real scene payload (sheetUrls + wordTimings + spans)
   to `/api/refine-scene-claude`, poll the job row, verify
   `status: 'done'` with plausible `segments`/`cuts`.
5. Re-export the Studio proxy-rule-set JSON from the dashboard and commit it
   to `bffless-apps/apps/studio/bffless/` (per the standing rule: exports
   are refreshed from the dashboard, not hand-edited).

## Risks

- **Anthropic image downscaling.** Images with a long edge over ~1568 px
  are resized server-side; the burned-in frame timestamps on dense contact
  sheets may lose legibility. If refine quality suffers, sheet resolution /
  tiling needs revisiting — out of scope here, but the first thing to check.
- **Anthropic limits.** ≤100 images per request (we send ≤10) and ≤5 MB per
  image — contact sheets are expected to be well under this; a 413-style
  API error would surface through the existing `parse` error path into the
  job row.
- **URL fetchability.** Anthropic's servers must be able to fetch the
  signed `j5s.dev` URLs. They are public-with-token over HTTPS, same as
  what Replicate fetches today.

## Out of scope

- Studio frontend changes (switching or falling back to the new endpoint).
- Audio attachments end-to-end (schema supports `type: 'file'`, untested).
- A Gemini-direct (`provider: 'google'`) refine variant.
- Any change to the existing `/api/refine-scene` rule.
