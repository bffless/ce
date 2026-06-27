# Proxy rules: match multiple HTTP methods — design

**Date:** 2026-06-27
**Repo:** `repos/ce` (Community Edition)
**Origin:** A proxy rule can match only a single HTTP `method` (or null = any). We hit this building the handoff `/r/{fileId}?token=` raw-file redirect (bffless/apps): a `GET`-only rule lets a **HEAD** request fall through to the SPA fallback (`200 text/html`) instead of mirroring the `302`. The clean fix is letting one rule match a **set** of methods (e.g. `["GET","HEAD"]`) rather than duplicating rules or using over-broad "any".

## Goal

Let a proxy rule match a configurable set of HTTP methods, backward-compatibly. After this, a rule can specify `methods: ["GET","HEAD"]` and match exactly those; existing single-`method` (and null-`method` = any) rules keep working unchanged.

## Key decision: additive, zero-breaking-change

Add a nullable `methods: string[]` column **alongside** the existing `method`. No data migration of existing rows, no breaking API/response change. Match precedence: `methods[]` (when non-empty) → else single `method` → else any. (Chosen over replacing `method` with `methods[]`, which would be a breaking API change + a row migration.)

## Non-goals

- Removing or renaming the single `method` field (kept for back-compat).
- Per-method *behavior* (different pipelines per method in one rule) — a rule still has one pipeline; `methods[]` only widens *matching*.
- Method-aware uniqueness reform — the existing unique index stays (see Data model).
- Changing the handoff `/r` rule itself — that's a follow-up in `repos/apps` after this ships (see Follow-up).

## Background (current state, from CE source)

- **Schema** `apps/backend/src/db/schema/proxy-rules.schema.ts:182` — `method: varchar('method', { length: 10 })` (nullable; null = any). Unique index `proxy_rules_rule_set_path_method_unique` on `(ruleSetId, pathPattern, method)` (line ~350).
- **Matcher** `apps/backend/src/proxy-rules/proxy.middleware.ts:~1041` (`findMatchingRule`):
  ```ts
  if (rule.method && requestMethod && rule.method.toUpperCase() !== requestMethod) continue;
  ```
- **DTOs** `dto/create-proxy-rule.dto.ts:~373` — `@IsIn([...7 methods]) method?: string`. `update` extends create. **`dto/proxy-rule-response.dto.ts` omits `method` entirely** (a pre-existing bug — the frontend `proxyRulesApi.ts` expects it).
- **Service** `proxy-rules.service.ts` create (`method: dto.method ?? null`, line ~249), dedupe key (line ~150 `${rule.pathPattern}:${rule.method ?? ''}`), uniqueness via `findRuleByPattern`. `proxy-rule-sets.service.ts` `copy` (line ~234) and `importRuleSet` (line ~375) carry `method`.
- **MCP** `apps/backend/src/mcp/tools/proxy-rules.tools.ts:~224` — `method: z.enum([...]).optional()`. (This is the surface the `j5s-dev` MCP exposes.)
- **Admin UI** `apps/frontend/src/components/proxy-rules/ProxyRuleForm.tsx:~243` — single-select `<Select>` of ANY/GET/POST/PUT/PATCH/DELETE (missing HEAD/OPTIONS). Types in `apps/frontend/src/services/proxyRulesApi.ts:51,54`.

## Design

### 1. Schema + migration
Add to `proxyRules`:
```ts
methods: jsonb('methods').$type<string[]>(),  // null/[] = fall back to `method`/any
```
Keep `method` and the existing unique index unchanged. `methods[]`-only rules store `method = null`, and Postgres already treats null-`method` rows as distinct in that index, so no new collisions. **Migration is interactive** (Drizzle): the implementer cannot run `db:generate`; the user runs `cd apps/backend && pnpm db:generate` (name `add-proxy-rule-methods`), reviews the `ADD COLUMN methods jsonb`, then `pnpm db:migrate`.

### 2. Matcher (core behavioral change)
In `findMatchingRule`, replace the single-method check with precedence logic:
```ts
const ruleMethods =
  rule.methods && rule.methods.length ? rule.methods
  : rule.method ? [rule.method]
  : null;
if (ruleMethods && requestMethod && !ruleMethods.some((m) => m.toUpperCase() === requestMethod)) {
  continue;
}
```
`null` (no `methods`, no `method`) = match any. Case-insensitive. This is the one place behavior changes.

### 3. DTOs (+ response-bug fix)
- `create-proxy-rule.dto.ts`: add
  ```ts
  @IsOptional() @IsArray() @IsIn(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'], { each: true })
  methods?: string[];
  ```
  Keep `method`. (Both may be sent; `methods` is preferred at match time.)
- `update-proxy-rule.dto.ts`: unchanged (inherits).
- `proxy-rule-response.dto.ts`: **add both `method` and `methods`** (fixes the missing-`method` gap the frontend already relies on).

