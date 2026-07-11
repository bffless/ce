# Proxy Rules CLI — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/cli` (npm name `bffless`): a compiler/decompiler between a file-per-rule authoring layout and the existing proxy-rule-set v2 export JSON, plus a sandbox lint preset, a vm handler test harness, and `rules build / validate / test / pull --from-file` commands — validated by a byte-faithful round-trip of the real reader export.

**Architecture:** Pure client-side CLI, no CE backend changes. Three module groups: `format/` (wire-format types, canonicalization, defaults, route derivation), `compile/` (build + decompile), `lint/` + `harness/` (sandbox parity), `commands/` (commander wiring). The wire format is the v2 export envelope exactly as `ProxyRuleSetsPage.tsx` produces it, **plus** first-class `methods` support (frontend exporter bug filed as bffless/ce#448).

**Tech Stack:** TypeScript ^5.3.3, ESM, Node >=18, commander, zod, `yaml`, Vitest, plain `tsc` build. No new dependencies added to `apps/*`.

**Design doc:** `docs/plans/proxy-rules-as-code.md` (merged via #447). Decisions resolved during planning (2026-07-11, with user):

- CLI home: `ce/packages/cli` (first real workspace package; `packages/*` is already in `pnpm-workspace.yaml`).
- npm publish deferred — package named `bffless` with a working bin from day one, no release wiring in this plan.
- Vitest for the package's own tests; commander + zod + `yaml`.
- **§7 Q4 amended: compiled JSON is NOT committed.** `rules build` writes to `<set>/dist/` and the CLI drops a `dist/.gitignore` containing `*` so consumer repos need no gitignore edits. (Amend the design doc — Task 1.)
- Schema refs: keep the exact export config keys (`schemaId`, `persistMessagesSchemaId`, …) but the authored **value** is `$schema:<name>`; `schemas/<name>.schema.yaml` carries the original UUID as `id:` so round-trips are exact. (The design doc's `schema: feeds` key-rename sugar is dropped — key fidelity wins.)
- `rules pull` exists in Phase 0 only as `rules pull --from-file <export.json> --decompile` (no network until Phase 1).
- Handler fixture tests: declarative `*.fn.test.yaml` files run by `rules test`; `runHandler` is also exported (`bffless/harness`) for plain Vitest use.

## Global Constraints

- **Wire format v2, verbatim:** envelope keys `version:2`, `exportedAt` (ISO string), `kind:'bffless-proxy-rule-set'`, `ruleSet:{name,description?,environment?}`, `rules[]`, `schemas?[]` (key omitted when empty — never `[]`, never `null`). Rule objects carry ONLY these keys, in this canonical order: `pathPattern, method, methods, targetUrl, stripPrefix, order, timeout, preserveHost, forwardCookies, headerConfig, authTransform, internalRewrite, proxyType, emailHandlerConfig, pipelineConfig, isEnabled, debugEnabled, description`. Absent optional values are OMITTED (no `null`s — verified against all four real exports).
- **Round-trip invariant (the make-or-break gate):** for every real fixture, `build(decompile(export))` must equal the original under `exportsEquivalent` (ignores `exportedAt`, key order, and rule array position after sorting both sides by `(order, pathPattern, method ?? '')`) — and every `function_handler` `config.code` string must be **byte-identical**.
- **Defaults table (single source of truth, `src/format/defaults.ts`):** `stripPrefix:true, timeout:30000, preserveHost:false, forwardCookies:false, internalRewrite:false, isEnabled:true, debugEnabled:false, proxyType:'external_proxy'`; pipeline-rule default `targetUrl:'http://internal/pipeline'`. Elision is EXACT-MATCH only — real exports contain pipeline rules with `targetUrl:"pipeline"` which must survive round-trip explicitly.
- **Sandbox parity:** lint patterns and harness globals mirror `apps/backend/src/pipelines/function-runner.service.ts` — the 13 `PROHIBITED_PATTERNS` (lines ~78–97), the exact global allow-list (~250–308), `utils` crypto bag (~144–176), timeout default 5000ms clamped 1000–30000 (~224).
- **Handler-type strings** are the canonical `HandlerType` union from `apps/backend/src/pipelines/types.ts:59-87` (`data_query`, `email_handler`, `function_handler`, …) — never the design doc's shorthand.
- Node >=18, ESM (`"type":"module"`), no CJS build. All new code under `packages/cli/`; the only files touched outside it are the root `package.json` (drop dead `build:action` script), `docs/plans/proxy-rules-as-code.md` (Q4 amendment), and `pnpm-lock.yaml`.
- Every commit message follows repo convention (`feat(cli): …`, `test(cli): …`, `docs: …`) and ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run tests from `packages/cli` with `pnpm vitest run` (or `pnpm --filter bffless test` from root).

## File Structure

```
packages/cli/
  package.json                # name "bffless", bin { bffless: "./dist/index.js" }
  tsconfig.json
  vitest.config.ts
  README.md                   # Task 12
  src/
    index.ts                  # bin entry: commander program
    config.ts                 # .bffless/config.json discovery (walk-up) + zod schema
    format/
      types.ts                # RuleSetExport, ExportedRule, PipelineConfig, …
      canonical.ts            # canonicalizeExport, stringifyExport, exportsEquivalent
      defaults.ts             # RULE_DEFAULTS, applyRuleDefaults, elideRuleDefaults
      routes.ts               # patternToRelPath, relPathToPattern, sortRulesBySpecificity
      manifest.ts             # zod schemas: ruleset.yaml, *.rule.yaml, *.schema.yaml, *.fn.test.yaml
      schema-refs.ts          # SCHEMA_REF_KEYS + walkSchemaRefs (mirror of backend schema-refs.util.ts)
    compile/
      build.ts                # buildRuleSet(dir) → BuildResult
      decompile.ts            # decompileExport(exp) → DecompileResult; writeDecompiled(...)
    lint/
      patterns.ts             # the 13 prohibited patterns + validateHandlerSource
      eslint-preset.ts        # flat config export (package export "bffless/eslint")
    harness/
      run-handler.ts          # runHandler / runHandlerFile (package export "bffless/harness")
      utils.ts                # sandbox utils bag reimplemented on node:crypto
    commands/
      build.ts  validate.ts  test.ts  pull.ts
  test/
    fixtures/
      real/                   # reader / handoff / studio-blog exports copied from bffless/apps
      synthetic/              # hand-written mini sets: authored layout + expected export pairs
    *.test.ts                 # one test file per src module, same basename
```

Interfaces named below are binding across tasks — later tasks consume them verbatim.

---

### Task 1: Scaffold `packages/cli` + workspace hygiene

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/vitest.config.ts`, `packages/cli/src/index.ts`, `packages/cli/test/smoke.test.ts`
- Modify: `package.json` (root — remove dead `build:action` script), `docs/plans/proxy-rules-as-code.md` (§7 Q4 amendment)
- Delete: `packages/.gitkeep`

**Interfaces:**
- Produces: a buildable, testable ESM package named `bffless` with bin `bffless`; root `pnpm --filter bffless build|test` works. Later tasks add sources under `src/` and tests under `test/` without touching this scaffolding.

- [ ] **Step 1: Write the failing smoke test**

`packages/cli/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const bin = path.resolve(fileURLToPath(import.meta.url), '../../dist/index.js');

describe('bffless bin', () => {
  it('prints top-level help mentioning the rules command', () => {
    const out = execFileSync('node', [bin, '--help'], { encoding: 'utf8' });
    expect(out).toContain('rules');
  });
  it('exits nonzero on unknown command', () => {
    expect(() => execFileSync('node', [bin, 'nope'], { encoding: 'utf8', stdio: 'pipe' })).toThrow();
  });
});
```

- [ ] **Step 2: Create package.json / tsconfig / vitest config**

`packages/cli/package.json`:
```json
{
  "name": "bffless",
  "version": "0.0.0",
  "description": "BFFless CLI — proxy rules as code (build, validate, test, decompile)",
  "type": "module",
  "license": "O'Saasy",
  "engines": { "node": ">=18.0.0" },
  "bin": { "bffless": "./dist/index.js" },
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./harness": "./dist/harness/run-handler.js",
    "./eslint": "./dist/lint/eslint-preset.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "pnpm build && vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "yaml": "^2.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^1.6.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`packages/cli/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20000 } });
```

`packages/cli/src/index.ts` (minimal — Task 11 replaces the stub subcommands):
```ts
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command('bffless').description('BFFless CLI');
program.command('rules').description('Proxy rule sets as code (build, validate, test, pull)');
program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 3: Workspace hygiene**

In root `package.json`, delete the line `"build:action": "pnpm --filter github-action build",` (the `packages/github-action` it referenced moved out to the `bffless/upload-artifact` repo long ago). Delete `packages/.gitkeep`. Run `pnpm install` at the repo root to link the new workspace package (updates `pnpm-lock.yaml`).

- [ ] **Step 4: Amend the design doc's Q4 decision**

In `docs/plans/proxy-rules-as-code.md`, replace the Q4 bullet in §7:

```markdown
- **Q4 Committed build artifact** — **amended 2026-07-11: not committed.** `bffless rules
  build` writes to `<set>/dist/` and drops a `dist/.gitignore` (`*`) so the compiled JSON
  never enters git. Sources are the single source of truth from day one; to deploy during
  Phases 0–1, run `build` and Import the result via the dashboard. (Originally: commit
  lockfile-style during Phases 0–1 — retired to avoid generated JSON in PRs and a CI
  freshness check.)
```

- [ ] **Step 5: Build, run tests, verify pass**

Run: `cd packages/cli && pnpm build && pnpm vitest run`
Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli package.json pnpm-lock.yaml docs/plans/proxy-rules-as-code.md
git rm --cached packages/.gitkeep 2>/dev/null; rm -f packages/.gitkeep
git commit -m "feat(cli): scaffold bffless CLI package (packages/cli)"
```

---

### Task 2: Wire-format types, canonical serializer, comparator + real fixtures

**Files:**
- Create: `packages/cli/src/format/types.ts`, `packages/cli/src/format/canonical.ts`, `packages/cli/test/canonical.test.ts`
- Create (copies): `packages/cli/test/fixtures/real/reader.proxy-rules.json`, `.../handoff.proxy-rules.json`, `.../studio-blog.proxy-rules.json` — copied verbatim from `/home/rico/bffless/repos/apps/apps/{reader,handoff,studio}/bffless/`

**Interfaces:**
- Produces (consumed by every later task):
  - `types.ts`: `RuleSetExport`, `ExportedRule`, `ExportedSchema`, `SchemaField`, `PipelineConfig`, `PipelineStep`, `PipelineValidator`, `HeaderConfig`, `RULE_KEY_ORDER: readonly string[]`
  - `canonical.ts`: `canonicalizeExport(e: RuleSetExport): RuleSetExport`, `stringifyExport(e: RuleSetExport): string`, `exportsEquivalent(a: RuleSetExport, b: RuleSetExport): { equal: boolean; diffs: string[] }`

- [ ] **Step 1: Copy the three real fixtures**

```bash
mkdir -p packages/cli/test/fixtures/real
cp /home/rico/bffless/repos/apps/apps/reader/bffless/reader.proxy-rules.json packages/cli/test/fixtures/real/
cp /home/rico/bffless/repos/apps/apps/handoff/bffless/handoff.proxy-rules.json packages/cli/test/fixtures/real/
cp /home/rico/bffless/repos/apps/apps/studio/bffless/studio-blog.proxy-rules.json packages/cli/test/fixtures/real/
```

- [ ] **Step 2: Write the failing tests**

`packages/cli/test/canonical.test.ts` — test cases (write all of these):
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeExport, stringifyExport, exportsEquivalent } from '../src/format/canonical.js';
import type { RuleSetExport } from '../src/format/types.js';

const realDir = path.resolve('test/fixtures/real');
const real = readdirSync(realDir).map((f) => JSON.parse(readFileSync(path.join(realDir, f), 'utf8')) as RuleSetExport);

const mini: RuleSetExport = {
  version: 2, exportedAt: '2026-07-11T00:00:00.000Z', kind: 'bffless-proxy-rule-set',
  ruleSet: { name: 'mini' },
  rules: [{ pathPattern: '/api/b', method: 'GET', targetUrl: 'pipeline', stripPrefix: true, order: 1,
            timeout: 30000, preserveHost: false, forwardCookies: false, proxyType: 'pipeline', isEnabled: true,
            pipelineConfig: { name: 'b', steps: [{ name: 's', handlerType: 'response_handler', config: { status: 200 } }] } },
          { pathPattern: '/api/a', method: 'POST', targetUrl: 'x', stripPrefix: true, order: 0,
            timeout: 30000, preserveHost: false, forwardCookies: false, proxyType: 'external_proxy', isEnabled: true }],
};

describe('canonicalizeExport / stringifyExport', () => {
  it('orders envelope keys version,exportedAt,kind,ruleSet,rules,schemas', () => {
    const keys = Object.keys(canonicalizeExport(structuredClone(mini)));
    expect(keys).toEqual(['version', 'exportedAt', 'kind', 'ruleSet', 'rules']);
  });
  it('sorts rules by (order, pathPattern, method) and rule keys by RULE_KEY_ORDER', () => {
    const c = canonicalizeExport(structuredClone(mini));
    expect(c.rules[0].pathPattern).toBe('/api/a');
    expect(Object.keys(c.rules[1])[0]).toBe('pathPattern');
  });
  it('omits schemas key when empty and never emits null values', () => {
    const c = canonicalizeExport({ ...structuredClone(mini), schemas: [] });
    expect('schemas' in c).toBe(false);
    expect(stringifyExport(c)).not.toContain('null');
  });
  it('stringify is deterministic and ends with newline', () => {
    expect(stringifyExport(structuredClone(mini))).toBe(stringifyExport(structuredClone(mini)));
    expect(stringifyExport(mini).endsWith('\n')).toBe(true);
  });
  it('round-trips every real fixture through canonicalize losslessly (deep-equal)', () => {
    for (const exp of real) {
      const r = exportsEquivalent(exp, canonicalizeExport(structuredClone(exp)));
      expect(r.diffs).toEqual([]);
    }
  });
});

describe('exportsEquivalent', () => {
  it('ignores exportedAt and key order', () => {
    const b = structuredClone(mini); b.exportedAt = '2030-01-01T00:00:00.000Z';
    expect(exportsEquivalent(mini, b).equal).toBe(true);
  });
  it('reports a dotted path for a changed nested value', () => {
    const b = structuredClone(mini);
    (b.rules.find(r => r.pathPattern === '/api/b')!.pipelineConfig!.steps[0].config as any).status = 500;
    const r = exportsEquivalent(mini, b);
    expect(r.equal).toBe(false);
    expect(r.diffs.some(d => d.includes('/api/b') && d.includes('status'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail** (`pnpm build && pnpm vitest run test/canonical.test.ts` — FAIL: module not found)

- [ ] **Step 4: Implement `types.ts` and `canonical.ts`**

`types.ts` — the binding shapes (transcribe exactly; grounded in `proxyRulesApi.ts:152-178`, `proxy-rules.schema.ts:69-102,157-377`, plus `methods`):
```ts
export interface SchemaField { name: string; type: string; required?: boolean; [k: string]: unknown }
export interface ExportedSchema { id: string; name: string; fields: SchemaField[] }
export interface PipelineValidator { type: 'auth_required' | 'rate_limit'; config?: Record<string, unknown> }
export interface PipelineStep { id?: string; name: string; handlerType: string; config: Record<string, unknown>; isEnabled?: boolean }
export interface PipelineConfig { name: string; description?: string; steps: PipelineStep[]; postSteps?: PipelineStep[]; validators?: PipelineValidator[] }
export interface HeaderConfig { forward?: string[]; strip?: string[]; add?: Record<string, string> }
export type ProxyType = 'external_proxy' | 'internal_rewrite' | 'email_form_handler' | 'pipeline';

export interface ExportedRule {
  pathPattern: string;
  method?: string;
  methods?: string[];
  targetUrl: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: HeaderConfig;
  authTransform?: Record<string, unknown>;
  internalRewrite?: boolean;
  proxyType?: ProxyType;
  emailHandlerConfig?: Record<string, unknown>;
  pipelineConfig?: PipelineConfig;
  isEnabled?: boolean;
  debugEnabled?: boolean;
  description?: string;
}

export interface RuleSetExport {
  version: 2;
  exportedAt: string;
  kind: 'bffless-proxy-rule-set';
  ruleSet: { name: string; description?: string; environment?: string };
  rules: ExportedRule[];
  schemas?: ExportedSchema[];
}

export const RULE_KEY_ORDER = ['pathPattern','method','methods','targetUrl','stripPrefix','order','timeout','preserveHost','forwardCookies','headerConfig','authTransform','internalRewrite','proxyType','emailHandlerConfig','pipelineConfig','isEnabled','debugEnabled','description'] as const;
export const ENVELOPE_KEY_ORDER = ['version','exportedAt','kind','ruleSet','rules','schemas'] as const;
```

`canonical.ts` behavior spec:
- `canonicalizeExport`: deep-clone; **scoped** null/undefined stripping — drop `null`/`undefined` values ONLY at structural levels (envelope keys, `ruleSet` keys, rule top-level keys, pipeline-step top-level keys, `pipelineConfig`/`schemas[]` top-level keys); values INSIDE `headerConfig`, `authTransform`, `emailHandlerConfig`, `steps[].config`, and `schemas[].fields[]` are user data and pass through verbatim, `null`s included. Unknown keys at any structural level (envelope, rule, step) are an error — throw with the key name, and the check runs BEFORE stripping so a null-valued unknown key still throws. Order envelope keys per `ENVELOPE_KEY_ORDER`, rule keys per `RULE_KEY_ORDER`; sort `rules` by `(order ?? 0, pathPattern, method ?? '')`; sort `schemas` by `name`; delete `schemas` when absent/empty. Step keys normalized to `id,name,handlerType,config,isEnabled` (both orders occur in real fixtures). *(Amended after Task 2 review: unscoped deep stripping would silently alter user config data; unknown-key strictness extended to envelope and step levels.)*
- `stringifyExport`: `JSON.stringify(canonicalizeExport(e), null, 2) + '\n'`.
- `exportsEquivalent(a,b)`: compare `canonicalizeExport(a)` vs `canonicalizeExport(b)` with `exportedAt` deleted from both AND each rule normalized to its defaults-complete form (`applyRuleDefaults`, Task 3) before diffing — real exports from different exporter eras differ in whether default-valued keys (`internalRewrite`, `debugEnabled`) are present, and absent = default is the DB's own import semantics, so equivalence is semantic, not key-presence. Walk recursively collecting dotted diff paths, using `rules[<pathPattern> <method>]` (not array index) as the rules path segment; `{ equal: diffs.length === 0, diffs }`. *(Amended during Task 3: strict key-presence identity is unsatisfiable across exporter eras — verified against reader/handoff (old, keys absent) vs studio-blog (current, keys explicit).)*

- [ ] **Step 5: Run tests, verify pass** (`pnpm build && pnpm vitest run test/canonical.test.ts` — all pass)

- [ ] **Step 6: Commit** — `git add packages/cli && git commit -m "feat(cli): wire-format types, canonical serializer, export comparator"`

---

### Task 3: Defaults & elision module

**Files:**
- Create: `packages/cli/src/format/defaults.ts`, `packages/cli/test/defaults.test.ts`

**Interfaces:**
- Produces: `RULE_DEFAULTS` (const object per Global Constraints), `PIPELINE_TARGET_URL_DEFAULT = 'http://internal/pipeline'`, `applyRuleDefaults(partial: Partial<ExportedRule> & { pathPattern: string }): ExportedRule`, `elideRuleDefaults(rule: ExportedRule): Partial<ExportedRule>`.
- `applyRuleDefaults` fills every `RULE_DEFAULTS` key that is absent; infers `proxyType` = `'pipeline'` when `pipelineConfig` present, `'email_form_handler'` when `emailHandlerConfig` present (explicit `proxyType` always wins); for pipeline rules with no `targetUrl`, sets `PIPELINE_TARGET_URL_DEFAULT`.
- `elideRuleDefaults` removes keys whose value strictly equals the default AND is re-derivable: drops `proxyType` only when it equals what inference would produce; drops `targetUrl` only when rule is pipeline AND value === `PIPELINE_TARGET_URL_DEFAULT` (so `"pipeline"`-valued targetUrls survive explicitly); never drops `pathPattern`, `order` (order elision is routing's job, Task 4), `method`/`methods`.

- [ ] **Step 1: Write failing tests** — cases: (a) minimal pipeline manifest gains all defaults + inferred proxyType + default targetUrl; (b) explicit `proxyType:'external_proxy'` beats inference; (c) elide→apply is identity on the **defaults-complete form** for every rule of every real fixture: `applyRuleDefaults(elideRuleDefaults(applyRuleDefaults(r)))` deep-equals `applyRuleDefaults(r)` for each canonicalized rule `r` *(amended during Task 3: older exports omit default-valued keys the current exporter emits, so key-presence identity on raw rules is unsatisfiable — absent = default is the semantic)*; (d) `targetUrl:"pipeline"` is preserved by elision; (e) `timeout:30000` dropped, `timeout:15000` kept; (f) `exportsEquivalent` (Task 2, amended) treats a rule with absent `internalRewrite`/`debugEnabled` as equal to the same rule with them explicitly `false`.
- [ ] **Step 2: Run tests — FAIL** (module not found)
- [ ] **Step 3: Implement `defaults.ts`** per the interface spec above (a table-driven loop over `RULE_DEFAULTS`, plus the two inference special cases — keep it under ~80 lines)
- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): rule defaults injection and elision"`

---

### Task 4: Route derivation & specificity ordering

**Files:**
- Create: `packages/cli/src/format/routes.ts`, `packages/cli/test/routes.test.ts`

**Interfaces:**
- Produces:
  - `patternToRelPath(pattern: string): string[] | null` — filesystem segments for a pathPattern, or `null` when inexpressible. Mapping: leading `/` dropped; literal segment → same-name directory iff it matches `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` and is not a reserved name (`rules`, a method filename stem, or anything starting with `[` or `_`); a full `*` segment → `[...path]` when last, `[p<i>]` (i = segment index) otherwise; anything else (partial-segment `*`, unsafe chars, empty) → `null`.
  - `relPathToPattern(segments: string[]): string` — exact inverse: `[...anything]` → trailing `*`, `[anything]` → `*`, literal otherwise. `relPathToPattern(patternToRelPath(p)!) === p` must hold for every expressible `p`.
  - `sortRulesBySpecificity<T extends { pathPattern: string; method?: string }>(rules: T[]): T[]` — stable sort: more literal segments first; among equal, fewer wildcards first; wildcard-later-in-path first; then `pathPattern` lexicographic; then `method ?? '~'` (methodless last). Deterministic on every input.
  - `deriveOrders(rules): Map<rule, number>` — position (0-based) in the specificity sort. Compiler uses this when a manifest has no `order:`; decompiler elides `order:` exactly when the stored value equals the derived one.
- Consumed by: Tasks 6, 7.

- [ ] **Step 1: Write failing tests** — must include every real pathPattern from the fixtures (`/api/auth/*`, `/api/feeds/remove`, `/r/*`, `/api/resolve/*`, `/feed.xml`, `/feed/*`, `/api/uploads/content/*`, …): expressibility, exact inverse round-trip for each, `null` for `/api/v[1]/x` (bracket) and `/api/*x` (partial-segment glob); a specificity table test: `/api/feeds/remove` sorts before `/api/feeds` sorts before `/api/*` sorts before `/*`; stability test (same input twice → identical order).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `routes.ts`** per spec
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): pathPattern <-> filesystem route derivation and specificity ordering"`

---

### Task 5: Manifest schemas (zod) + schema-ref walker

**Files:**
- Create: `packages/cli/src/format/manifest.ts`, `packages/cli/src/format/schema-refs.ts`, `packages/cli/test/manifest.test.ts`

**Interfaces:**
- Produces (`manifest.ts` — all zod schemas + inferred types):
  - `RulesetManifest` for `ruleset.yaml`: `{ name: string; description?: string; environment?: string }` (strict — unknown keys rejected).
  - `RuleManifest` for `*.rule.yaml` / `rule.yaml`: every `ExportedRule` key optional EXCEPT none required (pathPattern/method come from the filesystem; `pathPattern:` and `methods:`/`method:` are the escape hatches), plus the authoring-only key `pipeline?:` which is `PipelineConfig` where each step uses `handler:` instead of `handlerType:` and may use `code: <relative path>` (string ending `.js`) in place of `config.code`. Strict mode. Exactly one of `pipeline` / `pipelineConfig` may be present.
  - `SchemaManifest` for `schemas/<name>.schema.yaml`: `{ id?: string (uuid); name: string; fields: SchemaField[] }`.
  - `FnTestManifest` for `*.fn.test.yaml`: `{ handler: string; cases: Array<{ name: string; data?: { user?: unknown; request?: unknown; steps?: unknown; deployment?: unknown }; expect: { result?: unknown; throws?: string } }> }`.
  - `parseYamlFile<T>(path, schema): T` helper — reads, parses with `yaml`, zod-validates, and on failure throws an error whose message contains the file path and the zod issue paths.
- Produces (`schema-refs.ts` — mirror of `apps/backend/src/proxy-rules/schema-refs.util.ts:10-60`):
  - `SCHEMA_REF_KEYS = ['schemaId','persistMessagesSchemaId','persistConversationsSchemaId','conversationsSchemaId','messagesSchemaId'] as const`
  - `walkSchemaRefs(value: unknown, visit: (ref: string, set: (v: string) => void) => void): void` — recursive walk calling `visit` for every string value under a `SCHEMA_REF_KEYS` key, with a setter to replace it.
- Consumed by: Tasks 6, 7, 11, 12.

- [ ] **Step 1: Write failing tests** — valid ruleset.yaml parses; unknown key rejected with path in message; rule manifest with both `pipeline` and `pipelineConfig` rejected; `pipeline.steps[].handler` accepted and `handlerType` inside `pipeline:` rejected; fn test manifest happy path; `walkSchemaRefs` finds and replaces a `schemaId` nested three levels deep and ignores a `schemaId` that is not a string.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): zod manifest schemas and schema-ref walker"`

---

### Task 6: Compiler — `buildRuleSet`

**Files:**
- Create: `packages/cli/src/compile/build.ts`, `packages/cli/test/build.test.ts`, synthetic fixture `packages/cli/test/fixtures/synthetic/basic/` (authored layout + `expected.json` pair — created in Step 1)

**Interfaces:**
- Produces:
  ```ts
  export interface BuildResult { export: RuleSetExport; warnings: string[]; secrets: string[]; skillRefs: string[] }
  export async function buildRuleSet(setDir: string, opts?: { exportedAt?: string }): Promise<BuildResult>
  ```
- Consumed by: Tasks 8, 11, 13. `opts.exportedAt` exists so tests and round-trip comparisons are deterministic; default `new Date().toISOString()`.

**Behavior spec (binding):**
1. `setDir` must contain `ruleset.yaml` (else throw `not a rule set (no ruleset.yaml): <dir>`).
2. Discover rules under `rules/`: files matching `(get|post|put|patch|delete|head|options|any).rule.yaml` (single-file shape) and directories `(get|post|…|any)/` containing `rule.yaml` (directory shape). Method = filename stem; `any` → no `method` key (manifest `methods:` allowed only in `any` rules — error otherwise).
3. `pathPattern` = manifest `pathPattern:` if set, else `relPathToPattern(dirSegments)` of the path between `rules/` and the method file/dir.
4. Duplicate `(pathPattern, method)` across the set → error listing both source files (mirrors the DB unique key).
5. `pipeline:` sugar → `pipelineConfig`: rename step `handler` → `handlerType`; a step `code:` value → read file relative to the manifest's directory, place as `config.code` (file missing → error `<manifest>: code file not found: <path>`); `pipeline.name` defaults to the joined route path (e.g. `api/feeds/remove POST`).
6. Generic `$file:` support: any string config value exactly matching `{ $file: <relpath> }` object form → replaced by the file's contents (utf8).
7. Schema refs: every value `$schema:<name>` under a `SCHEMA_REF_KEYS` key → resolved: read `schemas/<name>.schema.yaml`; uuid = its `id:` if present else uuidv5(name, namespace `6e1a24d0-0000-4000-8000-bffle55c0de0`) computed via `node:crypto` (implement RFC-4122 v5 inline — ~15 lines, no dependency); collect each referenced schema once into `schemas[]` as `{ id, name, fields }`. A `$schema:` ref with no manifest file → error. A raw UUID value is passed through untouched with a warning (`unresolved schema id <uuid> in <file>`).
8. Secrets: collect distinct `NAME`s from `{{secrets.NAME}}` occurrences in all string values → `secrets` (report only). `headerConfig.add` with any non-empty value → error (`secret values must not be committed; use empty-string placeholders`).
9. Skill refs: for every `ai_handler` step with `config.skills.mode === 'selected'`, collect `config.skills.enabled[]` names → `skillRefs` (validation against `.bffless/skills/` happens in Task 11, not here).
10. Apply `applyRuleDefaults`; assign `order` = manifest `order:` if set else `deriveOrders` position; assemble envelope; return `canonicalizeExport`'d result.

- [ ] **Step 1: Create the synthetic fixture** `test/fixtures/synthetic/basic/`: `ruleset.yaml` (name `basic`), three rules — `rules/api/items/get.rule.yaml` (simple pipeline with `data_query` step using `schemaId: $schema:items`), `rules/api/items/[...path]/any.rule.yaml` with `methods: [GET, HEAD]` and explicit `order: 5`, `rules/api/feeds/remove/post/` directory shape with `rule.yaml` + `pick.fn.js` (`function handler({ steps }) { return steps.query[0]; }`) — plus `schemas/items.schema.yaml` (with explicit `id:`), and the hand-written `expected.json` the build must produce (write it completely, using `exportedAt: "2026-07-11T00:00:00.000Z"`).
- [ ] **Step 2: Write failing tests** — (a) `buildRuleSet(basic, { exportedAt })` deep-equals `expected.json`; (b) missing code file → throws with path; (c) duplicate `(pathPattern, method)` → throws naming both files; (d) `$schema:` with no manifest → throws; (e) non-empty `headerConfig.add` value → throws; (f) secrets collected from a `{{secrets.API_KEY}}` occurrence; (g) uuidv5 is deterministic (same name → same id across two builds).
- [ ] **Step 3: Run — FAIL**
- [ ] **Step 4: Implement `build.ts`** per the 10-point spec
- [ ] **Step 5: Run — PASS**
- [ ] **Step 6: Commit** — `git commit -m "feat(cli): rule-set compiler (buildRuleSet)"`

---

### Task 7: Decompiler — `decompileExport` / `writeDecompiled`

**Files:**
- Create: `packages/cli/src/compile/decompile.ts`, `packages/cli/test/decompile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DecompileResult { files: Map<string, string>; warnings: string[] }  // relative path → content
  export function decompileExport(exp: RuleSetExport): DecompileResult
  export async function writeDecompiled(res: DecompileResult, outDir: string, opts?: { force?: boolean }): Promise<void>
  ```
- Consumed by: Tasks 8, 11, 13. `writeDecompiled` refuses a non-empty `outDir` without `force`.

**Behavior spec (binding):**
1. `ruleset.yaml` from `exp.ruleSet` (name, description?, environment?).
2. Per rule: segments = `patternToRelPath(pathPattern)`; when `null`, place under `rules/_custom/<slug>/` (slug = pattern with `/`→`-`, `*`→`_star_`, stripped to `[A-Za-z0-9._-]`) and write explicit `pathPattern:` in the manifest. Method filename from `method` (lowercased) or `any` when absent; `methods:` written into the manifest when present.
3. Directory shape iff the rule has ≥1 `function_handler` step; single-file shape otherwise.
4. Each `function_handler` step: `config.code` extracted to sibling `<step id or name, sanitized>.fn.js` (byte-verbatim, no trailing-newline normalization); manifest step gets `code: ./<file>` and the remaining `config` keys (if any) stay under `config:`.
5. Manifest uses the `pipeline:` sugar form (steps use `handler:`), applies `elideRuleDefaults`, elides `order:` when it equals the derived order (Task 4), and renders YAML with `yaml`'s block-literal style (`|`) for multiline strings.
6. Schemas: each `exp.schemas[]` entry → `schemas/<name>.schema.yaml` including its original `id:`; every config value under `SCHEMA_REF_KEYS` equal to a schema id → rewritten `$schema:<name>`. Ref UUIDs not found in `schemas[]` are left in place with a warning.
7. Two rules mapping to the same manifest path (can only happen via `_custom` slug collision) → suffix `-2`, `-3` with a warning.

- [ ] **Step 1: Write failing tests** — (a) decompiling Task 6's `expected.json` reproduces the `basic` synthetic layout file-for-file (compare the `files` map against the fixture directory contents — fn.js byte-identical, YAML parsed-equal); (b) inexpressible pattern lands in `_custom` with explicit `pathPattern:`; (c) `writeDecompiled` refuses non-empty dir without `force`; (d) unknown schema UUID produces warning and survives untouched.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `decompile.ts`**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): rule-set decompiler"`

---

### Task 8: Round-trip golden tests (the gate)

**Files:**
- Create: `packages/cli/test/roundtrip.test.ts`

**Interfaces:** consumes `decompileExport`, `writeDecompiled`, `buildRuleSet`, `exportsEquivalent` exactly as defined above. No new production code expected — this task exists to force fixes in Tasks 2–7 where reality disagrees.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decompileExport, writeDecompiled } from '../src/compile/decompile.js';
import { buildRuleSet } from '../src/compile/build.js';
import { exportsEquivalent } from '../src/format/canonical.js';
import type { RuleSetExport } from '../src/format/types.js';

const realDir = path.resolve('test/fixtures/real');

describe.each(readdirSync(realDir))('round-trip %s', (file) => {
  const original = JSON.parse(readFileSync(path.join(realDir, file), 'utf8')) as RuleSetExport;

  it('decompile → build reproduces the original export', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'bffless-rt-'));
    const dec = decompileExport(original);
    await writeDecompiled(dec, out, { force: true });
    const rebuilt = await buildRuleSet(out, { exportedAt: original.exportedAt });
    const cmp = exportsEquivalent(original, rebuilt.export);
    expect(cmp.diffs).toEqual([]);   // print the actual paths on failure
  });

  it('every function_handler code string is byte-identical after round-trip', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'bffless-rt-'));
    await writeDecompiled(decompileExport(original), out, { force: true });
    const rebuilt = await buildRuleSet(out, { exportedAt: original.exportedAt });
    const codes = (e: RuleSetExport) => e.rules.flatMap(r => (r.pipelineConfig?.steps ?? [])
      .filter(s => s.handlerType === 'function_handler').map(s => [r.pathPattern, r.method ?? '', s.name, s.config.code as string] as const))
      .sort((a, b) => (a[0]+a[1]+a[2]).localeCompare(b[0]+b[1]+b[2]));
    expect(codes(rebuilt.export)).toEqual(codes(original));
  });
});
```

- [ ] **Step 2: Run against all three real fixtures** — `pnpm build && pnpm vitest run test/roundtrip.test.ts`. Expect failures on first run; that is the point.
- [ ] **Step 3: Fix whatever the diffs reveal** in Tasks 2–7 modules (typical culprits: YAML multiline round-trip fidelity, elision asymmetries, step-key normalization, `_custom` handling for real patterns). Each fix goes in the module that owns the behavior, with a unit test added beside it there. Do NOT special-case fixture names.
- [ ] **Step 4: Run the full suite — everything PASSES** (`pnpm vitest run`)
- [ ] **Step 5: Commit** — `git commit -m "test(cli): round-trip golden tests over real reader/handoff/studio-blog exports"`

---

### Task 9: Sandbox lint — `validateHandlerSource` + ESLint preset

**Files:**
- Create: `packages/cli/src/lint/patterns.ts`, `packages/cli/src/lint/eslint-preset.ts`, `packages/cli/test/lint.test.ts`

**Interfaces:**
- Produces:
  - `patterns.ts`: `PROHIBITED_PATTERNS: Array<{ pattern: RegExp; message: string }>` — transcribed 1:1 from `apps/backend/src/pipelines/function-runner.service.ts:78-97` (13 entries: `eval(`, `new Function(`, `Function(`, `require(`, `import(`, `process.`, `global.`, `globalThis.`, `.__proto__`, `constructor[`, `constructor.`, `Buffer(`, `Buffer.`). The implementer MUST read that file and copy the regexes exactly — parity with the runtime is the whole point.
  - `validateHandlerSource(code: string): Array<{ line: number; column: number; message: string }>` — regex scan with line/col mapping, plus a syntax check (`new (await import('node:vm')).Script(wrapped)` using the same wrapper the backend uses: `(async function() { ${code}; if (typeof handler !== 'function') throw new Error('No handler function defined'); })`), plus an error when `function handler` / `const handler` is absent.
  - `eslint-preset.ts`: a flat-config array export whose single custom rule `bffless/no-sandbox-violations` reports every `validateHandlerSource` finding at its location. Files scope: `**/*.fn.js`.
- Consumed by: Task 11 (`rules validate`).

- [ ] **Step 1: Write failing tests** — one test per prohibited pattern (13 snippets, each flagged with correct line number); a clean real handler passes (pull one `config.code` out of the reader fixture in the test); missing `handler` function flagged; syntax error flagged with message; the ESLint preset shape is a valid flat config (`Array.isArray`, has `files` and `rules`).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): sandbox lint (validateHandlerSource + eslint preset)"`

---

### Task 10: vm test harness — `runHandler`

**Files:**
- Create: `packages/cli/src/harness/run-handler.ts`, `packages/cli/src/harness/utils.ts`, `packages/cli/test/harness.test.ts`

**Interfaces:**
- Produces (package export `bffless/harness`):
  ```ts
  export interface HandlerData { user?: unknown; request?: unknown; steps?: unknown; deployment?: unknown }
  export interface HandlerRun { result: unknown; logs: Array<{ level: 'log' | 'warn' | 'error'; message: string }> }
  export interface RunHandlerOptions { timeout?: number; signingSecret?: string }
  export async function runHandler(code: string, data?: HandlerData, opts?: RunHandlerOptions): Promise<HandlerRun>
  export async function runHandlerFile(file: string, data?: HandlerData, opts?: RunHandlerOptions): Promise<HandlerRun>
  ```
- **Parity contract:** the implementer MUST read `apps/backend/src/pipelines/function-runner.service.ts` (lines ~22-49, 144-176, 224, 243, 250-333, 341-350, 422-439) and mirror: the exact sandbox global allow-list (`Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, WeakMap, WeakSet, Promise, Symbol, BigInt, parseInt, parseFloat, isNaN, isFinite, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent` + captured `console`), deep-frozen `structuredClone` of the data, the `utils` bag (`sha256, hmacSha256, sign, verify, randomToken, randomUUID, base64urlEncode, base64urlDecode` — reimplemented in `utils.ts` on `node:crypto`; `sign`/`verify` keyed by `opts.signingSecret ?? 'bffless-harness-secret'`), log capture capped at 100 entries, timeout default 5000 clamped 1000–30000 enforced via both `vm` timeout and a reject timer, and the same invocation wrapper (`handler(data)` with `utils` spread into data).
- Consumed by: Task 12 (`rules test`) and consumer repos' Vitest suites.

- [ ] **Step 1: Write failing tests** — happy path (`function handler({ request }) { return request.body.x * 2 }`); `utils.sha256('abc')` returns the known hex digest `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `utils.sign`/`verify` round-trip and fail on tamper; `console.log` captured with level; data is frozen (mutation attempt throws in strict mode / silently no-ops — assert original unchanged); infinite loop with `timeout: 1000` rejects within ~2s; `process` and `require` are `undefined` inside the sandbox (a handler returning `typeof process` yields `'undefined'`); prohibited-source is NOT this module's job (no validation here — that's lint).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `utils.ts` then `run-handler.ts`** per the parity contract
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): vm handler test harness with sandbox parity"`

---

### Task 11: `rules validate` + config discovery

**Files:**
- Create: `packages/cli/src/config.ts`, `packages/cli/src/commands/validate.ts`, `packages/cli/test/config.test.ts`, `packages/cli/test/validate.test.ts`
- Create fixture: `packages/cli/test/fixtures/synthetic/broken/` (a set with: a zod-invalid manifest, a dangling `code:` ref, a `$schema:` with no manifest file, a `.fn.js` containing `process.env.X`, an `ai_handler` step referencing skill `does-not-exist` while a sibling `.bffless/skills/real-skill/` exists)

**Interfaces:**
- Produces:
  - `config.ts`: `findConfig(cwd): { path: string; config: BfflessConfig } | null` (walk up for `.bffless/config.json`), `BfflessConfig` zod: `{ apiUrl?: string; project?: string; ruleSets?: string[] }`; `resolveRuleSetDirs(cwd, args: string[]): string[]` — explicit dir args win; else config `ruleSets` globs (implement glob with `fs.glob` if available, else a minimal `*`-only matcher — the globs in use are simple); a resolved dir must contain `ruleset.yaml`.
  - `validate.ts`: `validateRuleSet(setDir): Promise<{ errors: Issue[]; warnings: Issue[] }>` where `Issue = { file: string; message: string; line?: number }`. Runs: zod manifest validation (all files), `buildRuleSet` in a try/catch (build errors become issues), `validateHandlerSource` over every `.fn.js`, and the §3.5 skills cross-ref: for each `skillRefs` name, require `.bffless/skills/<name>/` to exist as a sibling of the set's `.bffless/proxy-rules/` home — error if a skills root exists but the name doesn't, warning if no skills root exists at all. Exit contract: errors → nonzero.
- Consumed by: Task 13 (command wiring is Task 13; this task delivers the functions + tests).

- [ ] **Step 1: Write failing tests** — config walk-up finds nearest; no config + no args → helpful error; the `broken` fixture yields exactly the five expected issues (assert on message substrings + files); the `basic` fixture yields zero errors; skills cross-ref error vs warning branches.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): rules validate + .bffless/config.json discovery"`

---

### Task 12: `rules test` — declarative handler fixtures

**Files:**
- Create: `packages/cli/src/commands/test.ts`, `packages/cli/test/rules-test.test.ts`
- Extend fixture: add `pick.fn.test.yaml` next to `basic`'s `pick.fn.js`:
  ```yaml
  handler: ./pick.fn.js
  cases:
    - name: returns first query row
      data: { steps: { query: [{ id: 1, url: "https://a" }] } }
      expect: { result: { id: 1, url: "https://a" } }
    - name: throws on empty
      data: { steps: { query: [] } }
      expect: { throws: "Cannot read" }
  ```
  (and make `basic`'s `pick.fn.js` throw-compatible: `function handler({ steps }) { const r = steps.query[0]; return { id: r.id, url: r.url }; }`)

**Interfaces:**
- Produces: `runFnTests(setDir): Promise<{ passed: number; failed: Array<{ file: string; case: string; message: string }> }>` — discovers `**/*.fn.test.yaml` under `rules/`, parses with `FnTestManifest` (Task 5), executes each case through `runHandler` (Task 10); `expect.result` compared deep-equal, `expect.throws` is substring-of-error-message.
- Consumed by: Task 13.

- [ ] **Step 1: Write failing tests** — `basic` fixture: 2 passed, 0 failed; a deliberately-wrong expectation reports the case name and a diff-ish message; a test yaml referencing a missing handler file fails that file, not the whole run.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): rules test (declarative handler fixtures via vm harness)"`

---

### Task 13: CLI command wiring — `build`, `validate`, `test`, `pull --from-file`

**Files:**
- Create: `packages/cli/src/commands/build.ts`, `packages/cli/src/commands/pull.ts`
- Modify: `packages/cli/src/index.ts` (replace stub with real `rules` subcommands)
- Create: `packages/cli/test/cli.test.ts` (spawns the built bin against the synthetic fixtures)

**Interfaces (user-facing command contract):**
```
bffless rules build [dirs...]     [-o <file>]        # default output: <set>/dist/<name>.proxy-rules.json (+ dist/.gitignore "*")
bffless rules validate [dirs...]                     # exit 1 on errors; prints issues as <file>:<line> <message>
bffless rules test [dirs...]                         # exit 1 on failed cases
bffless rules pull --from-file <export.json> --decompile [-o <dir>] [--force]
                                                     # Phase 0: --from-file is REQUIRED; without it, error
                                                     # "live pull requires a server export endpoint (Phase 1)"
```
- `[dirs...]` resolution via `resolveRuleSetDirs` (Task 11). `build` prints the output path and a one-line summary (`N rules, M schemas, K secrets referenced`); `--dry-run`-style flags are Phase 1 scope — do not add.
- `pull` default `-o`: `.bffless/proxy-rules/<ruleSet.name>/` relative to cwd.

- [ ] **Step 1: Write failing CLI tests** — `rules build test/fixtures/synthetic/basic` creates `dist/basic.proxy-rules.json` + `dist/.gitignore` containing `*`, and the JSON deep-equals `expected.json` modulo `exportedAt`; `rules validate` on `broken` exits 1 and prints the dangling-code-ref path; `rules test` on `basic` exits 0; `rules pull` without `--from-file` exits 1 with the Phase 1 message; `rules pull --from-file expected.json --decompile -o <tmp>` recreates the layout and a follow-up `rules build <tmp>` round-trips.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement commands + wiring**
- [ ] **Step 4: Run full package suite — PASS** (`pnpm build && pnpm vitest run`)
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): wire rules build/validate/test/pull commands"`

---

### Task 14: README — layout spec + command reference

**Files:**
- Create: `packages/cli/README.md`

**Interfaces:** none produced; documents Tasks 1–13. Content requirements (all sections mandatory): what/why (2 paragraphs, link `docs/plans/proxy-rules-as-code.md` and issue #446); quickstart (`npx bffless rules pull --from-file … --decompile`, then `build`/`validate`/`test`); the directory layout with the annotated tree from the design doc §3.1 adjusted to what was actually built; the rule manifest reference (every key, the `pipeline:` sugar, `code:`/`$file:`/`$schema:`/`{{secrets.NAME}}` reference forms); the defaults/elision table verbatim from `defaults.ts`; route-derivation rules incl. `[...path]`, `[param]`, `_custom/` fallback and the `pathPattern:` escape hatch; ordering semantics (specificity sort, explicit `order:` wins); `runHandler` usage example for Vitest users; `*.fn.test.yaml` reference; the eslint preset usage (`import bffless from 'bffless/eslint'`); a "not yet" section (live `pull`/`push`/`diff` = Phase 1, per the design doc). No placeholder text anywhere.

- [ ] **Step 1: Write the README** per the content requirements
- [ ] **Step 2: Verify every command line in it actually runs** (copy-paste each against the synthetic fixture; fix drift)
- [ ] **Step 3: Commit** — `git commit -m "docs(cli): README with layout spec and command reference"`

---

### Task 15: Reader pilot — real-world round-trip in `bffless/apps`

**Files:**
- Create (in the OTHER repo, `/home/rico/bffless/repos/apps`, working tree only — **do NOT commit there**): `apps/reader/.bffless/proxy-rules/reader/**` via the CLI
- Create: `docs/plans/proxy-rules-cli-phase0-pilot.md` (in this repo — the pilot report)

**Interfaces:** consumes the finished CLI end-to-end. This is the Phase 0 exit criterion from the design doc (§6).

- [ ] **Step 1: Decompile reader's live export**

```bash
CLI=/home/rico/bffless/repos/.ce-worktrees/proxy-rules-cli/packages/cli/dist/index.js
cd /home/rico/bffless/repos/apps
node $CLI rules pull --from-file apps/reader/bffless/reader.proxy-rules.json --decompile -o apps/reader/.bffless/proxy-rules/reader
```
Expected: layout written; warnings (if any) captured for the report.

- [ ] **Step 2: Build it back and verify equivalence**

```bash
node $CLI rules build apps/reader/.bffless/proxy-rules/reader
```
Then compare `apps/reader/.bffless/proxy-rules/reader/dist/reader.proxy-rules.json` against the original with a Node one-liner using `exportsEquivalent` (import from the built CLI dist). Expected: zero diffs; 21 fn code strings byte-identical.

- [ ] **Step 3: Validate + lint the decompiled set**

```bash
node $CLI rules validate apps/reader/.bffless/proxy-rules/reader
```
Expected: 0 errors. Record warnings (e.g. skills-root-absent) verbatim.

- [ ] **Step 4: Write one real handler fixture test** — pick reader's simplest `function_handler` (inspect the decompiled tree), write a `*.fn.test.yaml` beside it with one meaningful case, run `node $CLI rules test …`, expect pass. This proves the harness against production handler code.

- [ ] **Step 5: Write the pilot report** `docs/plans/proxy-rules-cli-phase0-pilot.md`: what was run, tree listing of the decompiled layout (`find apps/reader/.bffless/proxy-rules/reader -type f | sort`), equivalence result, warnings, DX observations (file count, largest fn file, anything awkward in the YAML), and open items for Phase 1. Note explicitly that the apps working tree was left uncommitted for user review.

- [ ] **Step 6: Commit (ce repo only)** — `git add docs/plans/proxy-rules-cli-phase0-pilot.md && git commit -m "docs: phase 0 reader pilot report"`

---

## Self-Review Notes (writing-plans checklist)

- **Spec coverage:** design doc Phase 0 deliverables — layout spec (Tasks 4–7, README), `build`/`validate`/`test`/decompile-from-file (Tasks 6, 11, 12, 13), lint preset (9), vm harness (10), reader pilot round-trip (8, 15). §3.5 cross-ref check → Task 11. Q4 amendment → Task 1. Not in scope (per design doc phasing): server endpoints, live pull/push/diff, GitHub Action, TS handlers, watch mode.
- **Type consistency:** `BuildResult`/`DecompileResult`/`HandlerRun`/`Issue` signatures are defined once (Tasks 6, 7, 10, 11) and referenced verbatim by consumers (8, 12, 13, 15).
- **Known judgment calls delegated to the round-trip gate (Task 8):** YAML multiline fidelity, step-key ordering, elision asymmetries — deliberately allowed to surface as golden-test failures and be fixed in their owning modules rather than over-specified here.
