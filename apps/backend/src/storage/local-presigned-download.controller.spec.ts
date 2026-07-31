import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LocalPresignedDownloadController } from './local-presigned-download.controller';
import { LocalStorageAdapter, LOCAL_PRESIGN_PATH } from './local.adapter';
import {
  derivePresignKey,
  deriveDownloadKey,
  signLocalDownload,
  signLocalUpload,
} from './presign.util';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { STORAGE_ADAPTER } from './storage.interface';

describe('LocalPresignedDownloadController', () => {
  const presignKey = derivePresignKey({ ENCRYPTION_KEY: 'test' });
  const downloadKey = deriveDownloadKey(presignKey);
  const KEY = 'o/r/uploads/content/clip.mp4';
  const BODY = Buffer.from('0123456789abcdef');

  let basePath: string;
  let app: INestApplication;
  let local: LocalStorageAdapter;
  let storageAdapter: any;
  let flags: { isEnabled: jest.Mock };

  /** Build the query the adapter would mint, so route and adapter stay in lockstep. */
  const mint = async (key = KEY, expiresIn = 600, options?: { downloadFilename: string }) =>
    (await local.getUrl(key, expiresIn, options)).slice(LOCAL_PRESIGN_PATH.length);

  const get = (query: string) => request(app.getHttpServer()).get(`${LOCAL_PRESIGN_PATH}${query}`);

  const rawQuery = (params: Record<string, string>) =>
    `?${new URLSearchParams(params).toString()}`;

  const encodeKey = (key: string) => Buffer.from(key, 'utf8').toString('base64url');

  beforeEach(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'presign-dl-'));
    await fs.mkdir(path.join(basePath, path.dirname(KEY)), { recursive: true });
    await fs.writeFile(path.join(basePath, KEY), BODY);

    local = new LocalStorageAdapter({ localPath: basePath, presignKey });
    // Wrapped exactly as production wraps it, so resolveLocalAdapter is exercised.
    storageAdapter = { getUnderlyingAdapter: () => local };
    flags = { isEnabled: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      controllers: [LocalPresignedDownloadController],
      providers: [
        { provide: STORAGE_ADAPTER, useValue: storageAdapter },
        { provide: FeatureFlagsService, useValue: flags },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(basePath, { recursive: true, force: true });
  });

  describe('gating', () => {
    it('404s when the feature flag is off', async () => {
      flags.isEnabled.mockResolvedValue(false);
      await get(await mint()).expect(404);
    });

    it('checks the same flag the upload route does', async () => {
      await get(await mint()).expect(200);
      expect(flags.isEnabled).toHaveBeenCalledWith('ENABLE_LOCAL_PRESIGNED_UPLOADS');
    });

    it('404s when the active storage backend is not local', async () => {
      const query = await mint();
      storageAdapter.getUnderlyingAdapter = () => ({ isLocalAdapter: false });
      await get(query).expect(404);
    });

    it('404s when the local adapter cannot presign (dev-fallback secret only)', async () => {
      const query = await mint();
      jest.spyOn(local, 'supportsPresignedUrls').mockReturnValue(false);
      await get(query).expect(404);
    });
  });

  describe('parameters and signature', () => {
    it('400s when required parameters are missing', async () => {
      await get('').expect(400);
      await get(rawQuery({ key: encodeKey(KEY) })).expect(400);
      await get(rawQuery({ key: encodeKey(KEY), exp: '1800000000' })).expect(400);
    });

    it('400s on a non-numeric exp', async () => {
      await get(rawQuery({ key: encodeKey(KEY), exp: 'soon', sig: 'x'.repeat(64) })).expect(400);
    });

    // Express's query parser hands back an object for `dl[a]=b` and an array
    // for a repeated param. Before the type guard those reached
    // canonicalDownloadString, where Buffer.from(object) threw INSIDE the
    // signature computation — an unauthenticated 500 on a pre-auth path.
    it.each([
      ['object', 'dl[a]=b'],
      ['array', 'dl=one&dl=two'],
      ['object key', 'key[a]=b&exp=1800000000&sig=x'],
    ])('400s (not 500) on a structured %s parameter', async (_label, fragment) => {
      const base = new URLSearchParams((await mint()).slice(1));
      base.delete(fragment.startsWith('key') ? 'key' : 'dl');
      const res = await get(`?${base.toString()}&${fragment}`).expect(400);

      // Pins the failure to the type guard specifically, not to some other
      // 400 further down the handler.
      expect(res.body.message).toBe('Malformed signed download parameters');
    });

    it('403s on a tampered signature', async () => {
      const query = await mint();
      await get(query.replace(/sig=[0-9a-f]{64}/, `sig=${'a'.repeat(64)}`)).expect(403);
    });

    it('403s when the key is swapped under a valid signature', async () => {
      await fs.writeFile(path.join(basePath, 'o/r/uploads/content/other.mp4'), BODY);
      const params = new URLSearchParams((await mint()).slice(1));
      params.set('key', encodeKey('o/r/uploads/content/other.mp4'));
      await get(`?${params.toString()}`).expect(403);
    });

    it('403s on an expired URL, without touching the filesystem', async () => {
      const exp = Math.floor(Date.now() / 1000) - 1;
      await get(
        rawQuery({
          key: encodeKey(KEY),
          exp: String(exp),
          sig: signLocalDownload({ key: KEY, exp }, downloadKey),
        }),
      ).expect(403);
    });

    it('403s on an UPLOAD signature presented to the download route', async () => {
      // Domain separation: an attacker holding a presigned PUT URL for a key
      // must not be able to turn it into a GET of that key.
      const exp = Math.floor(Date.now() / 1000) + 600;
      await get(
        rawQuery({
          key: encodeKey(KEY),
          exp: String(exp),
          sig: signLocalUpload({ key: KEY, exp, max: 1024 }, presignKey),
        }),
      ).expect(403);
    });

    it('403s when dl is added to a signature minted without one', async () => {
      const params = new URLSearchParams((await mint()).slice(1));
      params.set('dl', 'anything.mp4');
      await get(`?${params.toString()}`).expect(403);
    });
  });

  describe('key confinement', () => {
    it.each([
      ['traversal', 'o/r/../../../etc/passwd'],
      ['leading slash', '/etc/passwd'],
      ['trailing slash', 'o/r/dir/'],
      ['null byte', 'o/r/a\0.txt'],
    ])('400s on a %s key even with a valid signature', async (_label, key) => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      await get(
        rawQuery({
          key: encodeKey(key),
          exp: String(exp),
          sig: signLocalDownload({ key, exp }, downloadKey),
        }),
      ).expect(400);
    });
  });

  describe('serving', () => {
    it('404s (not 403) for a missing file under a valid signature', async () => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const key = 'o/r/uploads/content/gone.mp4';
      await get(
        rawQuery({
          key: encodeKey(key),
          exp: String(exp),
          sig: signLocalDownload({ key, exp }, downloadKey),
        }),
      ).expect(404);
    });

    it('streams the bytes with the extension-derived Content-Type', async () => {
      const res = await get(await mint()).expect(200);

      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe(String(BODY.length));
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['cache-control']).toContain('private');
      expect(Buffer.from(res.body)).toEqual(BODY);
    });

    it('falls back to application/octet-stream for an unknown extension', async () => {
      const key = 'o/r/uploads/content/blob.weirdext';
      await fs.writeFile(path.join(basePath, key), BODY);
      const res = await get(await mint(key)).expect(200);

      expect(res.headers['content-type']).toBe('application/octet-stream');
    });

    it('serves inline (no Content-Disposition) without dl', async () => {
      const res = await get(await mint()).expect(200);
      expect(res.headers['content-disposition']).toBeUndefined();
    });

    it('sets Content-Disposition attachment when dl is signed in', async () => {
      const res = await get(
        await mint(KEY, 600, { downloadFilename: 'Holiday Clip.mp4' }),
      ).expect(200);

      expect(res.headers['content-disposition']).toBe('attachment; filename="Holiday Clip.mp4"');
    });

    // Live 500: sanitizeDownloadFilename leaves non-Latin-1 characters intact
    // and res.setHeader throws ERR_INVALID_CHAR on anything above U+00FF.
    // EVERY macOS screenshot carries U+202F between the time and AM/PM, and
    // Studio's sign rule passes the user's own filename straight through, so
    // this was reachable with a completely ordinary file.
    it('serves a U+202F filename as RFC 6266 dual form instead of 500ing', async () => {
      const res = await get(
        await mint(KEY, 600, { downloadFilename: 'Screenshot 7.44.31\u202fAM.png' }),
      ).expect(200);

      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="Screenshot 7.44.31_AM.png"; filename*=UTF-8''Screenshot%207.44.31%E2%80%AFAM.png`,
      );
      expect(Buffer.from(res.body)).toEqual(BODY);
    });

    it('serves a CJK filename as RFC 6266 dual form with a usable ASCII fallback', async () => {
      const res = await get(await mint(KEY, 600, { downloadFilename: '文件.png' })).expect(200);

      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="download.png"; filename*=UTF-8''%E6%96%87%E4%BB%B6.png`,
      );
    });

    it('leaves a pure-ASCII filename in the plain quoted form (no filename*)', async () => {
      const res = await get(
        await mint(KEY, 600, { downloadFilename: 'Holiday Clip.mp4' }),
      ).expect(200);

      expect(res.headers['content-disposition']).not.toContain('filename*');
    });

    it('sanitizes a hostile dl before it reaches the header', async () => {
      const res = await get(
        await mint(KEY, 600, { downloadFilename: 'a/b/ev"il\r\nX-Evil: 1.mp4' }),
      ).expect(200);

      expect(res.headers['content-disposition']).toBe('attachment; filename="evilX-Evil: 1.mp4"');
      expect(res.headers['x-evil']).toBeUndefined();
    });
  });

  describe('range requests', () => {
    it('serves a byte range as 206 with Content-Range', async () => {
      const res = await get(await mint()).set('Range', 'bytes=4-7').expect(206);

      expect(res.headers['content-range']).toBe(`bytes 4-7/${BODY.length}`);
      expect(res.headers['content-length']).toBe('4');
      expect(Buffer.from(res.body)).toEqual(BODY.subarray(4, 8));
    });

    it('serves an open-ended range to the end of the file', async () => {
      const res = await get(await mint()).set('Range', 'bytes=8-').expect(206);

      expect(res.headers['content-range']).toBe(`bytes 8-${BODY.length - 1}/${BODY.length}`);
      expect(Buffer.from(res.body)).toEqual(BODY.subarray(8));
    });

    // RFC 9110 §14.1.2: `bytes=-N` is the SUFFIX form — the last N bytes.
    // Reading the empty first group as a defaulted 0 served bytes 0..N and
    // mislabelled them in Content-Range, which a player renders as garbage.
    it('serves a suffix range as the LAST N bytes (curl -r -5)', async () => {
      const res = await get(await mint()).set('Range', 'bytes=-5').expect(206);

      expect(res.headers['content-range']).toBe(`bytes 11-15/${BODY.length}`);
      expect(res.headers['content-length']).toBe('5');
      expect(Buffer.from(res.body)).toEqual(BODY.subarray(BODY.length - 5));
    });

    it('serves the whole file when the suffix exceeds its size', async () => {
      const res = await get(await mint()).set('Range', 'bytes=-999').expect(206);

      expect(res.headers['content-range']).toBe(`bytes 0-${BODY.length - 1}/${BODY.length}`);
      expect(Buffer.from(res.body)).toEqual(BODY);
    });

    it('416s a zero-length suffix range', async () => {
      const res = await get(await mint()).set('Range', 'bytes=-0').expect(416);
      expect(res.headers['content-range']).toBe(`bytes */${BODY.length}`);
    });

    it('416s an unsatisfiable range', async () => {
      const res = await get(await mint()).set('Range', 'bytes=999-1200').expect(416);
      expect(res.headers['content-range']).toBe(`bytes */${BODY.length}`);
    });

    it('ignores a malformed Range header shape it cannot parse', async () => {
      const res = await get(await mint()).set('Range', 'items=1-2').expect(200);
      expect(Buffer.from(res.body)).toEqual(BODY);
    });
  });
});
