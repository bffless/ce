import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { AppBundleService } from './app-bundle.service';
import { TEST_MANIFEST } from './app-manifest.util.spec';

function makeBundle(
  manifest: unknown = TEST_MANIFEST,
  extraEntries: Record<string, Uint8Array> = {},
): { buf: Uint8Array; sha256: string } {
  const buf = zipSync({
    'bffless-app.json': strToU8(JSON.stringify(manifest)),
    'rulesets/handoff.json': strToU8(JSON.stringify({ ruleSet: { name: 'handoff' }, rules: [], schemas: [] })),
    'rulesets/handoff-rss-feed.json': strToU8(
      JSON.stringify({ ruleSet: { name: 'handoff-rss-feed' }, rules: [], schemas: [] }),
    ),
    'dist/index.html': strToU8('<!doctype html>ok'),
    ...extraEntries,
  });
  return { buf, sha256: createHash('sha256').update(buf).digest('hex') };
}

const TEST_COMMIT = 'c01bb08a1b2c3d4e5f60718293a4b5c6d7e8f900';

function withBuildStamp(stamp: string): Record<string, Uint8Array> {
  return { '.bffless-build.json': strToU8(stamp) };
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

    it('exposes the source commit from the build stamp', async () => {
      const { buf, sha256 } = makeBundle(
        TEST_MANIFEST,
        withBuildStamp(JSON.stringify({ commit: TEST_COMMIT })),
      );

      const loaded = await service.loadFromBuffer(buf, sha256);

      expect(loaded.build).toEqual({ commit: TEST_COMMIT });
    });

    it('leaves build undefined for a bundle with no stamp', async () => {
      const { buf, sha256 } = makeBundle();

      const loaded = await service.loadFromBuffer(buf, sha256);

      expect(loaded.build).toBeUndefined();
    });

    // A malformed stamp must degrade to "no provenance", never to a failed install: the stamp
    // is cosmetic, and rejecting the bundle would take an app offline over it. Anything that is
    // not a bare 40-hex commit is dropped rather than passed through to a deployment's SHA.
    it.each([
      ['not JSON', 'not json at all'],
      ['a JSON array', '[]'],
      ['no commit field', JSON.stringify({ builtAt: '2026-08-02' })],
      ['a non-string commit', JSON.stringify({ commit: 12345 })],
      ['a short commit', JSON.stringify({ commit: 'c01bb08' })],
      ['a 64-hex sha256', JSON.stringify({ commit: 'a'.repeat(64) })],
    ])('installs without provenance when the stamp is %s', async (_label, stamp) => {
      const { buf, sha256 } = makeBundle(TEST_MANIFEST, withBuildStamp(stamp));

      const loaded = await service.loadFromBuffer(buf, sha256);

      expect(loaded.build).toBeUndefined();
      expect(loaded.manifest).toEqual(TEST_MANIFEST);
    });

    it('normalises an uppercase commit to lowercase', async () => {
      const { buf, sha256 } = makeBundle(
        TEST_MANIFEST,
        withBuildStamp(JSON.stringify({ commit: TEST_COMMIT.toUpperCase() })),
      );

      const loaded = await service.loadFromBuffer(buf, sha256);

      expect(loaded.build).toEqual({ commit: TEST_COMMIT });
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

    // The cache used to be bounded by entry count alone (3 entries), so three big apps could
    // pin ~190MB of decompressed bundles in a 384MB container. Retaining a bundle must never
    // cost more than the byte budget, however few entries that is.
    it('does not retain a bundle larger than the cache byte budget', async () => {
      // ~12MB of incompressible payload, over the 8MB budget for a single cached bundle.
      const big = new Uint8Array(12 * 1024 * 1024);
      for (let i = 0; i < big.length; i++) big[i] = i % 251;
      const { buf, sha256 } = makeBundle(TEST_MANIFEST, { 'dist/big.wasm': big });
      fetchSpy.mockResolvedValue(fetchResponse(buf));

      const first = await service.fetchBundle('https://example.com/big.zip', sha256);
      const second = await service.fetchBundle('https://example.com/big.zip', sha256);

      // Correct content both times — it just gets re-fetched instead of pinned in memory.
      expect(first.manifest).toEqual(TEST_MANIFEST);
      expect(second.manifest).toEqual(TEST_MANIFEST);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    // Small bundles are the common case and must still be cached, so preflight-then-install
    // does not download twice.
    it('still caches bundles that fit the byte budget', async () => {
      const { buf, sha256 } = makeBundle();
      fetchSpy.mockResolvedValue(fetchResponse(buf));

      await service.fetchBundle('https://example.com/handoff.zip', sha256);
      await service.fetchBundle('https://example.com/handoff.zip', sha256);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
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
