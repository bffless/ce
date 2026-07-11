# Phase 0 exit pilot: reader round-trip (`bffless/apps`)

Task 15 of the proxy-rules-as-code CLI plan (design doc §6, Phase 0 exit criterion). This
pilot decompiles a **real production export** — the `reader` app's live proxy rule set
from `bffless/apps` — and proves the full `pull --decompile` → `build` round-trip, plus
`validate` and `test`, against real handler code, not synthetic fixtures.

Two repos are involved:

- `/home/rico/bffless/repos/apps` (`bffless/apps`) — the reader app's live export lives at
  `apps/reader/bffless/reader.proxy-rules.json`. This pilot decompiled it into
  `apps/reader/.bffless/proxy-rules/reader/**` via the CLI. **That working tree was left
  uncommitted** — nothing in `bffless/apps` was staged, committed, or pushed. It is there
  for the user to review directly.
- `/home/rico/bffless/repos/.ce-worktrees/proxy-rules-cli` (this repo, `feat/proxy-rules-cli`)
  — only this report was committed here.

## What was run

```bash
CLI=/home/rico/bffless/repos/.ce-worktrees/proxy-rules-cli/packages/cli/dist/index.js
cd /home/rico/bffless/repos/apps

# 1. Decompile the live export
node $CLI rules pull --from-file apps/reader/bffless/reader.proxy-rules.json \
  --decompile -o apps/reader/.bffless/proxy-rules/reader
# -> apps/reader/.bffless/proxy-rules/reader   (exit 0, no warnings printed)

# 2. Build it back
node $CLI rules build apps/reader/.bffless/proxy-rules/reader
# -> apps/reader/.bffless/proxy-rules/reader/dist/reader.proxy-rules.json
# -> 13 rules, 2 schemas, 0 secrets referenced   (exit 0)

# 3. Validate the decompiled set
node $CLI rules validate apps/reader/.bffless/proxy-rules/reader
# -> (no output; exit 0 -> 0 errors, 0 warnings)

# 4. Handler fixture test
node $CLI rules test apps/reader/.bffless/proxy-rules/reader
# -> see "Handler fixture test" below — executed, but the comparison assertion
#    itself has a pre-existing harness bug this pilot discovered (details below)
```

## Decompiled tree

```
$ find apps/reader/.bffless/proxy-rules/reader -type f | sort

apps/reader/.bffless/proxy-rules/reader/dist/.gitignore
apps/reader/.bffless/proxy-rules/reader/dist/reader.proxy-rules.json
apps/reader/.bffless/proxy-rules/reader/rules/api/auth/[...path]/any.rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/counts/get/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/counts/get/shape.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/discover/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/discover/post/shape.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/folder/post/pick.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/folder/post/prep.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/folder/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/get.rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/post/prep.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/remove/post/pick.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/feeds/remove/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/items/get/assemble.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/get/folderUrls.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/get/prep.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/get/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read-all/post/assemble.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read-all/post/folderUrls.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read-all/post/prep.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read-all/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read/post/pick.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read/post/prep.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/read/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/items/star/post/pick.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/star/post/pick.fn.test.yaml   <- Task 15 fixture (added)
apps/reader/.bffless/proxy-rules/reader/rules/api/items/star/post/prep.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/items/star/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/prune/post/cutoff.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/prune/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/refresh/post/enrich.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/refresh/post/rule.yaml
apps/reader/.bffless/proxy-rules/reader/rules/api/refresh/post/stamp.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/refresh/post/summary.fn.js
apps/reader/.bffless/proxy-rules/reader/rules/api/refresh/post/urls.fn.js
apps/reader/.bffless/proxy-rules/reader/ruleset.yaml
apps/reader/.bffless/proxy-rules/reader/schemas/reader_feeds.schema.yaml
apps/reader/.bffless/proxy-rules/reader/schemas/reader_items.schema.yaml
```

