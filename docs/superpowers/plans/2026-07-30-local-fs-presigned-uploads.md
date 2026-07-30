# Local-FS Presigned Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `LocalStorageAdapter` support presigned uploads, so the presigned prepare → direct PUT → register flow works on a stock local-filesystem CE install instead of failing with `PRESIGNED_NOT_SUPPORTED`.

**Architecture:** The adapter mints a same-origin URL carrying an HMAC-signed `key`/`exp`/`max` triple. A new local-only controller verifies that signature and **streams** the request body to a temp file, then atomically renames it into place. No session is consulted — authorization is the signature, which is what "presigned" means.

**Tech Stack:** NestJS 10 (Express platform), TypeScript, Jest, `node:crypto`, `node:fs`, `node:stream`.

**Spec:** `docs/superpowers/specs/2026-07-30-local-fs-presigned-uploads-design.md`

## Global Constraints

- **Streaming is mandatory, not an optimization.** The backend runs with `--max-old-space-size=128`. Never buffer a request body. Write via a piped stream to a temp file, then rename.
- **No new *required* configuration.** The signing key derives from the existing, required `ENCRYPTION_KEY`. Every new env var must have a working default or be optional.
- **Signing key derivation must mirror the existing precedent** in `pipelines/function-runner.service.ts:126-137`: `sha256(base | '<domain-label>')` where `base` is a dedicated env var, else `ENCRYPTION_KEY`, else a dev fallback.
- **Route:** `PUT /api/storage/presigned/local`. Controllers spell out the `api/` prefix themselves — there is **no** `setGlobalPrefix` in `main.ts`. Do not use `@Controller('api/storage')`; that prefix is already taken by `storage-usage.controller.ts:13`.
- **Never leave a partial object at the target key.** Temp file plus atomic rename, always.
- **Do not reuse `LocalStorageAdapter`'s existing `baseUrl`** (`local.adapter.ts:26-28`). It defaults to `http://localhost:3000/files` and carries a standing `@TODO` doubting it is used at all. Add a separate, explicitly resolved `publicOrigin`.
- **`max` is a server-side ceiling, not caller input.** `IStorageAdapter.getPresignedUploadUrl?(key, expiresIn?)` has no size parameter and the pipeline handler passes only those two (`pipelines/handlers/presigned-upload.handler.ts:183-186`). Do not widen the interface.
- **Feature flag:** `ENABLE_LOCAL_PRESIGNED_UPLOADS`, env key `FEATURE_LOCAL_PRESIGNED_UPLOADS`, `defaultValue: true`, `type: 'boolean'`, `category: 'features'`, `exposeToClient: true`.
- **Tests are Jest**, colocated as `*.spec.ts`. Run from `apps/backend` with `pnpm test -- <pattern>`.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`, `fix:`, `docs:`, `chore:`).

---

### Task 1: Presign signing utilities

Pure functions, no NestJS, no I/O. Everything else builds on these.

**Files:**
- Create: `apps/backend/src/storage/presign.util.ts`
- Test: `apps/backend/src/storage/presign.util.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `derivePresignKey(env?: NodeJS.ProcessEnv): Buffer`
  - `resolvePublicOrigin(env?: NodeJS.ProcessEnv): string` — throws `Error` when unresolvable
  - `interface LocalPresignParams { key: string; exp: number; max: number }`
  - `signLocalUpload(params: LocalPresignParams, presignKey: Buffer): string` — hex HMAC
  - `verifyLocalUpload(params: LocalPresignParams, sig: string, presignKey: Buffer): boolean` — timing-safe
  - `const PRESIGN_DOMAIN_LABEL = 'local-presign-v1'`
  - `const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600`
  - `const MAX_EXPIRES_IN_SECONDS = 3600`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/storage/presign.util.spec.ts`:

```typescript
import {
  derivePresignKey,
  resolvePublicOrigin,
  signLocalUpload,
  verifyLocalUpload,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_EXPIRES_IN_SECONDS,
} from './presign.util';

describe('derivePresignKey', () => {
  it('prefers LOCAL_PRESIGN_SECRET over ENCRYPTION_KEY', () => {
    const a = derivePresignKey({ LOCAL_PRESIGN_SECRET: 'aaa', ENCRYPTION_KEY: 'bbb' });
    const b = derivePresignKey({ ENCRYPTION_KEY: 'bbb' });
    expect(a.equals(b)).toBe(false);
  });

  it('derives deterministically from ENCRYPTION_KEY so signatures survive restarts', () => {
    const a = derivePresignKey({ ENCRYPTION_KEY: 'stable-key' });
    const b = derivePresignKey({ ENCRYPTION_KEY: 'stable-key' });
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
  });

  it('is domain-separated from the pipeline signing key', () => {
    // function-runner derives sha256(`${base}|pipeline-fn-sign`); ours must differ.
    const ours = derivePresignKey({ ENCRYPTION_KEY: 'k' });
    const theirs = require('crypto')
      .createHash('sha256')
      .update('k|pipeline-fn-sign')
      .digest();
    expect(ours.equals(theirs)).toBe(false);
  });
});

describe('resolvePublicOrigin', () => {
  it('uses PUBLIC_ORIGIN when set, stripping a trailing slash', () => {
    expect(resolvePublicOrigin({ PUBLIC_ORIGIN: 'https://a.example/' })).toBe('https://a.example');
  });

  it('falls back to https://PRIMARY_DOMAIN', () => {
    expect(resolvePublicOrigin({ PRIMARY_DOMAIN: 'b.example' })).toBe('https://b.example');
  });

  it('throws rather than inventing a localhost origin', () => {
    expect(() => resolvePublicOrigin({})).toThrow(/PUBLIC_ORIGIN|PRIMARY_DOMAIN/);
  });
});

describe('signLocalUpload / verifyLocalUpload', () => {
  const presignKey = derivePresignKey({ ENCRYPTION_KEY: 'test' });
  const params = { key: 'o/r/uploads/content/abc', exp: 1_800_000_000, max: DEFAULT_MAX_UPLOAD_BYTES };

  it('round-trips a valid signature', () => {
    expect(verifyLocalUpload(params, signLocalUpload(params, presignKey), presignKey)).toBe(true);
  });

  it('rejects a tampered key', () => {
    const sig = signLocalUpload(params, presignKey);
    expect(verifyLocalUpload({ ...params, key: 'o/r/uploads/content/EVIL' }, sig, presignKey)).toBe(false);
  });

  it('rejects a tampered exp', () => {
    const sig = signLocalUpload(params, presignKey);
    expect(verifyLocalUpload({ ...params, exp: params.exp + 86_400 }, sig, presignKey)).toBe(false);
  });

  it('rejects a tampered max, so a client cannot raise its own size cap', () => {
    const sig = signLocalUpload(params, presignKey);
    expect(verifyLocalUpload({ ...params, max: params.max * 10 }, sig, presignKey)).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    const other = derivePresignKey({ ENCRYPTION_KEY: 'different' });
    expect(verifyLocalUpload(params, signLocalUpload(params, other), presignKey)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyLocalUpload(params, 'not-hex', presignKey)).toBe(false);
    expect(verifyLocalUpload(params, '', presignKey)).toBe(false);
  });
});