### 4. Service + import/export
- `proxy-rules.service.ts`: `create`/`update` persist `methods: dto.methods ?? null` alongside `method`. Extend the dedupe key to include methods, e.g. `${rule.pathPattern}:${rule.method ?? ''}:${(rule.methods ?? []).join(',')}`. Leave `findRuleByPattern`/the single-method uniqueness as-is (methods[] rules don't trip it).
- `proxy-rule-sets.service.ts`: `copy` (line ~234) and `importRuleSet` (line ~375) carry `methods: rule.methods ?? null` so export/import round-trips it. The import DTO (`CreateProxyRuleInSetDto`) gains `methods` the same way create does.

### 5. MCP tool
`proxy-rules.tools.ts` create (and update) gain:
```ts
methods: z.array(z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])).optional()
  .describe('HTTP methods to match (alternative to `method`; omit both for any)')
```

### 6. Admin UI
`ProxyRuleForm.tsx`: replace the single Method `<Select>` with a **multi-select** (checkbox group or multi-select) over GET/POST/PUT/PATCH/DELETE/**HEAD**/**OPTIONS**; empty selection = Any. Initialize from `initialData.methods ?? (initialData.method ? [initialData.method] : [])`; submit `methods` (and `method: undefined`). An edited legacy single-method rule re-saves as a one-element `methods[]` — acceptable. Update `proxyRulesApi.ts` types (`ProxyRule.methods?: HttpMethod[]`, create/update DTOs).

## Data flow

```
Request → proxy.middleware findMatchingRule:
  ruleMethods = rule.methods?.length ? rule.methods : rule.method ? [rule.method] : null
  match path, then: ruleMethods == null (any) OR req.method ∈ ruleMethods  → use rule
Create/import/copy/MCP → persist methods[] (and method) → response DTO returns both
Admin UI multi-select → methods[] (empty = any)
```

## Error handling / edge cases

- Invalid method strings in `methods[]` → rejected by `@IsIn(..., { each: true })` (400).
- Both `method` and `methods` set → `methods` wins at match time (documented); both stored/returned.
- Empty `methods: []` → treated as "fall back to `method`/any" (same as null) — the matcher's `.length` check handles it.
- Legacy rows (no `methods`) → behave exactly as before.

## Testing

- **Matcher unit tests (new — none exist today):** path+method matrix — `methods:["GET","HEAD"]` matches GET and HEAD, rejects POST; single `method:"GET"` still matches GET only; null both = matches any; case-insensitivity; first-match-by-order preserved. Extract/expose `findMatchingRule` or test via the middleware's public entry as the existing tests do.
- **DTO validation tests:** `methods` accepts a valid subset, rejects an unknown verb.
- **Service round-trip:** create with `methods` → fetch returns it; export → import preserves `methods`.
- **Response DTO:** includes `method` and `methods` (guards the bug fix).
- **Frontend:** the form renders a multi-select and submits `methods[]` (light test or manual).
- Run `pnpm test` / relevant suites per `repos/ce/CLAUDE.md`.

## Follow-up (separate, after this ships + deploys)

In `repos/apps`, change the handoff `/r/*` rule from `method: "GET"` to `methods: ["GET","HEAD"]` (the `handoff.proxy-rules.json` source + the live rule via the now-`methods`-aware MCP), and update its structural test. This closes the HEAD-hits-SPA wart properly. Not part of this CE PR.

## Files touched (all in `repos/ce`)

| File | Change |
| --- | --- |
| `apps/backend/src/db/schema/proxy-rules.schema.ts` | add `methods` jsonb column |
| `apps/backend/drizzle/*` (generated) | migration `add-proxy-rule-methods` (user runs `db:generate`) |
| `apps/backend/src/proxy-rules/proxy.middleware.ts` | `findMatchingRule` precedence logic |
| `apps/backend/src/proxy-rules/dto/create-proxy-rule.dto.ts` | add `methods?: string[]` |
| `apps/backend/src/proxy-rules/dto/proxy-rule-response.dto.ts` | add `method` (bug fix) + `methods` |
| `apps/backend/src/proxy-rules/dto/import-proxy-rule-set.dto.ts` | `CreateProxyRuleInSetDto` gains `methods` |
| `apps/backend/src/proxy-rules/proxy-rules.service.ts` | persist `methods`; dedupe key |
| `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts` | `copy` + `importRuleSet` carry `methods` |
| `apps/backend/src/mcp/tools/proxy-rules.tools.ts` | `methods` param on create/update |
| `apps/frontend/src/components/proxy-rules/ProxyRuleForm.tsx` | multi-select + HEAD/OPTIONS |
| `apps/frontend/src/services/proxyRulesApi.ts` | `methods` in types/DTOs |
| backend test files | matcher + DTO + round-trip tests |

## Acceptance criteria

- [ ] A rule with `methods: ["GET","HEAD"]` matches GET and HEAD, not POST.
- [ ] Existing single-`method` rules and null-`method` (any) rules behave exactly as before.
- [ ] `methods` round-trips through create, update, response, copy, and export/import.
- [ ] The proxy-rule response now includes `method` (and `methods`) — bug fixed.
- [ ] MCP `create_proxy_rule`/`update` accept `methods[]`.
- [ ] Admin UI offers multi-select including HEAD/OPTIONS; empty = any.
- [ ] Matcher has unit-test coverage for the method-matching matrix.
- [ ] Additive migration only (`ADD COLUMN`); no row migration; no breaking API change.
