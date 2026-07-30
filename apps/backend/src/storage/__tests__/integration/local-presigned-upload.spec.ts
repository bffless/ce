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

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Reproduce main.ts's body-parser configuration — this is what the test exists to check.
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
    // eslint-disable-next-line no-console
    console.info(
      `[local-presigned-upload] heap growth for 200MiB body: ${(growth / (1024 * 1024)).toFixed(2)} MiB`,
    );

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
});