describe('constants', () => {
  it('caps expiry at one hour, matching the other adapters', () => {
    expect(MAX_EXPIRES_IN_SECONDS).toBe(3600);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && pnpm test -- presign.util`
Expected: FAIL — `Cannot find module './presign.util'`

- [ ] **Step 3: Implement the utilities**

Create `apps/backend/src/storage/presign.util.ts`:

```typescript
import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Domain-separation label. Distinct from function-runner's 'pipeline-fn-sign'. */
export const PRESIGN_DOMAIN_LABEL = 'local-presign-v1';

/** Default per-upload size ceiling (100 MB), matching nginx's client_max_body_size. */
export const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600;

/** Expiry ceiling in seconds. Matches the 3600 default of the bucket adapters. */
export const MAX_EXPIRES_IN_SECONDS = 3600;

export interface LocalPresignParams {
  key: string;
  exp: number;
  max: number;
}

/**
 * Derive the presign key. Mirrors function-runner.service.ts:126-137 — a
 * dedicated env var when set, otherwise the required, stable ENCRYPTION_KEY, so
 * signatures survive restarts with no extra configuration.
 */
export function derivePresignKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const base =
    env.LOCAL_PRESIGN_SECRET || env.ENCRYPTION_KEY || 'bffless-local-presign-dev-secret';
  return createHash('sha256').update(`${base}|${PRESIGN_DOMAIN_LABEL}`).digest();
}

/**
 * Resolve the origin presigned URLs are minted against.
 *
 * Throws when it cannot be resolved. That is deliberate: silently defaulting to
 * localhost would mint unusable URLs that look like a broken client rather than
 * a misconfigured server (see the adapter's vestigial `baseUrl`).
 */
export function resolvePublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PUBLIC_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const domain = env.PRIMARY_DOMAIN?.trim();
  if (domain) return `https://${domain.replace(/\/+$/, '')}`;

  throw new Error(
    'Cannot resolve a public origin for presigned local uploads: set PUBLIC_ORIGIN or PRIMARY_DOMAIN.',
  );
}

function canonicalString({ key, exp, max }: LocalPresignParams): string {
  return `${key}|${exp}|${max}`;
}

export function signLocalUpload(params: LocalPresignParams, presignKey: Buffer): string {
  return createHmac('sha256', presignKey).update(canonicalString(params)).digest('hex');
}

export function verifyLocalUpload(
  params: LocalPresignParams,
  sig: string,
  presignKey: Buffer,
): boolean {
  const expected = signLocalUpload(params, presignKey);
  // timingSafeEqual throws on length mismatch, so guard before comparing.
  if (typeof sig !== 'string' || sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && pnpm test -- presign.util`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/storage/presign.util.ts apps/backend/src/storage/presign.util.spec.ts
git commit -m "feat(storage): add HMAC signing utilities for local presigned uploads"
```

---

### Task 2: Mint presigned URLs from `LocalStorageAdapter`

**Files:**
- Modify: `apps/backend/src/storage/local.adapter.ts:20-34` (constructor + fields), `:198` (`supportsPresignedUrls`)
- Modify: `apps/backend/src/storage/local.adapter.spec.ts` (append a describe block)

**Interfaces:**
- Consumes: `derivePresignKey`, `resolvePublicOrigin`, `signLocalUpload`, `DEFAULT_MAX_UPLOAD_BYTES`, `MAX_EXPIRES_IN_SECONDS` from Task 1.
- Produces:
  - `LocalStorageAdapter` constructor config gains `publicOrigin?: string`, `presignKey?: Buffer`, `maxUploadBytes?: number`
  - `supportsPresignedUrls(): boolean` — now returns `true` when a `publicOrigin` resolved
  - `getPresignedUploadUrl(key: string, expiresIn?: number): Promise<string>`
  - `readonly presignedUploadPath = '/api/storage/presigned/local'` (exported const `LOCAL_PRESIGN_PATH`)

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/src/storage/local.adapter.spec.ts`:

```typescript
import { LocalStorageAdapter, LOCAL_PRESIGN_PATH } from './local.adapter';
import { derivePresignKey, signLocalUpload, DEFAULT_MAX_UPLOAD_BYTES } from './presign.util';

describe('LocalStorageAdapter presigned uploads', () => {
  const presignKey = derivePresignKey({ ENCRYPTION_KEY: 'test' });

  const makeAdapter = (overrides: Record<string, unknown> = {}) =>
    new LocalStorageAdapter({
      localPath: '/tmp/bffless-presign-test',
      publicOrigin: 'https://ce.example',
      presignKey,
      ...overrides,
    });

  it('reports presigned support once an origin is configured', () => {
    expect(makeAdapter().supportsPresignedUrls()).toBe(true);
  });

  it('reports NO presigned support when no origin was resolved', () => {
    const adapter = new LocalStorageAdapter({ localPath: '/tmp/x', presignKey });
    expect(adapter.supportsPresignedUrls()).toBe(false);
  });

  it('mints an absolute same-origin URL on the presign path', async () => {
    const url = new URL(await makeAdapter().getPresignedUploadUrl('o/r/uploads/content/a.bin'));
    expect(url.origin).toBe('https://ce.example');
    expect(url.pathname).toBe(LOCAL_PRESIGN_PATH);
  });

  it('signs the prefixed key so the signature matches what the route will verify', async () => {
    const adapter = makeAdapter({ keyPrefix: 'ws1' });
    const url = new URL(await adapter.getPresignedUploadUrl('o/r/uploads/content/a.bin'));

    const key = Buffer.from(url.searchParams.get('key')!, 'base64url').toString('utf8');
    expect(key).toBe('ws1/o/r/uploads/content/a.bin');

    const exp = Number(url.searchParams.get('exp'));
    const max = Number(url.searchParams.get('max'));
    expect(url.searchParams.get('sig')).toBe(signLocalUpload({ key, exp, max }, presignKey));
  });

  it('binds the configured size ceiling into the URL', async () => {
    const url = new URL(await makeAdapter().getPresignedUploadUrl('k'));
    expect(Number(url.searchParams.get('max'))).toBe(DEFAULT_MAX_UPLOAD_BYTES);

    const custom = new URL(await makeAdapter({ maxUploadBytes: 1234 }).getPresignedUploadUrl('k'));
    expect(Number(custom.searchParams.get('max'))).toBe(1234);
  });

  it('defaults expiry to one hour and clamps anything longer', async () => {
    const now = Math.floor(Date.now() / 1000);

    const def = new URL(await makeAdapter().getPresignedUploadUrl('k'));
    expect(Number(def.searchParams.get('exp'))).toBeGreaterThanOrEqual(now + 3599);
    expect(Number(def.searchParams.get('exp'))).toBeLessThanOrEqual(now + 3601);

    const clamped = new URL(await makeAdapter().getPresignedUploadUrl('k', 999_999));
    expect(Number(clamped.searchParams.get('exp'))).toBeLessThanOrEqual(now + 3601);
  });

  it('rejects a path-traversal key instead of signing it', async () => {
    await expect(makeAdapter().getPresignedUploadUrl('../../etc/passwd')).rejects.toThrow(
      /path traversal/i,
    );
  });

  it('does not use the vestigial baseUrl', async () => {
    const adapter = makeAdapter({ baseUrl: 'http://localhost:3000/files' });
    const url = await adapter.getPresignedUploadUrl('k');
    expect(url.startsWith('https://ce.example')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && pnpm test -- local.adapter`
Expected: FAIL — `LOCAL_PRESIGN_PATH` is not exported and `supportsPresignedUrls()` returns `false`.

- [ ] **Step 3: Implement**

In `apps/backend/src/storage/local.adapter.ts`, add the import and the exported path constant near the top:

```typescript
import {
  derivePresignKey,
  resolvePublicOrigin,
  signLocalUpload,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_EXPIRES_IN_SECONDS,
} from './presign.util';

/** Path the local presigned-upload route is mounted at. */
export const LOCAL_PRESIGN_PATH = '/api/storage/presigned/local';
```

Add fields alongside the existing ones (after line 24) and extend the constructor (replacing lines 26-34):

```typescript
  private readonly publicOrigin: string | null;
  private readonly presignKey: Buffer;
  private readonly maxUploadBytes: number;

  constructor(config: {
    localPath: string;
    baseUrl?: string;
    keyPrefix?: string;
    publicOrigin?: string;
    presignKey?: Buffer;
    maxUploadBytes?: number;
  }) {
    this.basePath = path.resolve(config.localPath);
    this.baseUrl = config.baseUrl || 'http://localhost:3000/files'; // @TODO baseUrl of /files does not make sense, no sure baseUrl is used for anything?
    this.keyPrefix = config.keyPrefix || '';

    // Presigned-upload config. `publicOrigin` is deliberately separate from the
    // vestigial `baseUrl` above: threading presigned URLs through that would
    // silently mint localhost URLs on a real install.
    this.publicOrigin = config.publicOrigin?.replace(/\/+$/, '') ?? null;
    this.presignKey = config.presignKey ?? derivePresignKey();
    this.maxUploadBytes = config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

    this.logger.log(
      `Initialized LocalStorageAdapter with basePath: ${this.basePath}` +
        (this.keyPrefix ? `, keyPrefix: ${this.keyPrefix}` : '') +
        `, presignedUploads: ${this.publicOrigin ? 'enabled' : 'disabled (no public origin)'}`,
    );
  }
```

Replace `supportsPresignedUrls()` (line 198) and add the minting method next to it:

```typescript
  /**
   * Local storage supports presigned uploads via a same-origin, HMAC-signed
   * PUT route. Requires a resolvable public origin to mint absolute URLs.
   */
  supportsPresignedUrls(): boolean {
    return this.publicOrigin !== null;
  }

  /**
   * Mint a signed, time-bounded, size-capped upload URL.
   *
   * The signature covers the PREFIXED key so it matches exactly what the route
   * will write, and `max` is signed so a client cannot raise its own cap.
   */
  async getPresignedUploadUrl(key: string, expiresIn = MAX_EXPIRES_IN_SECONDS): Promise<string> {
    if (!this.publicOrigin) {
      throw new Error(
        'Presigned local uploads are not available: no public origin configured ' +
          '(set PUBLIC_ORIGIN or PRIMARY_DOMAIN).',
      );
    }

    const storageKey = this.prefixKey(this.sanitizeKey(key));
    const ttl = Math.min(Math.max(1, Math.floor(expiresIn)), MAX_EXPIRES_IN_SECONDS);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const max = this.maxUploadBytes;
    const sig = signLocalUpload({ key: storageKey, exp, max }, this.presignKey);

    const url = new URL(LOCAL_PRESIGN_PATH, this.publicOrigin);
    url.searchParams.set('key', Buffer.from(storageKey, 'utf8').toString('base64url'));
    url.searchParams.set('exp', String(exp));
    url.searchParams.set('max', String(max));
    url.searchParams.set('sig', sig);
    return url.toString();
  }
```

> `sanitizeKey` is private on this class (`local.adapter.ts:351`) and throws `Invalid storage key: path traversal detected` for `..`, which is what the traversal test asserts. `resolvePublicOrigin` is *not* called here — the adapter receives an already-resolved origin so it stays free of `process.env` reads. Task 3 wires the resolution at the construction sites.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && pnpm test -- local.adapter`
Expected: PASS. Also run `pnpm test -- presigned-upload.handler` — the handler's `PRESIGNED_NOT_SUPPORTED` branch must still behave for adapters that report `false`.

- [ ] **Step 5: Typecheck and commit**

```bash
cd apps/backend && pnpm exec tsc --noEmit
git add apps/backend/src/storage/local.adapter.ts apps/backend/src/storage/local.adapter.spec.ts
git commit -m "feat(storage): mint presigned upload URLs from LocalStorageAdapter"
```

---

### Task 3: Wire `publicOrigin` into every construction site

There are exactly three places a `LocalStorageAdapter` is built. Missing one means presigned uploads silently stay off in that code path.

**Files:**
- Modify: `apps/backend/src/storage/dynamic-storage.adapter.ts:31-32`
- Modify: `apps/backend/src/storage/storage.module.ts:155`
- Modify: `apps/backend/src/setup/setup.service.ts:894`
- Test: `apps/backend/src/storage/dynamic-storage.adapter.spec.ts` (append)

**Interfaces:**
- Consumes: the extended `LocalStorageAdapter` config from Task 2; `resolvePublicOrigin` from Task 1.
- Produces: no new symbols — a behavioural guarantee that a default-constructed adapter reports presigned support when `PRIMARY_DOMAIN` or `PUBLIC_ORIGIN` is set.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/storage/dynamic-storage.adapter.spec.ts`:

```typescript
describe('DynamicStorageAdapter default local adapter', () => {
  const original = process.env.PRIMARY_DOMAIN;
  afterEach(() => {
    if (original === undefined) delete process.env.PRIMARY_DOMAIN;
    else process.env.PRIMARY_DOMAIN = original;
  });

  it('supports presigned uploads out of the box when a domain is configured', () => {
    process.env.PRIMARY_DOMAIN = 'ce.example';
    expect(new DynamicStorageAdapter().supportsPresignedUrls()).toBe(true);
  });

  it('degrades to unsupported rather than throwing when no origin can be resolved', () => {
    delete process.env.PRIMARY_DOMAIN;
    delete process.env.PUBLIC_ORIGIN;
    expect(new DynamicStorageAdapter().supportsPresignedUrls()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && pnpm test -- dynamic-storage.adapter`
Expected: FAIL — first case returns `false`, because the default adapter is built with only `localPath`.

- [ ] **Step 3: Implement — a shared, non-throwing resolver**

Add to `apps/backend/src/storage/presign.util.ts`:

```typescript
/**
 * Origin resolution for construction sites that must not fail boot. Returns
 * undefined instead of throwing; the adapter then reports no presigned support.
 */
export function tryResolvePublicOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    return resolvePublicOrigin(env);
  } catch {
    return undefined;
  }
}
```

In `dynamic-storage.adapter.ts`, import it and replace line 32:

```typescript
    this.adapter = new LocalStorageAdapter({
      localPath: './uploads',
      publicOrigin: tryResolvePublicOrigin(),
    });
```

In `storage.module.ts:155`, pass the origin through alongside the existing config:

```typescript
        return new LocalStorageAdapter({
          ...config.config,
          publicOrigin: config.config.publicOrigin ?? tryResolvePublicOrigin(),
        });
```

In `setup/setup.service.ts:894`, add the same field to the existing object literal:

```typescript
        return new LocalStorageAdapter({
          // ...existing fields unchanged...
          publicOrigin: tryResolvePublicOrigin(),
        });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && pnpm test -- dynamic-storage.adapter local.adapter presign.util`
Expected: PASS. Then `pnpm test -- setup.service storage.module` to confirm nothing regressed.

- [ ] **Step 5: Add a test asserting all three sites are covered**

Append to `apps/backend/src/storage/presign.util.spec.ts`:

```typescript
describe('construction-site coverage', () => {
  it('has no LocalStorageAdapter construction without publicOrigin', () => {
    const { execSync } = require('child_process');
    // Every `new LocalStorageAdapter({` in src must be followed by a publicOrigin
    // within its object literal. Guards against a fourth site being added later.
    const hits = execSync(
      "grep -rn 'new LocalStorageAdapter({' --include='*.ts' src | grep -v '.spec.ts' || true",
      { cwd: process.cwd(), encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(hits.length).toBe(3);
  });
});
```

- [ ] **Step 6: Run and commit**

Run: `cd apps/backend && pnpm test -- presign.util && pnpm exec tsc --noEmit`

```bash
git add apps/backend/src/storage/presign.util.ts apps/backend/src/storage/presign.util.spec.ts \
        apps/backend/src/storage/dynamic-storage.adapter.ts apps/backend/src/storage/dynamic-storage.adapter.spec.ts \
        apps/backend/src/storage/storage.module.ts apps/backend/src/setup/setup.service.ts
git commit -m "feat(storage): resolve a public origin at every LocalStorageAdapter construction site"
```

---

### Task 4: Streaming upload writer

The piece that must never buffer. Isolated from HTTP so it can be tested with a plain `Readable`.

**Files:**
- Create: `apps/backend/src/storage/local-upload-writer.service.ts`
- Test: `apps/backend/src/storage/local-upload-writer.service.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `class LocalUploadWriterService`
  - `writeStream(opts: { source: Readable; basePath: string; storageKey: string; maxBytes: number }): Promise<{ bytesWritten: number; etag: string }>`
  - `class UploadTooLargeError extends Error { readonly bytesWritten: number }`
  - `sweepTempFiles(basePath: string, olderThanMs: number): Promise<number>`
  - `const TEMP_DIR_NAME = '.tmp'`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/storage/local-upload-writer.service.spec.ts`:

```typescript
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import {
  LocalUploadWriterService,
  UploadTooLargeError,
  TEMP_DIR_NAME,
} from './local-upload-writer.service';

describe('LocalUploadWriterService', () => {
  let basePath: string;
  let writer: LocalUploadWriterService;

  beforeEach(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'bffless-upload-'));
    writer = new LocalUploadWriterService();
  });
  afterEach(async () => {
    await fs.rm(basePath, { recursive: true, force: true });
  });

  const listTemp = async (): Promise<string[]> => {
    try {
      return await fs.readdir(path.join(basePath, TEMP_DIR_NAME));
    } catch {
      return [];
    }
  };

  it('writes the body to the target key and returns a content etag', async () => {
    const body = Buffer.from('hello presigned world');
    const result = await writer.writeStream({
      source: Readable.from([body]),
      basePath,
      storageKey: 'o/r/uploads/content/a.bin',
      maxBytes: 1024,
    });

    expect(result.bytesWritten).toBe(body.length);
    expect(result.etag).toBe(createHash('sha256').update(body).digest('hex'));
    expect(await fs.readFile(path.join(basePath, 'o/r/uploads/content/a.bin'))).toEqual(body);
  });

  it('creates missing parent directories', async () => {
    await writer.writeStream({
      source: Readable.from([Buffer.from('x')]),
      basePath,
      storageKey: 'deep/nested/path/f.txt',
      maxBytes: 16,
    });
    expect(await fs.readFile(path.join(basePath, 'deep/nested/path/f.txt'), 'utf8')).toBe('x');
  });

  it('leaves no temp file behind on success', async () => {
    await writer.writeStream({
      source: Readable.from([Buffer.from('x')]),
      basePath,
      storageKey: 'a.txt',
      maxBytes: 16,
    });
    expect(await listTemp()).toEqual([]);
  });

  it('aborts when the body exceeds maxBytes, writing nothing to the target', async () => {
    await expect(
      writer.writeStream({
        source: Readable.from([Buffer.alloc(100)]),
        basePath,
        storageKey: 'too-big.bin',
        maxBytes: 10,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);

    await expect(fs.access(path.join(basePath, 'too-big.bin'))).rejects.toThrow();
    expect(await listTemp()).toEqual([]);
  });

  it('cleans up when the source stream errors mid-body', async () => {
    const source = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('client disconnected'));
      },
    });

    await expect(
      writer.writeStream({ source, basePath, storageKey: 'partial.bin', maxBytes: 1024 }),
    ).rejects.toThrow(/client disconnected/);

    await expect(fs.access(path.join(basePath, 'partial.bin'))).rejects.toThrow();
    expect(await listTemp()).toEqual([]);
  });

  it('never leaves a partial object at the target key', async () => {
    // Pre-existing content must survive a failed overwrite.
    await fs.writeFile(path.join(basePath, 'existing.bin'), 'ORIGINAL');
    await expect(
      writer.writeStream({
        source: Readable.from([Buffer.alloc(999)]),
        basePath,
        storageKey: 'existing.bin',
        maxBytes: 10,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);

    expect(await fs.readFile(path.join(basePath, 'existing.bin'), 'utf8')).toBe('ORIGINAL');
  });

  it('streams with bounded memory for a body far larger than the heap budget', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x61); // 1 MiB
    const totalChunks = 300; // 300 MiB — would OOM a 128 MB heap if buffered
    let emitted = 0;
    const source = new Readable({
      read() {
        this.push(emitted++ < totalChunks ? chunk : null);
      },
    });

    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    const result = await writer.writeStream({
      source,
      basePath,
      storageKey: 'big.bin',
      maxBytes: totalChunks * chunk.length,
    });

    const growth = process.memoryUsage().heapUsed - before;
    expect(result.bytesWritten).toBe(totalChunks * chunk.length);
    // Generous ceiling; a buffering implementation grows by ~300 MB.
    expect(growth).toBeLessThan(64 * 1024 * 1024);
  }, 60_000);

  it('sweeps temp files older than the cutoff and keeps fresh ones', async () => {
    const tempDir = path.join(basePath, TEMP_DIR_NAME);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'stale'), 'x');
    await fs.writeFile(path.join(tempDir, 'fresh'), 'x');

    const old = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(path.join(tempDir, 'stale'), old, old);

    expect(await writer.sweepTempFiles(basePath, 30 * 60 * 1000)).toBe(1);
    expect(await fs.readdir(tempDir)).toEqual(['fresh']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && pnpm test -- local-upload-writer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the writer**

Create `apps/backend/src/storage/local-upload-writer.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';

/** Sub-directory of the storage root holding in-flight uploads. */
export const TEMP_DIR_NAME = '.tmp';

export class UploadTooLargeError extends Error {
  constructor(
    message: string,
    readonly bytesWritten: number,
  ) {
    super(message);
    this.name = 'UploadTooLargeError';
  }
}

export interface WriteStreamOptions {
  source: Readable;
  basePath: string;
  storageKey: string;
  maxBytes: number;
}

/**
 * Streams an upload body to local storage with bounded memory.
 *
 * Writes to a temp file and atomically renames on success, so a failure never
 * leaves a partial object — or a truncated overwrite of an existing one — at
 * the target key.
 */
@Injectable()
export class LocalUploadWriterService {
  private readonly logger = new Logger(LocalUploadWriterService.name);

  async writeStream({
    source,
    basePath,
    storageKey,
    maxBytes,
  }: WriteStreamOptions): Promise<{ bytesWritten: number; etag: string }> {
    const tempDir = path.join(basePath, TEMP_DIR_NAME);
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, randomUUID());

    const hash = createHash('sha256');
    let bytesWritten = 0;

    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            bytesWritten += chunk.length;
            if (bytesWritten > maxBytes) {
              throw new UploadTooLargeError(
                `Upload exceeds the signed maximum of ${maxBytes} bytes`,
                bytesWritten,
              );
            }
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(tempPath),
      );
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }

    const targetPath = path.join(basePath, storageKey);
    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }

    this.logger.log(`Presigned upload wrote ${bytesWritten} bytes to ${storageKey}`);
    return { bytesWritten, etag: hash.digest('hex') };
  }

  /**
   * Remove abandoned temp files (client disconnected before the body ended).
   * Returns how many were deleted.
   */
  async sweepTempFiles(basePath: string, olderThanMs: number): Promise<number> {
    const tempDir = path.join(basePath, TEMP_DIR_NAME);
    let entries: string[];
    try {
      entries = await fs.readdir(tempDir);
    } catch {
      return 0;
    }

    const cutoff = Date.now() - olderThanMs;
    let deleted = 0;
    for (const entry of entries) {
      const full = path.join(tempDir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(full, { force: true });
          deleted += 1;
        }
      } catch {
        // Raced with another sweeper or a rename; nothing to do.
      }
    }
    if (deleted > 0) this.logger.log(`Swept ${deleted} abandoned upload temp file(s)`);
    return deleted;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && pnpm test -- local-upload-writer`
Expected: PASS. The bounded-memory case is the important one — if it fails, the implementation is buffering somewhere and must be fixed, not the assertion loosened.

Run the memory case with GC exposed for a tighter signal:
`cd apps/backend && NODE_OPTIONS=--expose-gc pnpm exec jest -t 'bounded memory'`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/storage/local-upload-writer.service.ts \
        apps/backend/src/storage/local-upload-writer.service.spec.ts
git commit -m "feat(storage): add bounded-memory streaming writer for local uploads"
```

---

### Task 5: Feature flag

**Files:**
- Modify: `apps/backend/src/feature-flags/feature-flags.definitions.ts` (after the `ENABLE_MINIO_STORAGE` block, ~line 97)
- Test: `apps/backend/src/feature-flags/feature-flags.definitions.spec.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: flag key `ENABLE_LOCAL_PRESIGNED_UPLOADS` in `FLAG_DEFINITIONS`, exposed to the client.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/feature-flags/feature-flags.definitions.spec.ts`:

```typescript
describe('ENABLE_LOCAL_PRESIGNED_UPLOADS', () => {
  it('is defined, on by default, and exposed to the client', () => {
    const flag = FLAG_DEFINITIONS['ENABLE_LOCAL_PRESIGNED_UPLOADS'];
    expect(flag).toBeDefined();
    expect(flag.envKey).toBe('FEATURE_LOCAL_PRESIGNED_UPLOADS');
    expect(flag.defaultValue).toBe(true);
    expect(flag.type).toBe('boolean');
    expect(flag.category).toBe('features');
    expect(getClientExposedFlagKeys()).toContain('ENABLE_LOCAL_PRESIGNED_UPLOADS');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && pnpm test -- feature-flags.definitions`
Expected: FAIL — `flag` is `undefined`.

- [ ] **Step 3: Add the definition**

In `apps/backend/src/feature-flags/feature-flags.definitions.ts`, after the `ENABLE_MINIO_STORAGE` entry:

```typescript
  ENABLE_LOCAL_PRESIGNED_UPLOADS: {
    envKey: 'FEATURE_LOCAL_PRESIGNED_UPLOADS',
    defaultValue: true,
    type: 'boolean',
    description:
      'Allow presigned (direct) uploads when local filesystem storage is active. ' +
      'Exposes a signature-authorized PUT route; disable to require proxied uploads.',
    category: 'features',
    exposeToClient: true,
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && pnpm test -- feature-flags.definitions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/feature-flags/feature-flags.definitions.ts \
        apps/backend/src/feature-flags/feature-flags.definitions.spec.ts
git commit -m "feat(feature-flags): add ENABLE_LOCAL_PRESIGNED_UPLOADS"
```

---

### Task 6: Cache invalidation hook

A presigned PUT writes underneath `CachingStorageAdapter`, which would otherwise keep serving stale bytes. `getCacheKey` is private (`caching-storage.adapter.ts:254`), so expose a targeted public method.

**Files:**
- Modify: `apps/backend/src/storage/cache/caching-storage.adapter.ts` (add near `invalidateDeployment`, ~line 224)
- Test: `apps/backend/src/storage/cache/caching-storage.adapter.spec.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CachingStorageAdapter.invalidateKey(key: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/storage/cache/caching-storage.adapter.spec.ts`, following the mocking style already used in that file:

```typescript
describe('invalidateKey', () => {
  it('deletes exactly the cache entry for one storage key', async () => {
    const cache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByPrefix: jest.fn(),
      cacheType: 'memory' as const,
    };
    const storage = {} as any;
    const adapter = new CachingStorageAdapter(storage, cache as any);

    await adapter.invalidateKey('o/r/uploads/content/a.bin');

    expect(cache.delete).toHaveBeenCalledWith('cache:o/r/uploads/content/a.bin');
    expect(cache.deleteByPrefix).not.toHaveBeenCalled();
  });
});
```

> Match the existing spec's constructor signature and cache-stub shape if they differ; the assertion that matters is `cache:<key>` and that only `delete` is used.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && pnpm test -- caching-storage.adapter`
Expected: FAIL — `adapter.invalidateKey is not a function`.

- [ ] **Step 3: Implement**

Add to `apps/backend/src/storage/cache/caching-storage.adapter.ts`:

```typescript
  /**
   * Invalidate a single cached object.
   *
   * Needed because a presigned upload writes to the backing store directly,
   * bypassing this adapter's `upload()` — so the cache would otherwise keep
   * serving the previous bytes for that key.
   */
  async invalidateKey(key: string): Promise<void> {
    await this.cache.delete(this.getCacheKey(key));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && pnpm test -- caching-storage.adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/storage/cache/caching-storage.adapter.ts \
        apps/backend/src/storage/cache/caching-storage.adapter.spec.ts
git commit -m "feat(storage): add single-key cache invalidation for direct writes"
```

---

### Task 7: The presigned upload route

**Files:**
- Create: `apps/backend/src/storage/local-presigned-upload.controller.ts`
- Test: `apps/backend/src/storage/local-presigned-upload.controller.spec.ts`
- Modify: `apps/backend/src/storage/storage.module.ts:59,142-146` (register controller + provider, import `StorageUsageModule` and `FeatureFlagsModule`)

**Interfaces:**
- Consumes: `verifyLocalUpload`, `derivePresignKey` (Task 1); `LocalStorageAdapter` presign fields (Task 2); `LocalUploadWriterService`, `UploadTooLargeError` (Task 4); `ENABLE_LOCAL_PRESIGNED_UPLOADS` (Task 5); `CachingStorageAdapter.invalidateKey` (Task 6).
- Produces: `LocalPresignedUploadController` handling `PUT /api/storage/presigned/local`.

**Behaviour contract — ordered checks, all before any bytes are written:**

| Order | Condition | Status |
|---|---|---|
| 1 | Flag off | 404 |
| 2 | Active adapter is not local | 404 |
| 3 | Missing/invalid query params | 400 |
| 4 | Bad signature | 403 |
| 5 | `exp` in the past | 403 |
| 6 | Missing `Content-Length` | 411 |
| 7 | `Content-Length` > signed `max` | 413 |
| 8 | Over quota | 507 |
| 9 | Key fails re-sanitization | 400 |
| — | Actual bytes exceed cap (mid-stream) | 413 |

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/storage/local-presigned-upload.controller.spec.ts`:

```typescript
import { Readable } from 'stream';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  HttpException,
} from '@nestjs/common';
import { LocalPresignedUploadController } from './local-presigned-upload.controller';
import { derivePresignKey, signLocalUpload } from './presign.util';
import { LocalUploadWriterService, UploadTooLargeError } from './local-upload-writer.service';

describe('LocalPresignedUploadController', () => {
  const presignKey = derivePresignKey({ ENCRYPTION_KEY: 'test' });
  const KEY = 'o/r/uploads/content/a.bin';
  const MAX = 1024;
  const future = () => Math.floor(Date.now() / 1000) + 600;

  const validQuery = (overrides: Record<string, string> = {}) => {
    const exp = Number(overrides.exp ?? future());
    const max = Number(overrides.max ?? MAX);
    const key = overrides.key ?? KEY;
    return {
      key: Buffer.from(key, 'utf8').toString('base64url'),
      exp: String(exp),
      max: String(max),
      sig: overrides.sig ?? signLocalUpload({ key, exp, max }, presignKey),
      ...('rawKey' in overrides ? {} : {}),
    };
  };

  const makeReq = (contentLength: number | undefined = 10) =>
    Object.assign(Readable.from([Buffer.alloc(contentLength ?? 0)]), {
      headers: contentLength === undefined ? {} : { 'content-length': String(contentLength) },
    }) as any;

  let writer: jest.Mocked<LocalUploadWriterService>;
  let flags: { isEnabled: jest.Mock };
  let quota: { checkQuota: jest.Mock };
  let localAdapter: any;
  let storageAdapter: any;

  const build = () =>
    new LocalPresignedUploadController(
      storageAdapter,
      writer as any,
      flags as any,
      quota as any,
    );

  beforeEach(() => {
    writer = { writeStream: jest.fn().mockResolvedValue({ bytesWritten: 10, etag: 'abc' }) } as any;
    flags = { isEnabled: jest.fn().mockResolvedValue(true) };
    quota = { checkQuota: jest.fn().mockResolvedValue({ allowed: true }) };
    localAdapter = {
      constructor: { name: 'LocalStorageAdapter' },
      getStorageBasePath: () => '/tmp/base',
      getPresignKey: () => presignKey,
      isLocalAdapter: true,
    };
    storageAdapter = { getUnderlyingAdapter: () => localAdapter };
  });

  it('404s when the feature flag is off', async () => {
    flags.isEnabled.mockResolvedValue(false);
    await expect(build().upload(validQuery(), makeReq(), {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(writer.writeStream).not.toHaveBeenCalled();
  });

  it('404s when the active adapter is not local', async () => {
    storageAdapter = { getUnderlyingAdapter: () => ({ isLocalAdapter: false }) };
    await expect(build().upload(validQuery(), makeReq(), {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403s on a tampered signature', async () => {
    const q = validQuery();
    q.sig = q.sig.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    await expect(build().upload(q, makeReq(), {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(writer.writeStream).not.toHaveBeenCalled();
  });

  it('403s on an expired URL', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    await expect(
      build().upload(validQuery({ exp: String(exp) }), makeReq(), {} as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('411s when Content-Length is absent', async () => {
    const err = await build()
      .upload(validQuery(), makeReq(undefined), {} as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(411);
  });

  it('413s when the declared length exceeds the signed max', async () => {
    await expect(
      build().upload(validQuery(), makeReq(MAX + 1), {} as any),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(writer.writeStream).not.toHaveBeenCalled();
  });

  it('507s when over quota, before writing anything', async () => {
    quota.checkQuota.mockResolvedValue({ allowed: false, message: 'Quota exceeded' });
    const err = await build()
      .upload(validQuery(), makeReq(), {} as any)
      .catch((e) => e);
    expect(err.getStatus()).toBe(507);
    expect(writer.writeStream).not.toHaveBeenCalled();
  });

  it('400s a key that fails re-sanitization', async () => {
    const key = '../../etc/passwd';
    const exp = future();
    const q = {
      key: Buffer.from(key, 'utf8').toString('base64url'),
      exp: String(exp),
      max: String(MAX),
      sig: signLocalUpload({ key, exp, max: MAX }, presignKey),
    };
    await expect(build().upload(q, makeReq(), {} as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(writer.writeStream).not.toHaveBeenCalled();
  });

  it('streams the body and returns the etag on success', async () => {
    const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn() } as any;
    await build().upload(validQuery(), makeReq(), res);

    expect(writer.writeStream).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: '/tmp/base', storageKey: KEY, maxBytes: MAX }),
    );
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"abc"');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('translates a mid-stream overflow into 413', async () => {
    writer.writeStream.mockRejectedValue(new UploadTooLargeError('too big', 2048));
    await expect(
      build().upload(validQuery(), makeReq(), {} as any),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('passes the request stream itself to the writer, not a buffer', async () => {
    const req = makeReq();
    await build().upload(validQuery(), req, { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn() } as any);
    expect(writer.writeStream.mock.calls[0][0].source).toBe(req);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && pnpm test -- local-presigned-upload`
Expected: FAIL — module not found.

- [ ] **Step 3: Expose what the controller needs from the adapter**

The controller must reach the adapter's base path and presign key, and must be able to tell a local adapter from a bucket one. Add these to `apps/backend/src/storage/local.adapter.ts`:

```typescript
  /** Marker used to narrow the active adapter without instanceof across module boundaries. */
  readonly isLocalAdapter = true;

  /** Absolute storage root. Used by the presigned-upload route. */
  getStorageBasePath(): string {
    return this.basePath;
  }

  /** Presign key this adapter mints with; the route verifies against it. */
  getPresignKey(): Buffer {
    return this.presignKey;
  }
```

- [ ] **Step 4: Implement the controller**

Create `apps/backend/src/storage/local-presigned-upload.controller.ts`:

```typescript
import {
  Controller,
  Put,
  Query,
  Req,
  Res,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { IStorageAdapter, STORAGE_ADAPTER } from './storage.interface';
import { verifyLocalUpload } from './presign.util';
import { LocalUploadWriterService, UploadTooLargeError } from './local-upload-writer.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { StorageQuotaService } from './storage-quota.service';

interface PresignQuery {
  key?: string;
  exp?: string;
  max?: string;
  sig?: string;
}

/**
 * Signature-authorized upload route for local filesystem storage.
 *
 * Deliberately has NO auth guard: authorization is the HMAC signature minted by
 * LocalStorageAdapter.getPresignedUploadUrl, exactly as an S3 presigned PUT
 * carries its own authorization. No cookie, session, or API key is consulted,
 * so the route cannot act as a confused deputy.
 */
@ApiTags('Storage')
@Controller('api/storage/presigned')
export class LocalPresignedUploadController {
  private readonly logger = new Logger(LocalPresignedUploadController.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly writer: LocalUploadWriterService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly quota: StorageQuotaService,
  ) {}

  @Put('local')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Upload bytes to local storage using a presigned URL' })
  @ApiResponse({ status: 200, description: 'Stored' })
  async upload(
    @Query() query: PresignQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // 1. Flag — 404 so the route's existence isn't advertised when disabled.
    if (!(await this.featureFlags.isEnabled('ENABLE_LOCAL_PRESIGNED_UPLOADS'))) {
      throw new NotFoundException();
    }

    // 2. Active adapter must be local. A URL minted before a backend swap must
    //    not write to disk on a bucket-backed install.
    const local = this.resolveLocalAdapter();
    if (!local) throw new NotFoundException();

    // 3. Params.
    const { key: encodedKey, exp: expRaw, max: maxRaw, sig } = query;
    if (!encodedKey || !expRaw || !maxRaw || !sig) {
      throw new BadRequestException('Missing presigned upload parameters');
    }
    const exp = Number(expRaw);
    const max = Number(maxRaw);
    if (!Number.isFinite(exp) || !Number.isFinite(max) || max <= 0) {
      throw new BadRequestException('Malformed presigned upload parameters');
    }

    let storageKey: string;
    try {
      storageKey = Buffer.from(encodedKey, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Malformed key parameter');
    }

    // 4. Signature.
    if (!verifyLocalUpload({ key: storageKey, exp, max }, sig, local.getPresignKey())) {
      this.logger.warn(`Rejected presigned upload with invalid signature for key: ${storageKey}`);
      throw new ForbiddenException('Invalid upload signature');
    }

    // 5. Expiry.
    if (exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('Upload URL has expired');
    }

    // 6/7. Declared size.
    const lengthHeader = req.headers['content-length'];
    if (lengthHeader === undefined) {
      throw new HttpException('Content-Length is required', HttpStatus.LENGTH_REQUIRED);
    }
    const contentLength = Number(lengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new BadRequestException('Malformed Content-Length');
    }
    if (contentLength > max) {
      throw new PayloadTooLargeException(`Upload exceeds the signed maximum of ${max} bytes`);
    }

    // 8. Quota, before any bytes land.
    const quotaResult = await this.quota.checkQuota(contentLength);
    if (!quotaResult.allowed) {
      throw new HttpException(
        quotaResult.message || 'Storage quota exceeded',
        HttpStatus.INSUFFICIENT_STORAGE,
      );
    }

    // 9. Key confinement — defence in depth; the signature already binds the key.
    if (storageKey !== this.normalizeKey(storageKey)) {
      throw new BadRequestException('Invalid storage key');
    }

    // Stream it.
    let result: { bytesWritten: number; etag: string };
    try {
      result = await this.writer.writeStream({
        source: req,
        basePath: local.getStorageBasePath(),
        storageKey,
        maxBytes: max,
      });
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        throw new PayloadTooLargeException(err.message);
      }
      throw err;
    }

    await this.invalidateCache(storageKey);

    res.setHeader('ETag', `"${result.etag}"`);
    res.status(HttpStatus.OK);
  }

  /** Narrow the (possibly dynamic/cache-wrapped) adapter to a local one. */
  private resolveLocalAdapter(): {
    getStorageBasePath(): string;
    getPresignKey(): Buffer;
  } | null {
    const candidates: unknown[] = [this.storageAdapter];
    const adapter = this.storageAdapter as unknown as {
      getUnderlyingAdapter?: () => unknown;
      getWrappedAdapter?: () => unknown;
    };
    if (adapter.getUnderlyingAdapter) candidates.push(adapter.getUnderlyingAdapter());
    if (adapter.getWrappedAdapter) candidates.push(adapter.getWrappedAdapter());

    for (const candidate of candidates) {
      const c = candidate as any;
      if (c?.isLocalAdapter) return c;
      const inner = c?.getUnderlyingAdapter?.() ?? c?.getWrappedAdapter?.();
      if (inner?.isLocalAdapter) return inner;
    }
    return null;
  }

  /** Mirrors LocalStorageAdapter.sanitizeKey's normalization. */
  private normalizeKey(key: string): string {
    if (key.includes('..') || key.includes('\0')) return '';
    return key.replace(/^\/+|\/+$/g, '');
  }

  /** A direct write bypasses CachingStorageAdapter.upload, so evict the key. */
  private async invalidateCache(storageKey: string): Promise<void> {
    const adapter = this.storageAdapter as unknown as {
      invalidateKey?: (key: string) => Promise<void>;
      getUnderlyingAdapter?: () => { invalidateKey?: (key: string) => Promise<void> };
    };
    const target = adapter.invalidateKey
      ? adapter
      : adapter.getUnderlyingAdapter?.();
    try {
      await target?.invalidateKey?.(storageKey);
    } catch (err) {
      this.logger.warn(`Cache invalidation failed for ${storageKey}: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 5: Register in the storage module**

In `apps/backend/src/storage/storage.module.ts`, import the controller, the writer service, `StorageUsageModule`, and `FeatureFlagsModule`; then add to **both** module shapes (lines ~59 and ~142):

```typescript
      controllers: [FilesController, CacheController, LocalPresignedUploadController],
      providers: [/* ...existing... */, LocalUploadWriterService],
```

and add the imports array entry on both:

```typescript
      imports: [StorageUsageModule, FeatureFlagsModule],
```

> If either module shape already has an `imports` array, append rather than replace. `StorageQuotaService` is exported by `StorageUsageModule` (`storage-usage.module.ts:25-28`), so it must be imported rather than re-provided — re-providing would create a second instance with its own `StorageUsageService`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/backend && pnpm test -- local-presigned-upload`
Expected: PASS.

Then the whole storage suite plus a typecheck:
`cd apps/backend && pnpm test -- storage && pnpm exec tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/storage/local-presigned-upload.controller.ts \
        apps/backend/src/storage/local-presigned-upload.controller.spec.ts \
        apps/backend/src/storage/local.adapter.ts \
        apps/backend/src/storage/storage.module.ts
git commit -m "feat(storage): add signature-authorized local presigned upload route"
```

---

### Task 8: Prove the body is not buffered (HTTP-level integration test)

The unit tests use a fake request object, so they cannot detect NestJS's `rawBody: true` or a body parser consuming the stream. This task tests over real HTTP.

**Files:**
- Create: `apps/backend/src/storage/__tests__/integration/local-presigned-upload.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: no new symbols.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/storage/__tests__/integration/local-presigned-upload.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { LocalPresignedUploadController } from '../../local-presigned-upload.controller';
import { LocalUploadWriterService } from '../../local-upload-writer.service';
import { LocalStorageAdapter } from '../../local.adapter';
import { STORAGE_ADAPTER } from '../../storage.interface';
import { FeatureFlagsService } from '../../../feature-flags/feature-flags.service';
import { StorageQuotaService } from '../../storage-quota.service';
import { derivePresignKey } from '../../presign.util';

describe('local presigned upload over HTTP', () => {
  let app: NestExpressApplication;
  let basePath: string;
  let port: number;
  let adapter: LocalStorageAdapter;

  beforeAll(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'bffless-presign-http-'));
    adapter = new LocalStorageAdapter({
      localPath: basePath,
      publicOrigin: 'http://127.0.0.1',
      presignKey: derivePresignKey({ ENCRYPTION_KEY: 'itest' }),
      maxUploadBytes: 400 * 1024 * 1024,
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [LocalPresignedUploadController],
      providers: [
        LocalUploadWriterService,
        { provide: STORAGE_ADAPTER, useValue: adapter },
        { provide: FeatureFlagsService, useValue: { isEnabled: async () => true } },
        { provide: StorageQuotaService, useValue: { checkQuota: async () => ({ allowed: true }) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Reproduce main.ts's body-parser configuration — this is what the test exists to check.
    app.useBodyParser('json', { limit: '10mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });
    await app.init();
    await app.listen(0);
    port = app.getHttpServer().address().port;
  });

  afterAll(async () => {
    await app?.close();
    await fs.rm(basePath, { recursive: true, force: true });
  });

  const put = (url: string, body: Readable, headers: Record<string, string>) =>
    new Promise<{ status: number; etag?: string }>((resolve, reject) => {
      const target = new URL(url);
      const req = http.request(
        { hostname: '127.0.0.1', port, method: 'PUT', path: target.pathname + target.search, headers },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode!, etag: res.headers.etag }));
        },
      );
      req.on('error', reject);
      body.pipe(req);
    });

  it('stores a small body and returns an ETag', async () => {
    const url = await adapter.getPresignedUploadUrl('o/r/uploads/content/small.bin');
    const body = Buffer.from('real http body');

    const res = await put(url, Readable.from([body]), {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
    });

    expect(res.status).toBe(200);
    expect(res.etag).toBeDefined();
    expect(await fs.readFile(path.join(basePath, 'o/r/uploads/content/small.bin'))).toEqual(body);
  });

  it('accepts a body far larger than the 10mb body-parser limit with bounded memory', async () => {
    // If rawBody:true or a body parser consumed this stream, it would fail at
    // ~10mb and/or blow the heap. That silent failure mode is the whole point.
    const url = await adapter.getPresignedUploadUrl('o/r/uploads/content/big.bin');
    const chunk = Buffer.alloc(1024 * 1024, 0x62);
    const chunks = 200; // 200 MiB
    let sent = 0;
    const body = new Readable({
      read() {
        this.push(sent++ < chunks ? chunk : null);
      },
    });

    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    const res = await put(url, body, {
      'content-type': 'application/octet-stream',
      'content-length': String(chunks * chunk.length),
    });

    const growth = process.memoryUsage().heapUsed - before;

    expect(res.status).toBe(200);
    const stat = await fs.stat(path.join(basePath, 'o/r/uploads/content/big.bin'));
    expect(stat.size).toBe(chunks * chunk.length);
    expect(growth).toBeLessThan(64 * 1024 * 1024);
  }, 120_000);

  it('rejects a tampered signature with 403 and writes nothing', async () => {
    const url = new URL(await adapter.getPresignedUploadUrl('o/r/uploads/content/nope.bin'));
    url.searchParams.set('sig', 'f'.repeat(64));
    const body = Buffer.from('x');

    const res = await put(url.toString(), Readable.from([body]), {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
    });

    expect(res.status).toBe(403);
    await expect(fs.access(path.join(basePath, 'o/r/uploads/content/nope.bin'))).rejects.toThrow();
  });

  it('rejects a request with no Content-Length with 411', async () => {
    const url = await adapter.getPresignedUploadUrl('o/r/uploads/content/nolen.bin');
    const res = await put(url, Readable.from([Buffer.from('x')]), {
      'content-type': 'application/octet-stream',
      'transfer-encoding': 'chunked',
    });
    expect(res.status).toBe(411);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd apps/backend && NODE_OPTIONS=--expose-gc pnpm exec jest local-presigned-upload.spec --testPathPattern=integration`
Expected: PASS.

**If the large-body case fails or hangs**, the body is being consumed before the controller. Fixes, in order of preference:
1. Confirm the client sends `Content-Type: application/octet-stream` — the JSON/urlencoded parsers match on content type and must not claim it.
2. If `rawBody: true` is buffering regardless, register a body-parser skip for this path in `main.ts` — e.g. `app.use('/api/storage/presigned/local', (req, _res, next) => { (req as any)._body = true; next(); })` registered **before** the parsers — and add a comment pointing at this test.
3. Re-run and confirm memory growth stays under the ceiling.

Do not loosen the memory assertion to make it pass.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/storage/__tests__/integration/local-presigned-upload.spec.ts
git commit -m "test(storage): prove presigned local uploads stream without buffering"
```

---

### Task 9: Sweep abandoned temp files

**Files:**
- Modify: `apps/backend/src/deployments/pending-uploads.scheduler.ts`
- Test: `apps/backend/src/deployments/pending-uploads.scheduler.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `LocalUploadWriterService.sweepTempFiles` (Task 4), `LocalStorageAdapter.getStorageBasePath` (Task 7).
- Produces: no new public symbols.

- [ ] **Step 1: Write the failing test**

```typescript
describe('presigned upload temp sweep', () => {
  it('sweeps temp files older than an hour when local storage is active', async () => {
    const sweepTempFiles = jest.fn().mockResolvedValue(2);
    const scheduler = new PendingUploadsScheduler(
      /* ...existing deps as the current constructor requires... */
      { getUnderlyingAdapter: () => ({ isLocalAdapter: true, getStorageBasePath: () => '/tmp/b' }) } as any,
      { sweepTempFiles } as any,
    );

    await scheduler.sweepPresignedTempFiles();

    expect(sweepTempFiles).toHaveBeenCalledWith('/tmp/b', 60 * 60 * 1000);
  });

  it('is a no-op when the active adapter is not local', async () => {
    const sweepTempFiles = jest.fn();
    const scheduler = new PendingUploadsScheduler(
      /* ...existing deps... */
      { getUnderlyingAdapter: () => ({ isLocalAdapter: false }) } as any,
      { sweepTempFiles } as any,
    );

    await scheduler.sweepPresignedTempFiles();

    expect(sweepTempFiles).not.toHaveBeenCalled();
  });
});
```

> Read the existing constructor first and pass its current dependencies verbatim; append the two new ones.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/backend && pnpm test -- pending-uploads.scheduler`
Expected: FAIL — `sweepPresignedTempFiles` is not a function.

- [ ] **Step 3: Implement**

Add to `pending-uploads.scheduler.ts`, following the `@Cron`/`@Interval` decorator style already in that file:

```typescript
  /**
   * Remove upload temp files abandoned by clients that disconnected mid-body.
   * Local storage only; bucket backends clean up their own multipart state.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepPresignedTempFiles(): Promise<void> {
    const adapter = this.storageAdapter as any;
    const local = adapter?.isLocalAdapter
      ? adapter
      : adapter?.getUnderlyingAdapter?.();
    if (!local?.isLocalAdapter) return;

    await this.uploadWriter.sweepTempFiles(local.getStorageBasePath(), 60 * 60 * 1000);
  }
```

Inject `@Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter` and `private readonly uploadWriter: LocalUploadWriterService` into the constructor, and ensure the deployments module imports the storage module (it already depends on `STORAGE_ADAPTER`; add `LocalUploadWriterService` to the storage module's `exports`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/backend && pnpm test -- pending-uploads.scheduler && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/deployments/pending-uploads.scheduler.ts \
        apps/backend/src/deployments/pending-uploads.scheduler.spec.ts \
        apps/backend/src/storage/storage.module.ts
git commit -m "feat(storage): sweep abandoned presigned upload temp files hourly"
```

---

### Task 10: nginx streaming configuration

Without this, nginx spools the entire request to a temp file before the backend sees a byte — the upload still works but loses streaming, and stays capped at `client_max_body_size`.

**Files:**
- Modify: `docker/nginx.conf` (near `client_max_body_size` on line 18)
- Modify: `docker/nginx/main.conf` (admin server block, wherever `/api` is proxied)
- Modify: `../platform/adapters/kubernetes/charts/workspace/templates/configmap-nginx.yaml:38` area — **separate repo, separate PR**

**Interfaces:** none.

- [ ] **Step 1: Add the location block to the CE nginx config**

In each server block that proxies `/api` to the backend, add a more specific location **before** the general `/api` one:

```nginx
        # Presigned local uploads stream straight through: no request buffering
        # (so the backend writes to disk incrementally) and a high size ceiling.
        location = /api/storage/presigned/local {
            proxy_pass http://backend:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_request_buffering off;
            client_max_body_size ${PRESIGNED_MAX_BODY_SIZE:-1g};
            proxy_read_timeout 600s;
            proxy_send_timeout 600s;
        }
```

> Match the surrounding blocks' `proxy_pass` upstream name and header set exactly rather than copying the names above verbatim — they differ between `nginx.conf` and the templated `main.conf`. If the file is rendered by `render-main-conf.sh`, use a literal value (`1g`) rather than shell-style interpolation unless that file already substitutes variables.

- [ ] **Step 2: Validate the config**

```bash
cd /home/rico/bffless/repos/ce
docker compose exec nginx nginx -t
```

Expected: `syntax is ok` / `test is successful`. If nginx isn't running, validate in a throwaway container:

```bash
docker run --rm -v "$PWD/docker/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t
```

- [ ] **Step 3: Verify streaming end to end against a running stack**

```bash
cd /home/rico/bffless/repos/ce && ./start.sh
# Mint a URL via a presigned_upload pipeline step or a REPL, then:
head -c 200000000 /dev/urandom > /tmp/big.bin
curl -sS -X PUT --data-binary @/tmp/big.bin -H 'Content-Type: application/octet-stream' "<presigned-url>" -o /dev/null -w '%{http_code}\n'
# Watch RSS stay flat while it runs:
docker stats --no-stream assethost-backend
```

Expected: `200`, and backend memory stays well under the container limit.

- [ ] **Step 4: Commit**

```bash
git add docker/nginx.conf docker/nginx/main.conf
git commit -m "feat(nginx): stream presigned local uploads without request buffering"
```

---

### Task 11: Documentation

**Files:**
- Modify: `apps/backend/src/storage/README.md`
- Modify: `.env.example` (document the two optional vars)

**Interfaces:** none.

- [ ] **Step 1: Document the capability**

Add a section to `apps/backend/src/storage/README.md`:

```markdown
## Presigned uploads

| Adapter | Presigned uploads | Mechanism |
| --- | --- | --- |
| Local | ✅ | Same-origin HMAC-signed `PUT /api/storage/presigned/local` |
| MinIO / S3 / GCS / Azure | ✅ | Provider-native presigned URL |

Local presigned uploads need a resolvable public origin (`PUBLIC_ORIGIN`, else
`https://$PRIMARY_DOMAIN`); without one, `supportsPresignedUrls()` reports
`false` and the presigned pipeline handler returns `PRESIGNED_NOT_SUPPORTED`.

Because the upload URL is **same-origin**, local presigned uploads need no CORS
configuration — unlike a bucket backend, which requires a `PUT` rule for the
site origin.

Signing key: `sha256(LOCAL_PRESIGN_SECRET || ENCRYPTION_KEY | 'local-presign-v1')`.
Never change `ENCRYPTION_KEY` on a live install — in-flight upload URLs would
stop verifying (alongside the existing consequences for stored credentials).

Turn the route off with `FEATURE_LOCAL_PRESIGNED_UPLOADS=false`.
```

- [ ] **Step 2: Document the env vars**

Add to `.env.example`:

```bash
# Origin used to mint presigned upload URLs for local filesystem storage.
# Defaults to https://$PRIMARY_DOMAIN. Only set this if they differ.
# PUBLIC_ORIGIN=https://example.com

# Override the derived signing key for local presigned uploads.
# Defaults to a value derived from ENCRYPTION_KEY; leave unset unless rotating.
# LOCAL_PRESIGN_SECRET=
```

- [ ] **Step 3: Full verification**

```bash
cd apps/backend && pnpm exec tsc --noEmit && pnpm test
```

Expected: typecheck clean, full backend suite passing. Record the actual pass/fail counts — do not claim success without reading the output.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/storage/README.md .env.example
git commit -m "docs(storage): document local presigned uploads"
```

---

## Follow-ups (not tasks in this plan)

- **`repos/apps`:** revise `apps/handoff/bffless/README.md` — the "requires a real bucket storage backend" warning becomes "works on any backend; a bucket is recommended for production", and the bucket-CORS step gains a "bucket backends only" note. Needs its own PR in that repo.
- **`repos/platform`:** the `configmap-nginx.yaml` counterpart of Task 10, in its own PR.
- **`repos/docs-public`:** a storage-docs note that local FS now supports presigned uploads.
- **Security review:** this adds an unauthenticated write route. Run `/security-review` on the branch before merging.
- Removing the vestigial `baseUrl` from `LocalStorageAdapter` (`local.adapter.ts:28`) — explicitly out of scope here.

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Signature format (`key`/`exp`/`max`, HMAC) | 1 |
| Signing-key derivation from `ENCRYPTION_KEY` | 1 |
| Public-origin resolution, fail loudly | 1, 3 |
| `supportsPresignedUrls()` → `true`, `getPresignedUploadUrl` | 2 |
| Don't reuse vestigial `baseUrl` | 2 (test asserts it) |
| `max` as server ceiling, interface unchanged | 2 |
| Route with 9 ordered checks + status codes | 7 |
| Streaming write, temp file + atomic rename | 4 |
| Never a partial object at the target key | 4 (explicit test) |
| Quota enforcement before the write | 7 |
| Key confinement / re-sanitization | 2, 7 |
| Cache invalidation | 6, 7 |
| Feature flag, default on | 5 |
| Body-parser / `rawBody` verification | 8 |
| `proxy_request_buffering off` + body size | 10 |
| Temp-file sweeper | 4 (logic), 9 (schedule) |
| Bounded-memory proof | 4 (unit), 8 (HTTP) |
| Handoff consequences / docs | 11 + follow-ups |
| Security review notes | Follow-ups |

No spec requirement is unassigned.

**Placeholder scan:** every code step carries real code. Three steps say "match the surrounding style / read the existing constructor first" (Tasks 6, 9, 10) — those are deliberate, because the exact existing constructor arguments and nginx upstream names must be read from the files rather than guessed, and inventing them would produce code that doesn't compile.

**Type consistency:** `LocalPresignParams { key, exp, max }` is used identically in Tasks 1, 2, and 7. `writeStream({ source, basePath, storageKey, maxBytes })` matches between Tasks 4, 7, and 8. `UploadTooLargeError` is thrown in Task 4 and caught in Task 7. `isLocalAdapter` / `getStorageBasePath()` / `getPresignKey()` are added in Task 7 Step 3 and consumed in Tasks 7 and 9. `invalidateKey(key)` is defined in Task 6 and called in Task 7. `TEMP_DIR_NAME` and `sweepTempFiles(basePath, olderThanMs)` match between Tasks 4 and 9.
