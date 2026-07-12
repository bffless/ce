# bffless CLI — developer & authoring reference

The npm-facing README is ../README.md; this file is the full as-built reference (authoring layout, manifest fields, defaults, harness, ESLint preset).

A CLI for authoring [BFFless](https://bffless.app) proxy rule sets as **files in git**
instead of only in the admin UI/MCP. It compiles a directory of YAML manifests + real
`.js` handler files into the same `bffless-proxy-rule-set` export JSON the dashboard's
Import already understands, and gives you a `node:vm` test harness + ESLint preset for
the handler code along the way.

Full design rationale, phasing, and open questions: see
[`docs/plans/proxy-rules-as-code.md`](../../../docs/plans/proxy-rules-as-code.md) — tracking
issue [bffless/ce#446](https://github.com/bffless/ce/issues/446). This README documents
what actually shipped in **Phase 0**: a local compiler/decompiler, a validator, a
declarative handler-test runner, and the two library exports (`bffless/harness`,
`bffless/eslint`). Live sync to a BFFless instance is available via `rules pull`, `rules push`,
and `rules diff` against a running instance. See
[Not yet](#not-yet) below for what's still planned but not built.

Today, a rule set lives only in the database, edited through a UI form or an AI-agent MCP
session — no history, no code review, no local testing, no diff. `function_handler` step
code (arbitrary JavaScript run in a sandboxed pipeline) is trapped as a JSON string with no
syntax highlighting or linting. This package turns a rule set into an ordinary directory:
one YAML file per route (derived from its filesystem path, Next.js-router-style), handler
bodies as real `.fn.js` files you can lint and unit-test, and a `bffless rules build` step
that compiles it back to the export format the platform already accepts.

## Install

```bash
npx bffless rules build          # one-off, no install
pnpm add -D bffless              # or pin it as a devDependency
```

## Quickstart

Starting from an existing export JSON (e.g. downloaded from the admin UI's rule-set export,
or any `*.proxy-rules.json` file already in a repo), decompile it into the authoring
layout, then build/validate/test it. This example uses the CLI's own test fixture
(`packages/cli/test/fixtures/synthetic/basic/expected.json`) as the export JSON — every
command below and its output was run for real against that fixture.

```console
$ npx bffless rules pull --from-file ./basic-export.json --decompile
/path/to/project/.bffless/proxy-rules/basic
```

That writes the authoring layout to `.bffless/proxy-rules/<ruleSet.name>/` by default (pass
`-o <dir>` to choose another location, `--force` to overwrite a non-empty one):

```console
$ find .bffless -type f
.bffless/proxy-rules/basic/rules/api/feeds/remove/post/pick.fn.js
.bffless/proxy-rules/basic/rules/api/feeds/remove/post/rule.yaml
.bffless/proxy-rules/basic/rules/api/items/[...path]/any.rule.yaml
.bffless/proxy-rules/basic/rules/api/items/get.rule.yaml
.bffless/proxy-rules/basic/ruleset.yaml
.bffless/proxy-rules/basic/schemas/items.schema.yaml
```

Now compile it back to an export JSON, validate it, and run its handler fixtures:

```console
$ npx bffless rules build .bffless/proxy-rules/basic
/path/to/project/.bffless/proxy-rules/basic/dist/basic.proxy-rules.json
3 rules, 1 schemas, 0 secrets referenced

$ npx bffless rules validate .bffless/proxy-rules/basic
$ echo $?
0

$ npx bffless rules test .bffless/proxy-rules/basic
0 passed, 0 failed
```

(`rules test` reports `0 passed` here because `--decompile` only round-trips what the
export JSON carries — canonical rules and extracted `.fn.js` handler code — not
hand-authored `*.fn.test.yaml` fixtures, which are an authoring-only artifact. Run
`npx bffless rules build|validate|test` directly against an authoring directory that has
`*.fn.test.yaml` files, e.g. the CLI's own `test/fixtures/synthetic/basic/`, to see
`rules test` actually execute cases — `2 passed, 0 failed` there.)

`build`, `validate`, and `test` all accept `[dirs...]`; with no arguments they resolve rule
sets from the nearest `.bffless/config.json`'s `ruleSets` glob array (walking up from `cwd`,
`tsconfig.json`-style) — see [Directory layout](#directory-layout) below.

## Directory layout

A rule set is any directory containing `ruleset.yaml`. Conventionally it lives at
`.bffless/proxy-rules/<set-name>/`, alongside `.bffless/skills/` (existing AI-skills
content), but every command takes an explicit directory argument, so the location itself
is not a convention the compiler enforces:

```
.bffless/
  config.json                        # { apiUrl?, project?, ruleSets? } — no secrets, committable
  proxy-rules/
    basic/                           # one directory per rule set — this IS <dirs...>
      ruleset.yaml                   # set metadata: { name, description?, environment? }
      schemas/
        items.schema.yaml            # pipeline schemas, referenced by name (never by UUID)
      rules/
        api/
          feeds/
            remove/
              post/                  # directory form: chosen because this rule has code files
                rule.yaml            # POST /api/feeds/remove
                pick.fn.js           # function_handler body — a real, lintable, testable .js file
                pick.fn.test.yaml    # declarative Vitest-free fixtures for pick.fn.js
          items/
            get.rule.yaml            # single-file form: GET /api/items (no code → no directory needed)
            [...path]/
              any.rule.yaml          # ANY /api/items/* (methods: [GET, HEAD] inside), trailing wildcard
      dist/                          # written by `rules build`; gitignored (a dist/.gitignore is
        basic.proxy-rules.json       #   auto-written alongside the default output path)
```

Two shapes are accepted per rule, and the compiler treats them identically: a **single
file** (`get.rule.yaml`) for a rule with no extracted code, or a **directory**
(`post/rule.yaml` + sibling `*.fn.js`/`*.fn.test.yaml` files) once a rule needs code beside
its manifest. `rules pull --decompile` picks the directory form automatically, exactly when
a rule's pipeline has at least one `function_handler` step.

## Rule manifest reference (`*.rule.yaml` / `rule.yaml`)

Every key is optional except where a stem/escape hatch fills it in; unknown keys are a
validation error (the schema is `.strict()`).

| Key | Type | Notes |
|---|---|---|
| `pathPattern` | `string` (must start with `/` or `*`) | Escape hatch — overrides the filesystem-derived path. Required when the pattern can't be expressed as directories (see [Route derivation](#route-derivation)). |
| `method` | `GET`\|`POST`\|`PUT`\|`PATCH`\|`DELETE`\|`HEAD`\|`OPTIONS` | Escape hatch/redundancy check — see [the method stem rules](#route-derivation). |
| `methods` | array of the above | Only legal in an `any.rule.yaml`/`any/rule.yaml` — declares a multi-method rule. |
| `targetUrl` | `string` | Upstream URL. Defaults to `http://internal/pipeline` when `proxyType` is (or infers to) `pipeline`. |
| `stripPrefix` | `boolean` | Default `true`. |
| `order` | integer ≥ 0 | Explicit route-matching priority. When omitted, derived from specificity sort — see [Route derivation](#route-derivation). |
| `timeout` | integer, 1000–120000 | Request timeout in ms. Default `30000`. |
| `preserveHost` | `boolean` | Default `false`. |
| `forwardCookies` | `boolean` | Default `false`. |
| `headerConfig` | `{ forward?: string[], strip?: string[], add?: Record<string,string> }` | `add` values must be committed as **empty-string placeholders** (`Authorization: ""`) — `rules build`/`validate` hard-error on a non-empty value: `secret values must not be committed; use empty-string placeholders`. |
| `authTransform` | free-form object | Supports `$file:`/`{{secrets.NAME}}` inside its values. |
| `internalRewrite` | `boolean` | Default `false`. |
| `proxyType` | `external_proxy`\|`internal_rewrite`\|`email_form_handler`\|`pipeline` | Inferred when omitted: `pipeline` if `pipeline`/`pipelineConfig` is set, `email_form_handler` if `emailHandlerConfig` is set, else `external_proxy`. An explicit value always wins over inference. |
| `emailHandlerConfig` | free-form object | Supports `$file:`/`{{secrets.NAME}}` inside its values. |
| `pipeline` | authoring sugar (see below) | Mutually exclusive with `pipelineConfig` (schema-level `.refine()` rejects both). |
| `pipelineConfig` | canonical `{ name, description?, steps: PipelineStep[], postSteps?, validators? }` | Same shape as the compiled export's `pipelineConfig` — use this when you already have canonical JSON to paste in; `steps[].handlerType`/`.config` (not `handler`). |
| `isEnabled` | `boolean` | Default `true`. |
| `debugEnabled` | `boolean` | Default `false`. |
| `description` | `string` | Free text. |

**The `pipeline:` sugar.** `pipeline: { name?, description?, steps: Step[], postSteps?,
validators? }`, where each `Step` is `{ id?, name, handler, config?, code?, isEnabled? }`.
`handler` (not `handlerType`) names the handler type (`data_query`, `function_handler`,
`response_handler`, `ai_handler`, …); `name` defaults the whole pipeline to
`"<route-under-rules/> <METHOD>"` when omitted (e.g. `api/feeds/remove POST`, as seen in
the quickstart output above). `validators` is `{ type: 'auth_required'|'rate_limit',
config? }[]`, unchanged from the canonical shape.

**Reference forms**, usable inside `pipeline:`/`pipelineConfig:`/`authTransform`/`emailHandlerConfig` values (and inside nested objects/arrays):

- **`code: <path ending .js>`** — authoring-only sugar on a `pipeline:` step, exclusive with
  a literal `config.code`: inlines the referenced file's contents as `config.code` at build
  time (byte-verbatim, no newline normalization). This is the `function_handler` body file,
  e.g. `code: ./pick.fn.js`.
- **`{ $file: <relative-path> }`** — deep-replaces that object with the referenced file's
  UTF-8 contents, anywhere in a manifest's values (not just `code:`). Used for
  `response_handler` bodies, email templates, long prompts, etc.
- **`$schema:<name>`** — inside any schema-id key (`schemaId`, `persistMessagesSchemaId`,
  `persistConversationsSchemaId`, and the deprecated `conversationsSchemaId`/
  `messagesSchemaId`), resolves to `schemas/<name>.schema.yaml`'s `id` (or a deterministic
  `uuidv5` derived from the name, if the schema manifest doesn't set its own `id:`). A raw
  UUID in one of these keys passes through unchanged with a warning if it matches no
  `schemas/*.schema.yaml`.
- **`{{secrets.NAME}}`** — a literal placeholder left in any string value (e.g.
  `targetUrl`, a `pipeline:` step's `config`). The compiler only *collects* every referenced
  secret name (surfaced in `rules build`'s summary line, e.g. `1 secrets referenced`) — it
  does not resolve or verify them against a live instance; that's a Phase 1 concern (see
  below).
- **`headerConfig.add` secret placeholders** — committed as an **empty string**
  (`Authorization: ""`), not a `$secret:`/template form; a non-empty value is a hard build
  error (see the table above).

**The method escape hatch.** The filename/directory stem (`get`, `post`, …, `any`) is
normally the sole source of a rule's HTTP method(s). `method:` inside a method-stem file
(e.g. `post.rule.yaml`) is accepted only if it matches the stem uppercased — a mismatch is
a build error (`method: GET conflicts with file stem 'post.rule.yaml' (expected POST)`).
Inside an `any.rule.yaml`, `method:` sets a single-method override and `methods:` sets a
multi-method list — the two may not both be set on the same rule.

## Defaults & elision table

Verbatim from `src/format/defaults.ts` (`RULE_DEFAULTS`) — the compiler injects these when
a key is omitted from the manifest; the decompiler removes a key whose compiled value
equals its default, so a round-tripped manifest stays minimal:

| Key | Default |
|---|---|
| `stripPrefix` | `true` |
| `timeout` | `30000` |
| `preserveHost` | `false` |
| `forwardCookies` | `false` |
| `internalRewrite` | `false` |
| `isEnabled` | `true` |
| `debugEnabled` | `false` |
| `proxyType` | `'external_proxy'` (unless inferred to `'pipeline'`/`'email_form_handler'` — see the manifest table above; an explicit value always wins) |

`targetUrl` has one additional, `proxyType`-conditional default: `'http://internal/pipeline'`
(`PIPELINE_TARGET_URL_DEFAULT`), applied only when the effective `proxyType` is `'pipeline'`
and `targetUrl` was omitted; elided by the decompiler under the same condition.

## Route derivation

The path segments under `rules/` (down to, but not including, the method-stem
file/directory) **are** the `pathPattern`, Next.js-router-style:

- A literal segment (`api`, `feeds`, `items`, …) is a literal path segment.
- A trailing `[...anything]/` directory maps to a trailing `*` — e.g.
  `rules/api/items/[...path]/any.rule.yaml` compiles to `pathPattern: /api/items/*` (see the
  quickstart fixture above).
- A **mid-path** bracketed segment (`[anything]/`, not in trailing position) also maps to a
  single `*`. Since a bare `*` carries no name, the decompiler names the directory
  positionally — `[p<N>]`, where `N` is the segment's 0-based index in the pattern — rather
  than inventing a semantic name. (Verified live: decompiling `/api/feeds/*/items` produces
  `rules/api/feeds/[p2]/items/get.rule.yaml`.) On compile, any bracketed segment (`[...x]`
  or `[x]`) is accepted in that position — only trailing-vs-mid-path position matters, not
  the name inside the brackets.
- **Reserved literal segments** can't be authored as a directory name: `rules`, any method
  stem (`get`/`post`/`put`/`patch`/`delete`/`head`/`options`/`any`), and anything starting
  with `[` or `_`.
- **`pathPattern:` escape hatch** — a manifest may always set `pathPattern:` explicitly to
  override the derived path. This is required whenever the pattern can't be expressed as a
  directory path at all (a wildcard mid-*segment*, e.g. `/api/*.json`; a pattern not
  starting with `/`; a reserved-name collision). Such rules decompile under
  `rules/_custom/<slug>/<stem>.rule.yaml`, where `<slug>` is the pattern with `/`→`-`,
  `*`→`_star_`, stripped to `[A-Za-z0-9._-]`. Verified live: `/api/*.json` (GET) decompiles
  to `rules/_custom/-api-_star_.json/get.rule.yaml` containing `pathPattern: /api/*.json`.
  The same escape hatch is also used — with a warning — when two distinct patterns would
  otherwise collide on the same derived directory; the decompiler suffixes the base segment
  (`-2`, `-3`, …) and keeps an explicit `pathPattern:` so the rule still resolves correctly.
- **Duplicate `(pathPattern, method)` pairs** across different manifest files (mirroring the
  database's unique key) are a hard build error naming both files.

**Ordering.** Rules are sorted by specificity: more literal segments first; among ties,
fewer wildcards first; among further ties, a *later* wildcard position sorts first; final
tiebreakers are `pathPattern` (lexicographic) then method (methodless sorts last). Each
rule's 0-based position in that sort becomes its `order:` — **unless the manifest sets an
explicit `order:`, which always wins** over the derived value (verified live in the
quickstart fixture: `/api/items/*` derives to `order: 2` by specificity, but its manifest
sets `order: 5` and the compiled export carries `5`). The decompiler elides `order:` exactly
when the stored value equals the derived one. Two rules landing on the same numeric order
(an explicit value colliding with another rule's derived one, or two explicit values
matching) is a `rules build` warning, not an error.

## `runHandler` — Vitest usage

`bffless/harness` exports `runHandler(code, data?, opts?)` and
`runHandlerFile(file, data?, opts?)`, executing a `function_handler` body in a `node:vm`
sandbox that mirrors the CE pipeline runtime (same global allow-list — `Math`, `Date`,
`JSON`, no `require`/`process`/`fetch`/`Buffer`; same deep-frozen, `structuredClone`d
`data` argument with `utils` spread in; same default 5000ms timeout, clamped 1000–30000).
It resolves `{ result, logs }` on success, or rejects if the handler throws.

```ts
// pick.test.ts
import { describe, it, expect } from 'vitest';
import { runHandlerFile } from 'bffless/harness';

describe('pick.fn.js', () => {
  it('returns the first query row', async () => {
    const { result } = await runHandlerFile('./rules/api/feeds/remove/post/pick.fn.js', {
      steps: { query: [{ id: 1, url: 'https://a' }] },
    });
    expect(result).toEqual({ id: 1, url: 'https://a' });
  });
});
```

Run against the CLI's own fixture handler (`function handler({ steps }) { return
steps.query[0]; }`), this produces exactly what the assertion above expects — verified live
via the built harness module:

```console
$ node -e "import('./dist/harness/run-handler.js').then(async m => {
  const r = await m.runHandlerFile('./test/fixtures/synthetic/basic/rules/api/feeds/remove/post/pick.fn.js',
    { steps: { query: [{ id: 1, url: 'https://a' }] } });
  console.log(JSON.stringify(r));
})"
{"result":{"id":1,"url":"https://a"},"logs":[]}
```

## `*.fn.test.yaml` reference

Declarative fixtures for a handler file, run by `bffless rules test` (no Vitest required —
these run standalone through the same `node:vm` harness):

```yaml
# pick.fn.test.yaml
handler: ./pick.fn.js          # path to the .fn.js file, relative to this fixture
cases:
  - name: returns first query row
    data: { steps: { query: [{ id: 1, url: "https://a" }] } }
    expect: { result: { id: 1, url: "https://a" } }
  - name: throws when query is missing
    data: { steps: {} }
    expect: { throws: "Cannot read" }
```

- `handler` — relative path to the `.fn.js` file under test.
- `cases[].data` — the harness's input object: `{ user?, request?, steps?, deployment? }`.
- `cases[].expect` — exactly one of:
  - `result` — deep-equality (`node:assert`'s `deepStrictEqual`) against the handler's
    return value.
  - `throws` — a substring the thrown error's `message` must contain.

A `*.fn.test.yaml` with invalid YAML/schema, or whose `handler:` doesn't resolve to a real
file, fails just that file's case(s) — it does not abort the rest of the run. Any
`*.fn.test.yaml` anywhere under a rule set's `rules/` directory is discovered automatically;
it does not need to sit next to the handler it tests, though that's the convention.

## ESLint preset

`bffless/eslint` is a flat-config array scoped to `**/*.fn.js` — the convention for
extracted `function_handler` bodies — flagging every construct the CE runtime's sandbox
would itself reject at execution time (`eval`, `Function`/`new Function`, `require`,
dynamic `import()`, `process.*`, `global(This).*`, `.__proto__`, `.constructor[…]`,
`Buffer(...)`), plus a missing `handler` function.

```js
// eslint.config.js
import bffless from 'bffless/eslint';

export default [
  // ...your existing config...
  ...bffless,
];
```

`bffless rules validate` runs the same check (module `src/lint/patterns.ts`) over every
`.fn.js` file it finds, independent of the ESLint preset — the preset is for editor/CI
integration, `rules validate` is what a build pipeline should gate on. Example, run live
against the CLI's own "broken" fixture set:

```console
$ npx bffless rules validate test/fixtures/synthetic/broken/.bffless/proxy-rules/broken
rules/api/a/post.rule.yaml Unrecognized key(s) in object: 'notARealKey'
rules/api/b/post.rule.yaml code file not found: ./missing.js
rules/api/c/post.rule.yaml schema ref "$schema:nope" has no manifest (schemas/nope.schema.yaml)
rules/api/d/post/bad.fn.js:2 Prohibited pattern detected: \bprocess\s*\.
rules/api/e/post.rule.yaml skill "does-not-exist" not found in ../../skills/
```

## Not yet

Per [the design doc's phasing](../../../docs/plans/proxy-rules-as-code.md#6-phasing), the
following are **planned but not implemented** in this package — do not write CI or docs
that assume they exist:

- **Secret verification** — the compiler collects `{{secrets.NAME}}` references (see the
  manifest reference above) but never checks them against a target instance's
  `project_secrets`; that check (`missingSecrets[]`, `--require-secrets`) is part of the
  planned sync endpoint.
- **`$secret: NAME` header placeholders** — the design doc's plan for `headerConfig.add`
  used a `$secret: NAME` reference form; what's actually implemented (see the manifest
  reference above) is a plain empty-string placeholder convention (`Authorization: ""`),
  enforced by a build-time check — there is no `$secret:` syntax in this package.
- **Revisions/rollback, TypeScript handlers + bundling, `rules dev` watch mode** — all
  Phase 3 per the design doc; none exist here.