13 rules (12 `pipeline` + 1 `external_proxy` auth reverse-proxy), 2 schemas, 21
`function_handler` `.fn.js` files, decompiled with zero warnings on `pull --decompile`.

## Equivalence result: PASS

Compared the original export against the rebuilt `dist/reader.proxy-rules.json` with a
Node script importing `exportsEquivalent` from the built CLI dist
(`packages/cli/dist/format/canonical.js`):

```
{
  "equal": true,
  "diffs": []
}
```

**Zero diffs.** Also independently walked both exports' `pipelineConfig.steps[].config.code`
for every `handlerType: "function_handler"` step and compared string-for-string:

```
original function_handler steps: 21
rebuilt function_handler steps: 21
byte-identical matches: 21, mismatches: 0, total keys: 21
```

All 21 function-handler code strings round-tripped **byte-identical**. This confirms the
Phase 0 exit criterion cleanly: decompile → build reproduces a semantically identical
export from a real production rule set, including every piece of handler source code.

Note: the raw JSON *bytes* differ (original 48,815 bytes vs. rebuilt 54,337 bytes) — this
is expected and by design. `exportsEquivalent` canonicalizes both sides first (sorts rules
and schemas, applies rule defaults so different exporter eras' elision of default-valued
keys like `internalRewrite`/`debugEnabled` doesn't register as a diff, strips
`exportedAt`). The size delta is exactly that: explicit-default-keys the original exporter
elided, now written out. No semantic content differs.

## Validate result: PASS, 0 errors, 0 warnings

```
$ node $CLI rules validate apps/reader/.bffless/proxy-rules/reader
(no output; exit 0)
```

The brief flagged `skills-root-absent` as an example expected warning (reader has no
`.bffless/skills` sibling). That warning is conditional on the rule set actually
referencing skills (`ai_handler` steps with `config.skills.mode: selected`) — `validateRuleSet`
only checks `findSkillsRoot` when `resolvedSkillRefs.length > 0`. Reader's pipelines use no
`ai_handler` steps at all, so the check never fires and there is truly nothing to warn
about here — verbatim record: **no warnings were emitted.**

## Handler fixture test

