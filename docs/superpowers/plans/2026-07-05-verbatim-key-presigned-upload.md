# Verbatim-Key Presigned Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `keyStrategy: 'verbatim'` mode to the presigned-upload flow so an app can store an object at an exact, app-chosen path (the path *is* the key) instead of the default UUID-hashed key.

**Architecture:** The change is confined to key *construction*. `UploadRecordService.buildUploadKey` gains a `verbatimKey` branch that builds `{owner}/{repo}/uploads/{subDir}/{key}` verbatim — no UUID prefix, no character rewriting — with safety rejections. `PresignedUploadHandler` reads two new config fields (`keyStrategy`, `key`) and passes the resolved key through. `register_upload` needs **no code change**: `parseUploadKey` already tolerates a non-UUID leaf (the UUID-strip regex simply doesn't match), so a verbatim key round-trips through registration unchanged — Task 2 locks that with a characterization test. Serving is unaffected (`file_serve_handler` already serves by exact path).

**Tech Stack:** NestJS, TypeScript, Jest (`*.spec.ts` unit tests), Drizzle (not touched here). Storage adapters (S3/GCS/MinIO/Azure) mint the presigned URL.

## Global Constraints

- **Opt-in, zero behavior change by default.** `keyStrategy` defaults to `'uuid'`; every existing consumer (Studio, data-table attachments, AI generations) must be byte-for-byte unchanged. The `verbatimKey` branch runs only when explicitly requested.
- **Names preserved verbatim.** In verbatim mode, do NOT apply `replace(/[^a-zA-Z0-9._-]/g, '_')` or a UUID prefix — the stored key must byte-match the relative path a browser will later request.
- **Safety rejections (verbatim mode).** Reject a key that, after trimming leading/trailing `/`, is empty, contains `..`, contains `//` (empty segment), contains control chars (`\x00-\x1f`), or whose full storage key exceeds 1024 bytes. Rejections throw `ConfigurationError`.
- **Repo policy:** Per `repos/ce` rules, pause for explicit user approval before each `git commit` and before any push/PR. The commit steps below are the TDD rhythm; do not push without asking.
- Work happens in the worktree `/home/rico/bffless/repos/ce-wt-verbatim-key` on branch `feat/verbatim-key-presigned`. Run all commands from there.

---

### Task 1: `buildUploadKey` verbatim mode (core logic)

**Files:**
- Modify: `apps/backend/src/pipelines/upload-record.service.ts` (extend `buildUploadKey`, add private `buildVerbatimKey`)
- Test: `apps/backend/src/pipelines/upload-record.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildUploadKey(opts)` gains an optional `verbatimKey?: string` field. When present, returns `UploadKeyParts` whose `storageKey = {owner}/{repo}/uploads/{subDir}/{verbatimKey}` (slashes/space/unicode preserved), `publicPath = /api/uploads/{subDir}/{verbatimKey}`, and `storedFilename === sanitizedFilename ===` the last path segment. When absent, behavior is exactly as today.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `apps/backend/src/pipelines/upload-record.service.spec.ts` (reuse the existing `build()` helper — `buildUploadKey` is pure, no context needed):

```ts
describe('UploadRecordService.buildUploadKey — verbatim mode', () => {
  const build = () =>
    new UploadRecordService({} as PipelineDataService, new ExpressionEvaluator());
  const base = { owner: 'acme', repo: 'site', subDir: 'content', originalName: 'ignored.md' };

  it('stores the object at the exact path (no UUID, no sanitize)', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ ...base, verbatimKey: 'Design Docs/Q3 Handoff/doc.md' });
    expect(parts.storageKey).toBe('acme/site/uploads/content/Design Docs/Q3 Handoff/doc.md');
    expect(parts.publicPath).toBe('/api/uploads/content/Design Docs/Q3 Handoff/doc.md');
    expect(parts.storedFilename).toBe('doc.md');
    expect(parts.sanitizedFilename).toBe('doc.md');
  });

  it('preserves spaces and unicode in every segment', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ ...base, verbatimKey: 'Rapport Été/résumé final.md' });
    expect(parts.storageKey).toBe('acme/site/uploads/content/Rapport Été/résumé final.md');
  });

  it('trims leading/trailing slashes before building', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ ...base, verbatimKey: '/assets/logo.png/' });
    expect(parts.storageKey).toBe('acme/site/uploads/content/assets/logo.png');
  });

  it('rejects an empty key', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: '   ' })).toThrow(/empty/i);
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: '///' })).toThrow(/empty/i);
  });

  it('rejects ".." traversal', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: '../secrets/x' })).toThrow(/traversal|\.\./i);
  });

  it('rejects an empty path segment ("//")', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: 'a//b.png' })).toThrow(/segment|\/\//i);
  });

  it('rejects control characters', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: 'a/\u0001b.png' })).toThrow(/control/i);
  });

  it('rejects a key that pushes the storage key past 1024 bytes', () => {
    const svc = build();
    const huge = 'a/'.repeat(700) + 'x.png'; // > 1024 bytes with the prefix
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: huge })).toThrow(/1024|too long|length/i);
  });

  it('leaves UUID mode unchanged when verbatimKey is absent', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ owner: 'acme', repo: 'site', subDir: 'content', originalName: 'a b.png' });
    // UUID prefix + sanitized filename, as today.
    expect(parts.storageKey).toMatch(
      /^acme\/site\/uploads\/content\/[0-9a-f-]{36}-a_b\.png$/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend test -- upload-record.service`
Expected: the new `verbatim mode` tests FAIL (verbatimKey is ignored today, so `storageKey` still has a UUID); the existing `resolveSubDir` and the "UUID mode unchanged" test PASS.

- [ ] **Step 3: Implement the verbatim branch**

In `apps/backend/src/pipelines/upload-record.service.ts`, change the `buildUploadKey` signature and add an early branch, plus a private helper. Replace the current `buildUploadKey` method with:

```ts
  buildUploadKey(opts: {
    owner: string;
    repo: string;
    subDir: string;
    originalName: string;
    dateBucket?: boolean;
    /**
     * When set, store the object at exactly {owner}/{repo}/uploads/{subDir}/{verbatimKey}
     * — no UUID prefix, no character rewriting. The app-chosen path IS the key, so
     * relative asset references resolve by passthrough. Safety-checked below.
     */
    verbatimKey?: string;
  }): UploadKeyParts {
    if (opts.verbatimKey !== undefined) {
      return this.buildVerbatimKey(opts.owner, opts.repo, opts.subDir, opts.verbatimKey);
    }

    const uuid = randomUUID();
    const sanitizedFilename = opts.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

    let storageKey = `${opts.owner}/${opts.repo}/uploads/${opts.subDir}`;
    let subDirPath = opts.subDir;
    if (opts.dateBucket) {
      const dateSegment = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      storageKey += `/${dateSegment}`;
      subDirPath = `${opts.subDir}/${dateSegment}`;
    }

    const storedFilename = `${uuid}-${sanitizedFilename}`;
    storageKey += `/${storedFilename}`;
    const publicPath = `/api/uploads/${subDirPath}/${storedFilename}`;

    return { storageKey, storedFilename, sanitizedFilename, publicPath };
  }

  /**
   * Build a storage key where the app-supplied path is used verbatim (no UUID
   * prefix, no character rewriting), so relative references resolve by
   * passthrough. Rejects unsafe input rather than silently rewriting it — heavy
   * sanitization would break the very relative paths this mode exists to preserve.
   */
  private buildVerbatimKey(
    owner: string,
    repo: string,
    subDir: string,
    rawKey: string,
  ): UploadKeyParts {
    const key = (rawKey ?? '').replace(/^\/+|\/+$/g, '');
    if (!key) {
      throw new ConfigurationError('verbatim key resolved to empty', 'presigned_upload');
    }
    if (key.includes('..')) {
      throw new ConfigurationError(
        `verbatim key "${key}" contains ".." — path traversal is not allowed`,
        'presigned_upload',
      );
    }
    if (key.includes('//')) {
      throw new ConfigurationError(
        `verbatim key "${key}" contains an empty path segment ("//")`,
        'presigned_upload',
      );
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(key)) {
      throw new ConfigurationError(
        'verbatim key contains control characters',
        'presigned_upload',
      );
    }
    const storageKey = `${owner}/${repo}/uploads/${subDir}/${key}`;
    if (Buffer.byteLength(storageKey, 'utf8') > 1024) {
      throw new ConfigurationError(
        `verbatim storage key exceeds the 1024-byte limit (${Buffer.byteLength(storageKey, 'utf8')} bytes)`,
        'presigned_upload',
      );
    }
    const segments = key.split('/');
    const storedFilename = segments[segments.length - 1];
    const publicPath = `/api/uploads/${subDir}/${key}`;
    return { storageKey, storedFilename, sanitizedFilename: storedFilename, publicPath };
  }
```

(`ConfigurationError` and `randomUUID` are already imported in this file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend test -- upload-record.service`
Expected: PASS (all verbatim tests + the unchanged `resolveSubDir` / UUID-mode tests).

- [ ] **Step 5: Commit** (pause for user approval first)

```bash
git add apps/backend/src/pipelines/upload-record.service.ts apps/backend/src/pipelines/upload-record.service.spec.ts
git commit -m "feat(pipelines): verbatim key mode in buildUploadKey"
```

---

### Task 2: Lock verbatim-key round-trip through `parseUploadKey` (register path)

**Files:**
- Test: `apps/backend/src/pipelines/upload-record.service.spec.ts`
- Modify (only if the lock test fails): `apps/backend/src/pipelines/upload-record.service.ts` (`parseUploadKey`)

**Interfaces:**
- Consumes: `parseUploadKey(storageKey, owner, repo)` as it exists today.
- Produces: proof that `register_upload` accepts a verbatim key with no code change — `parseUploadKey` returns non-null, with `sanitizedFilename` = the leaf name (no UUID strip) and the correct `publicPath`.

- [ ] **Step 1: Write the characterization test**

Add to `upload-record.service.spec.ts`:

```ts
describe('UploadRecordService.parseUploadKey — verbatim keys round-trip', () => {
  const build = () =>
    new UploadRecordService({} as PipelineDataService, new ExpressionEvaluator());

  it('accepts a structural key and recovers the leaf name unchanged', () => {
    const svc = build();
    const parts = svc.parseUploadKey(
      'acme/site/uploads/content/Design Docs/Q3 Handoff/assets/foo.png',
      'acme',
      'site',
    );
    expect(parts).not.toBeNull();
    expect(parts!.sanitizedFilename).toBe('foo.png');
    expect(parts!.storedFilename).toBe('foo.png');
    expect(parts!.publicPath).toBe('/api/uploads/content/Design Docs/Q3 Handoff/assets/foo.png');
  });

  it('still rejects traversal and cross-project keys', () => {
    const svc = build();
    expect(svc.parseUploadKey('acme/site/uploads/../x', 'acme', 'site')).toBeNull();
    expect(svc.parseUploadKey('other/site/uploads/content/x.png', 'acme', 'site')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend test -- upload-record.service`
Expected: **PASS immediately** — the UUID-strip regex in `parseUploadKey` does not match `foo.png`, so the leaf survives, and the `..`/prefix guards already reject the unsafe cases. This confirms `register_upload` needs no change.

- [ ] **Step 3: (Only if Step 2 failed) fix `parseUploadKey`**

If any assertion failed, the most likely cause is the `//`/`..` guard interacting with a legitimate key — adjust the guard so it rejects traversal/empty-segment but accepts spaces/unicode, then re-run. If Step 2 passed, skip this step (no code change).

- [ ] **Step 4: Commit** (pause for user approval first)

```bash
git add apps/backend/src/pipelines/upload-record.service.spec.ts
git commit -m "test(pipelines): lock verbatim key round-trip through parseUploadKey"
```

---

### Task 3: Wire `keyStrategy` / `key` into the presigned-upload handler (+ MCP docs)

**Files:**
- Modify: `apps/backend/src/pipelines/handlers/presigned-upload.handler.ts` (config interface + `execute`)
- Modify: `apps/backend/src/mcp/tools/proxy-rules.tools.ts` (presigned_upload description string)
- Test: `apps/backend/src/pipelines/handlers/presigned-upload.handler.spec.ts` (new)

**Interfaces:**
- Consumes: `UploadRecordService.buildUploadKey({ ..., verbatimKey })` from Task 1.
- Produces: `PresignedUploadHandlerConfig` gains `keyStrategy?: 'uuid' | 'verbatim'` (default `'uuid'`) and `key?: string` (expression, default `'request.body.path'`, used only in verbatim mode). In verbatim mode the handler mints the presigned PUT to the verbatim key and echoes it back as `storageKey`/`publicPath`.

- [ ] **Step 1: Write the failing handler test**

Create `apps/backend/src/pipelines/handlers/presigned-upload.handler.spec.ts`:

```ts
import { PresignedUploadHandler } from './presigned-upload.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { UploadRecordService } from '../upload-record.service';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineDataService } from '../pipeline-data.service';

// Minimal registry stub — the handler only calls registry.register(this) in its ctor.
const registry = { register: () => {} } as any;

// Storage adapter that supports presigned URLs and echoes the key it was asked to sign.
const storageAdapter = {
  supportsPresignedUrls: () => true,
  getPresignedUploadUrl: async (key: string) => `https://bucket.example/${encodeURI(key)}?sig=x`,
} as any;

const buildHandler = () => {
  const evaluator = new ExpressionEvaluator();
  const uploadRecords = new UploadRecordService({} as PipelineDataService, evaluator);
  return new PresignedUploadHandler(registry, evaluator, uploadRecords, storageAdapter);
};

// owner/repo come from deployment context so resolveOwnerRepo never touches the DB.
const contextWith = (body: Record<string, unknown>): PipelineContext =>
  ({
    projectId: 'p1',
    deployment: { owner: 'acme', repo: 'site' },
    metadata: { body },
    stepOutputs: {},
  } as unknown as PipelineContext);

const step = (config: Record<string, unknown>): PipelineStep =>
  ({ name: 'presigned', handlerType: 'presigned_upload', config } as unknown as PipelineStep);

describe('PresignedUploadHandler — verbatim mode', () => {
  it('mints a presigned URL for the exact app-chosen key', async () => {
    const handler = buildHandler();
    const res: StepResult = await handler.execute(
      contextWith({ path: 'Design Docs/doc.md' }),
      step({ subDir: 'content', keyStrategy: 'verbatim', key: 'request.body.path' }),
    );
    expect(res.success).toBe(true);
    expect(res.output!.storageKey).toBe('acme/site/uploads/content/Design Docs/doc.md');
    expect(res.output!.publicPath).toBe('/api/uploads/content/Design Docs/doc.md');
    expect(String(res.output!.uploadUrl)).toContain('acme/site/uploads/content/Design%20Docs/doc.md');
  });

  it('errors when the key expression resolves to nothing', async () => {
    const handler = buildHandler();
    const res = await handler.execute(
      contextWith({}),
      step({ subDir: 'content', keyStrategy: 'verbatim', key: 'request.body.path' }),
    );
    expect(res.success).toBe(false);
    expect(res.error!.code).toBe('MISSING_KEY');
  });

  it('is unchanged in default (uuid) mode', async () => {
    const handler = buildHandler();
    const res = await handler.execute(
      contextWith({ filename: 'a b.png' }),
      step({ subDir: 'content' }),
    );
    expect(res.success).toBe(true);
    expect(res.output!.storageKey).toMatch(
      /^acme\/site\/uploads\/content\/[0-9a-f-]{36}-a_b\.png$/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend test -- presigned-upload.handler`
Expected: the two verbatim tests FAIL (config is ignored → still UUID key / no MISSING_KEY); the "uuid mode" test PASSES.

- [ ] **Step 3: Add the config fields**

In `presigned-upload.handler.ts`, extend `PresignedUploadHandlerConfig` (add after `filename`):

```ts
  /**
   * Key construction strategy.
   * - 'uuid' (default): {subDir}/{uuid}-{sanitizedFilename} — collision-safe, opaque.
   * - 'verbatim': store at the exact app-chosen sub-path (see `key`), so relative
   *   asset references resolve by passthrough. No UUID prefix, no char rewriting.
   * @default 'uuid'
   */
  keyStrategy?: 'uuid' | 'verbatim';

  /**
   * Expression resolving to the sub-path under `subDir` for verbatim mode
   * (e.g. "Design Docs/doc.md"). Required when keyStrategy is 'verbatim'.
   * @default "request.body.path"
   */
  key?: string;
```

- [ ] **Step 4: Branch `execute` on the strategy**

In `presigned-upload.handler.ts`, replace the filename-resolution block (from `const filenameExpr = ...` down to the end of the `MISSING_FILENAME` guard) with:

```ts
    const keyStrategy = config.keyStrategy ?? 'uuid';

    // Verbatim mode: resolve the app-chosen sub-path.
    let verbatimKey: string | undefined;
    if (keyStrategy === 'verbatim') {
      const keyExpr = config.key || 'request.body.path';
      const resolvedKey = this.expressionEvaluator.evaluateExpression(keyExpr, context, stepName);
      if (!resolvedKey || typeof resolvedKey !== 'string') {
        return {
          success: false,
          error: {
            code: 'MISSING_KEY',
            message: `key expression "${keyExpr}" resolved to ${
              resolvedKey === null ? 'null' : typeof resolvedKey
            }, expected a path string for verbatim keyStrategy`,
          },
        };
      }
      verbatimKey = resolvedKey;
    }

    // Resolve the display filename. In verbatim mode it is optional — fall back
    // to the key's last segment; in uuid mode it is still required.
    const filenameExpr = config.filename || 'request.body.filename';
    let originalName = this.expressionEvaluator.evaluateExpression(filenameExpr, context, stepName);
    if (!originalName || typeof originalName !== 'string') {
      if (verbatimKey) {
        const segs = verbatimKey.replace(/^\/+|\/+$/g, '').split('/');
        originalName = segs[segs.length - 1];
      } else {
        return {
          success: false,
          error: {
            code: 'MISSING_FILENAME',
            message: `filename expression "${filenameExpr}" resolved to ${
              originalName === null ? 'null' : typeof originalName
            }, expected a filename string`,
          },
        };
      }
    }
```

Then update the `buildUploadKey` call (a few lines below) to pass the verbatim key:

```ts
    const keyParts = this.uploadRecords.buildUploadKey({
      owner,
      repo,
      subDir,
      originalName,
      dateBucket: config.dateBucket,
      verbatimKey,
    });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend test -- presigned-upload.handler`
Expected: PASS (all three tests).

- [ ] **Step 6: Update the MCP doc string**

In `apps/backend/src/mcp/tools/proxy-rules.tools.ts`, in the `presigned_upload:` description line, append after the `filename?:` clause:

```
keyStrategy?: "uuid"|"verbatim" (default "uuid"), key?: "expression for the exact sub-path under subDir when keyStrategy is verbatim (default request.body.path) — stored VERBATIM (no uuid prefix, no char rewriting) so relative asset paths resolve by passthrough; rejects '..', '//', empty, control chars, and keys over 1024 bytes",
```

(Keep it inside the existing brace list for `presigned_upload`, consistent with the surrounding style.)

- [ ] **Step 7: Commit** (pause for user approval first)

```bash
git add apps/backend/src/pipelines/handlers/presigned-upload.handler.ts apps/backend/src/pipelines/handlers/presigned-upload.handler.spec.ts apps/backend/src/mcp/tools/proxy-rules.tools.ts
git commit -m "feat(pipelines): verbatim keyStrategy for presigned_upload"
```

---

### Task 4: Full verification + open PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full pipelines test suite**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend test -- pipelines`
Expected: PASS with no regressions (all handler + service specs green).

- [ ] **Step 2: Typecheck / build the backend**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend build`
Expected: builds cleanly (no TS errors from the new optional fields).

- [ ] **Step 3: Lint the touched files**

Run: `cd /home/rico/bffless/repos/ce-wt-verbatim-key && pnpm --filter backend lint`
Expected: no new lint errors (note the `no-control-regex` disable comment is intentional).

- [ ] **Step 4: Push branch + open PR** (pause for user approval first)

```bash
git push -u origin feat/verbatim-key-presigned
gh pr create --repo bffless/ce --title "feat(pipelines): verbatim keyStrategy for presigned uploads" --body "Adds an opt-in keyStrategy: 'verbatim' to presigned_upload so an app can store an object at an exact, app-chosen path (the path IS the key) instead of the default UUID-hashed key. Default 'uuid' — no behavior change for existing consumers. Enables Handoff's structural content storage (relative asset paths resolve by passthrough). See apps/handoff spec 2026-07-05-structural-content-storage. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Release ships via release-please on merge (a `feat:` commit bumps the minor). The Handoff app work is gated on that release landing on the deployed CE.

---

## Notes for the app follow-up (not this plan)

Once this CE change is released, the app side proceeds via `/to-prd` → `/to-issues` (see `apps/handoff/docs/superpowers/specs/2026-07-05-structural-content-storage-design.md`):
- `handoff.proxy-rules.json`: `presigned_upload` step gets `keyStrategy: 'verbatim'`, `key: 'request.body.path'`, `subDir: 'content'`; client sends the folder-path + filename.
- Retire the Site `manifest` + `/api/sites/*`; serve everything through `GET /api/uploads/content/<path>`.
- Viewer renders Markdown in an iframe with `<base href>`.
