import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { AppBundleService } from './app-bundle.service';
import { TEST_MANIFEST } from './app-manifest.util.spec';

function makeBundle(manifest: unknown = TEST_MANIFEST): { buf: Uint8Array; sha256: string } {
  const buf = zipSync({
    'bffless-app.json': strToU8(JSON.stringify(manifest)),
    'rulesets/handoff.json': strToU8(JSON.stringify({ ruleSet: { name: 'handoff' }, rules: [], schemas: [] })),
    'rulesets/handoff-rss-feed.json': strToU8(
      JSON.stringify({ ruleSet: { name: 'handoff-rss-feed' }, rules: [], schemas: [] }),
    ),
    'dist/index.html': strToU8('<!doctype html>ok'),
  });
  return { buf, sha256: createHash('sha256').update(buf).digest('hex') };
}

function fetchResponse(bytes: Uint8Array, opts: { contentLength?: number } = {}): Response {
  const contentLength = opts.contentLength ?? bytes.byteLength;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-length' ? String(contentLength) : null),
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

describe('AppBundleService', () => {
  let service: AppBundleService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new AppBundleService();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('loadFromBuffer', () => {
    it('parses the manifest and exposes files on a matching sha', async () => {
      const { buf, sha256 } = makeBundle();

      const loaded = await service.loadFromBuffer(buf, sha256);

      expect(loaded.manifest).toEqual(TEST_MANIFEST);
      expect(loaded.sha256).toBe(sha256);
      expect(loaded.files['dist/index.html']).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(loaded.files['dist/index.html'])).toBe('<!doctype html>ok');
    });

    it('throws BadRequestException mentioning sha256 on mismatch, before parsing', async () => {
      const { buf } = makeBundle();

      await expect(service.loadFromBuffer(buf, 'f'.repeat(64))).rejects.toThrow(BadRequestException);
      await expect(service.loadFromBuffer(buf, 'f'.repeat(64))).rejects.toThrow(/sha256/i);
    });

    it('throws when bffless-app.json is missing', async () => {
      const buf = zipSync({
        'dist/index.html': strToU8('<!doctype html>ok'),
      });
      const sha256 = createHash('sha256').update(buf).digest('hex');

      await expect(service.loadFromBuffer(buf, sha256)).rejects.toThrow();
    });

    it('throws with the validator errors when the manifest fails validateAppManifest', async () => {
      const { buf, sha256 } = makeBundle({ ...TEST_MANIFEST, schemaVersion: 2 });

      await expect(service.loadFromBuffer(buf, sha256)).rejects.toThrow(/schemaVersion/);
    });

    it('throws when a declared ruleSets file is missing from the zip', async () => {
      const buf = zipSync({
        'bffless-app.json': strToU8(JSON.stringify(TEST_MANIFEST)),
        'rulesets/handoff.json': strToU8(JSON.stringify({ ruleSet: { name: 'handoff' }, rules: [], schemas: [] })),
        // rulesets/handoff-rss-feed.json intentionally omitted
        'dist/index.html': strToU8('<!doctype html>ok'),
      });
      const sha256 = createHash('sha256').update(buf).digest('hex');

      await expect(service.loadFromBuffer(buf, sha256)).rejects.toThrow(/declared file missing/i);
    });

    it('works without an expectedSha256 (fixture/test path)', async () => {
      const { buf } = makeBundle();

      const loaded = await service.loadFromBuffer(buf);

      expect(loaded.manifest).toEqual(TEST_MANIFEST);
    });
  });

  describe('fetchBundle', () => {
    it('downloads, verifies sha, and returns the loaded bundle', async () => {
      const { buf, sha256 } = makeBundle();
      fetchSpy.mockResolvedValue(fetchResponse(buf));

      const loaded = await service.fetchBundle('https://example.com/handoff.zip', sha256);

      expect(loaded.manifest).toEqual(TEST_MANIFEST);
      expect(loaded.files['dist/index.html']).toBeInstanceOf(Uint8Array);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not re-download when the sha is already cached (preflight then install)', async () => {
      const { buf, sha256 } = makeBundle();
      fetchSpy.mockResolvedValue(fetchResponse(buf));

      const first = await service.fetchBundle('https://example.com/handoff.zip', sha256);
      const second = await service.fetchBundle('https://example.com/handoff.zip', sha256);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
      expect(second.manifest).toEqual(TEST_MANIFEST);
    });

    it('throws on sha mismatch', async () => {
      const { buf } = makeBundle();
      fetchSpy.mockResolvedValue(fetchResponse(buf));

      await expect(
        service.fetchBundle('https://example.com/handoff.zip', 'f'.repeat(64)),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an oversized body before hashing, via Content-Length', async () => {
      const { buf } = makeBundle();
      const arrayBufferSpy = jest.fn(async () => buf.buffer);
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length' ? String(300 * 1024 * 1024) : null,
        },
        arrayBuffer: arrayBufferSpy,
      } as unknown as Response);

      await expect(
        service.fetchBundle('https://example.com/huge.zip', 'a'.repeat(64)),
      ).rejects.toThrow(/too large|size|exceeds/i);
      expect(arrayBufferSpy).not.toHaveBeenCalled();
    });

    it('rejects an oversized body discovered after download (no Content-Length header)', async () => {
      const bigBuf = new Uint8Array(0); // real 200MiB alloc is impractical in a unit test
      const arrayBufferSpy = jest.fn(async () => {
        const fake = new ArrayBuffer(0);
        Object.defineProperty(fake, 'byteLength', { value: 300 * 1024 * 1024 });
        return fake;
      });
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: arrayBufferSpy,
      } as unknown as Response);
      void bigBuf;

      await expect(
        service.fetchBundle('https://example.com/huge.zip', 'a'.repeat(64)),
      ).rejects.toThrow(/too large|size|exceeds/i);
    });

    it('throws when the response is not ok', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);

      await expect(
        service.fetchBundle('https://example.com/missing.zip', 'a'.repeat(64)),
      ).rejects.toThrow();
    });
  });
});