Picked `rules/api/items/star/post/pick.fn.js` (9 lines) — not the single shortest file in
the tree (`refresh/post/stamp.fn.js`, 3 lines, is `{ ms: Date.now() }` and not
fixture-friendly since it's non-deterministic), but the simplest **deterministic** real
handler, and a good demonstration case: it extracts a `recordId` out of a `data_query`
step's rows for the "set item star state" pipeline (`rule.yaml` alongside it), matching the
identical `pick.fn.js` pattern used by three other reader routes (`feeds/remove`,
`feeds/folder`, `items/read`).

```js
function handler({ steps }) {
  var rows = (steps && steps.query) || []
  var q = (rows && rows.length) ? rows[0] : null
  var rid = q ? (q.recordId || q.id || q._id) : null
  return {
    recordId: rid ? String(rid) : '',
    found: rid ? true : false
  }
}
```

Fixture written at
`apps/reader/.bffless/proxy-rules/reader/rules/api/items/star/post/pick.fn.test.yaml`:

```yaml
handler: ./pick.fn.js
cases:
  - name: extracts recordId when the guid query found a row
    data: { steps: { query: [{ recordId: "rec_123", guid: "abc", starred: false }] } }
    expect: { result: { recordId: "rec_123", found: true } }
  - name: falls back to id when recordId is absent
    data: { steps: { query: [{ id: 42, guid: "abc" }] } }
    expect: { result: { recordId: "42", found: true } }
  - name: not found when the guid query returned no rows
    data: { steps: { query: [] } }
    expect: { result: { recordId: "", found: false } }
  - name: not found when the query step never ran (condition false, no guid)
    data: { steps: {} }
    expect: { result: { recordId: "", found: false } }
```

### Result: executed, but FAILED — a genuine, newly-discovered Phase 0 defect

```
$ node $CLI rules test apps/reader/.bffless/proxy-rules/reader
0 passed, 4 failed
rules/api/items/star/post/pick.fn.test.yaml > extracts recordId when the guid query found a row: expected result {"recordId":"rec_123","found":true}, got {"recordId":"rec_123","found":true}
rules/api/items/star/post/pick.fn.test.yaml > falls back to id when recordId is absent: expected result {"recordId":"42","found":true}, got {"recordId":"42","found":true}
rules/api/items/star/post/pick.fn.test.yaml > not found when the guid query returned no rows: expected result {"recordId":"","found":false}, got {"recordId":"","found":false}
rules/api/items/star/post/pick.fn.test.yaml > not found when the query step never ran (condition false, no guid): expected result {"recordId":"","found":false}, got {"recordId":"","found":false}
```

All four "expected" and "got" values print **identical** JSON. Per this design doc's own
convention (§ Step 2 above: "if NOT equal, this is a real defect — report it, do NOT edit
anything to force a pass"), the same discipline applies here: I did not touch the CLI
source, and did not rewrite the fixture around the bug (e.g. down-scoping to a trivial
primitive-returning handler) just to get a green check mark.

**Root cause, isolated and confirmed:** `packages/cli/src/commands/test.ts:128` uses
`node:assert`'s `deepStrictEqual(outcome.result, c.expect.result)`. The handler executes
inside a fresh `node:vm` realm (`packages/cli/src/harness/run-handler.ts`, `vm.createContext`).
Any plain object or array **constructed inside** that vm-executed code (i.e. any `return { ... }`
or `return [...]` literal) carries that realm's `Object.prototype`/`Array.prototype`, which
is a *different object* than the host realm's `Object.prototype` used to build the YAML
fixture's `expect.result`. `assert.deepStrictEqual` checks prototype identity as part of
strict equality and fails cross-realm plain objects even when every enumerable
property/value is identical — Node's own message for this is literally "Values have same
structure but are not reference-equal." Minimal repro (outside the CLI, plain Node):

```js
import * as vm from 'node:vm';
import { deepStrictEqual, deepEqual } from 'node:assert';
const sandbox = {}; vm.createContext(sandbox);
const obj = vm.runInContext('({ a: 1, b: "x" })', sandbox);
deepStrictEqual(obj, { a: 1, b: 'x' });   // throws: not reference-equal
deepEqual(obj, { a: 1, b: 'x' });          // passes (loose compare ignores prototype)
```

This is **not** a fixture-authoring mistake and **not** a round-trip/handler-correctness
issue — separately confirmed by calling `runHandlerFile` directly and inspecting the
returned values, which are correct for all four cases. It also is not specific to `reader`:
the CLI's own `packages/cli/test/fixtures/synthetic/basic` fixture happens to dodge the bug
only because its `pick.fn.js` returns `steps.query[0]` **unchanged** (the exact object
reference that flowed in from the host-side `structuredClone`d input, never re-literal'd
inside the vm), so it never hits the cross-realm branch. Checked the CLI's own unit tests
(`packages/cli/test/rules-test.test.ts`) too: every `expect: { result: ... }` case there
uses a bare primitive (`1`, `2`, `42`, `999`) — none exercises an object-returning handler.
**Every single one of reader's 21 real `function_handler`s returns a freshly-constructed
object** (that's the entire point of a pipeline step — producing `steps.<name>.field` for
downstream steps), so as currently implemented `rules test` cannot pass a meaningful
assertion against *any* representative production handler. This is a coverage gap, not a
rare edge case.

## DX observations

- **File count:** 38 files total in the decompiled tree (36 authoring files + 2 in `dist/`),
  from a single 48.8 KB export JSON. 21 `.fn.js` files, 13 `rule.yaml` manifests, 2 schema
  manifests, 1 `ruleset.yaml`.
- **Largest handler:** `rules/api/refresh/post/enrich.fn.js`, 38 lines — still small; nothing
  in this real production set is close to unwieldy.
- **Directory naming for wildcard routes works cleanly:** `/api/auth/*` became
  `rules/api/auth/[...path]/any.rule.yaml` — filesystem-safe and legible at a glance.
- **Default-value elision works as intended:** the decompiled `any.rule.yaml` for the auth
  proxy only has 4 keys (`targetUrl`, `order`, `forwardCookies`, `description`) — no
  `stripPrefix`/`preserveHost`/`isEnabled`/`proxyType`/`timeout` clutter, even though the
  canonical export has all of them explicit. Nice signal-to-noise win for a human reading
  the authoring tree.
- **`code: ./pick.fn.js` file-ref sugar reads well** and made the four near-duplicate
  `pick.fn.js` handlers (`feeds/remove`, `feeds/folder`, `items/read`, `items/star`) easy to
  spot as copy-pasted siblings once decompiled to separate files — something that's much
  harder to notice inside one 48 KB JSON blob.
- **`rules/api/items/get/rule.yaml` is a 15-step pipeline** (view branching: all / river /
  starred / feed / folder / single-guid, each with a paired count+page step) and stays
  fully readable as YAML — the `condition:` fields on each step make the branch structure
  self-documenting in a way the flat JSON doesn't.
- **Long human-authored `description:` fields carry over verbatim** (e.g. the `ruleset.yaml`
  description cites `bffless/apps#112/#113/#114/#115/#119` issue numbers) — decompiling
  doesn't lose this kind of prose/traceability metadata.
- **Nothing awkward observed in the YAML itself** — the layout, `$schema:` refs, and `code:`
  refs all read naturally for a human reviewing or hand-editing this tree.

## Open items for Phase 1

1. **(Critical, newly discovered here) `rules test` cross-realm `deepStrictEqual` bug** —
   `commands/test.ts` must stop using `node:assert.deepStrictEqual` directly against
   vm-realm results. Fix options: (a) switch to `assert.deepEqual` (loose — confirmed to
   pass in the repro above, but also loosens type-coercion checks elsewhere, e.g.
   `1 == '1'`); (b) `structuredClone()` the vm result back into the host realm before
   comparing (preserves strictness, fixes only the realm-identity issue); (c) a custom
   recursive structural comparator that intentionally ignores prototype identity. (b) is
   probably the correct fix — it's the same idiom `run-handler.ts` already uses for the
   opposite direction (host → vm). This should block Phase 1 sign-off; as shipped, `rules
   test` cannot pass a meaningful assertion on the overwhelming majority of real
   `function_handler` code, since returning a plain object from `handler()` is the
   pipeline's core contract.
2. Consider surfacing `pull --decompile`'s "no warnings" case a little more visibly (e.g.
   `0 warnings` echoed explicitly) — right now a clean decompile and a silently-broken one
   look identical at the shell until you check the exit code or the tree.
3. `validate`'s skills cross-ref warning is correctly conditional on skill refs existing,
   but that means a rule set with zero `ai_handler` skill usage (like reader) gives no
   signal either way — worth a `docs/troubleshooting`-style note so users don't
   misinterpret silence as "skills wiring was checked and is fine" when it was actually
   skipped entirely.
4. The raw-byte size delta between original and rebuilt exports (see Equivalence section)
   is harmless given `exportsEquivalent` exists specifically to absorb it, but worth a
   one-line callout in end-user docs so a `diff` on the raw JSON isn't mistaken for
   evidence of data loss.

## Working-tree note

**`/home/rico/bffless/repos/apps` was left uncommitted.** Only
`apps/reader/.bffless/proxy-rules/reader/**` (the decompiled layout, its `dist/` build
output, and the new `pick.fn.test.yaml` fixture) was created there, as untracked working-tree
content — nothing was staged, committed, or pushed in that repo. It is left for the user to
review directly (`cd /home/rico/bffless/repos/apps && git status`).
