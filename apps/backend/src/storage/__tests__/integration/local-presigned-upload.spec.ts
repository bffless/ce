import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { LocalPresignedUploadController } from '../../local-presigned-upload.controller';
import { LocalUploadWriterService } from '../../local-upload-writer.service';
import { LocalStorageAdapter, LOCAL_PRESIGN_PATH } from '../../local.adapter';
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

    // Fail loudly on misconfiguration rather than as a puzzling 404 on every
    // test — see CONTROLLER NOTE in the task-8 brief. supportsPresignedUrls()
    // is exactly the predicate the route gates on.
    expect(adapter.supportsPresignedUrls()).toBe(true);

    const moduleRef = await Test.createTestingModule({
      controllers: [LocalPresignedUploadController],
      providers: [
        LocalUploadWriterService,
        { provide: STORAGE_ADAPTER, useValue: adapter },
        { provide: FeatureFlagsService, useValue: { isEnabled: async () => true } },
        { provide: StorageQuotaService, useValue: { checkQuota: async () => ({ allowed: true }) } },
      ],
    }).compile();

    // Reproduce main.ts's bootstrap exactly: rawBody: true plus the re-registered
    // json/urlencoded parsers at a 10mb limit. This is the fixture's whole job —
    // if main.ts's body handling ever changes, this file should be the one that
    // notices.
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useBodyParser('json', { limit: '10mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app?.close();
    await fs.rm(basePath, { recursive: true, force: true });
  });

  const put = (url: string, body: Readable, headers: Record<string, string>) =>
    new Promise<{ status: number; etag?: string }>((resolve, reject) => {
      const target = new URL(url);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'PUT',
          path: target.pathname + target.search,
          headers,
        },
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
    // Proves that with production's exact bootstrap in effect — rawBody: true
    // AND the re-registered json/urlencoded parsers at a 10mb limit — an
    // octet-stream body far past that limit still streams through unbuffered.
    // Neither parser's content-type matcher claims application/octet-stream, so
    // this doesn't exercise what happens when one of them does (see the
    // JSON-typed regression test below for that case); it exercises the path
    // every real large upload actually takes.
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
    const ceiling = 64 * 1024 * 1024;

    expect(res.status).toBe(200);
    const stat = await fs.stat(path.join(basePath, 'o/r/uploads/content/big.bin'));
    expect(stat.size).toBe(chunks * chunk.length);
    // Jest's expect() has no message parameter, so report the measured MiB
    // only on failure via a plain throw rather than an unconditional log —
    // that's the only moment anyone needs the number; a green run stays silent.
    if (growth >= ceiling) {
      throw new Error(
        `heap grew by ${(growth / (1024 * 1024)).toFixed(2)} MiB for a 200 MiB body ` +
          `(ceiling ${(ceiling / (1024 * 1024)).toFixed(0)} MiB) — the body may be buffering`,
      );
    }
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

  // CONTROLLER ADDITION — regression test for the zero-byte overwrite bug found
  // in Task 7's review. The global json/urlencoded body parsers in main.ts
  // consume a non-octet-stream body BEFORE the handler runs, so pipeline() saw an
  // already-ended stream, wrote 0 bytes, and fs.rename REPLACED the existing
  // object with an empty file — returning 200 with an empty-content ETag. Data
  // destruction reported as success. Every other test here sends
  // application/octet-stream, which is exactly why nothing caught it.
  it('does not destroy an existing object when the body is consumed by a body parser', async () => {
    const key = 'o/r/uploads/content/precious.bin';
    const original = Buffer.from('ORIGINAL CONTENT THAT MUST SURVIVE');

    // Seed a real object at the target key via a normal, correct upload.
    const seedUrl = await adapter.getPresignedUploadUrl(key);
    const seeded = await put(seedUrl, Readable.from([original]), {
      'content-type': 'application/octet-stream',
      'content-length': String(original.length),
    });
    expect(seeded.status).toBe(200);

    // Now PUT to the same key with a JSON content type, which the global parser eats.
    const jsonBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const res = await put(await adapter.getPresignedUploadUrl(key), Readable.from([jsonBody]), {
      'content-type': 'application/json',
      'content-length': String(jsonBody.length),
    });

    // It must NOT report success...
    expect(res.status).not.toBe(200);
    // ...and critically, the original object must be intact.
    expect(await fs.readFile(path.join(basePath, key))).toEqual(original);
  });

  it('rejects a request with no Content-Length with 411', async () => {
    const url = await adapter.getPresignedUploadUrl('o/r/uploads/content/nolen.bin');
    const res = await put(url, Readable.from([Buffer.from('x')]), {
      'content-type': 'application/octet-stream',
      'transfer-encoding': 'chunked',
    });
    expect(res.status).toBe(411);
  });

  // Production mints a RELATIVE URL by default (see local.adapter.ts's
  // getPresignedUploadUrl); the fixture above uses an explicit publicOrigin so
  // its absolute-URL cases above keep exercising that (still-supported) shape.
  // This adapter shares the SAME presignKey/maxUploadBytes as the one wired
  // into the app above -- getPresignedUploadUrl only reads those two fields
  // plus keyPrefix to mint+sign, so a URL from either adapter verifies
  // identically against the running route.
  //
  // IMPORTANT LIMITATION: this still drives the Nest app directly with no
  // nginx in front (see `put()`'s http.request straight to `port`), so it
  // only proves the app-layer contract holds for a relative URL resolved
  // against *some* origin -- it does NOT prove nginx actually routes
  // `/api/storage/presigned/local` on a real app host unrewritten. That vhost
  // routing gap is the one fixed by the per-domain nginx templates (see
  // docs/superpowers/specs/2026-07-30-local-fs-presigned-uploads-design.md,
  // section "Correction: upload URL routing"); this test file structurally
  // cannot catch a regression there. The nginx template changes are the
  // actual fix; this only confirms the URL SHAPE the adapter now mints is
  // relative and that a relative URL, once resolved against a host, still
  // round-trips through the route correctly.
  it('resolves a RELATIVE presigned URL against the app host and completes the PUT', async () => {
    const relativeOnlyAdapter = new LocalStorageAdapter({
      localPath: basePath,
      presignKey: derivePresignKey({ ENCRYPTION_KEY: 'itest' }),
      maxUploadBytes: 400 * 1024 * 1024,
    });
    expect(relativeOnlyAdapter.supportsPresignedUrls()).toBe(true);

    const relativeUrl = await relativeOnlyAdapter.getPresignedUploadUrl(
      'o/r/uploads/content/relative.bin',
    );
    expect(relativeUrl.startsWith(LOCAL_PRESIGN_PATH)).toBe(true);
    expect(relativeUrl).not.toMatch(/^https?:\/\//);

    // What the browser does: resolve the relative URL against the page's own
    // origin, which here is the same host:port the test server listens on.
    const absoluteUrl = new URL(relativeUrl, `http://127.0.0.1:${port}`).toString();
    const body = Buffer.from('relative body');

    const res = await put(absoluteUrl, Readable.from([body]), {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
    });

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(basePath, 'o/r/uploads/content/relative.bin'))).toEqual(
      body,
    );
  });
});
