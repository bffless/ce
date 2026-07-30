import { Readable } from 'stream';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  HttpException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LocalPresignedUploadController } from './local-presigned-upload.controller';
import { derivePresignKey, signLocalUpload } from './presign.util';
import {
  LocalUploadWriterService,
  UploadTooLargeError,
  UploadIncompleteError,
} from './local-upload-writer.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { StorageQuotaService } from './storage-quota.service';
import { STORAGE_ADAPTER } from './storage.interface';

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

  // Rest-args, not a default parameter: a default parameter substitutes for an
  // EXPLICIT `undefined` argument too, so `makeReq(undefined)` would silently
  // get contentLength=10 instead of representing "no Content-Length header" —
  // exactly the case the 411 test below needs to exercise. This distinguishes
  // "called with no argument" (default 10) from "called with `undefined`"
  // (absent), matching every call site's intent.
  const makeReq = (...args: [number?]) => {
    const contentLength = args.length > 0 ? args[0] : 10;
    return Object.assign(Readable.from([Buffer.alloc(contentLength ?? 0)]), {
      headers: contentLength === undefined ? {} : { 'content-length': String(contentLength) },
    }) as any;
  };

  let writer: jest.Mocked<LocalUploadWriterService>;
  let flags: { isEnabled: jest.Mock };
  let quota: { checkQuota: jest.Mock };
  let localAdapter: any;
  let storageAdapter: any;

  const build = () =>
    new LocalPresignedUploadController(storageAdapter, writer as any, flags as any, quota as any);

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
    await expect(build().upload(q, makeReq(), {} as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
    await expect(build().upload(validQuery(), makeReq(MAX + 1), {} as any)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
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

    // makeReq() defaults to a 10-byte Content-Length; MAX (the signed
    // ceiling) is 1024. maxBytes is tightened to Math.min(max, contentLength)
    // per the fix-round hardening, so the writer must see 10, not 1024 --
    // and expectedBytes must be set to contentLength so the writer can
    // detect a short body before it ever renames into place.
    expect(writer.writeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: '/tmp/base',
        storageKey: KEY,
        maxBytes: 10,
        expectedBytes: 10,
      }),
    );
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"abc"');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('translates a mid-stream overflow into 413', async () => {
    writer.writeStream.mockRejectedValue(new UploadTooLargeError('too big', 2048));
    await expect(build().upload(validQuery(), makeReq(), {} as any)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('translates a writer-detected short body (e.g. body-parser consumed the request) into 400, not a 200', async () => {
    // Regression test for the fix-round finding: a non-octet-stream
    // Content-Type (e.g. application/json) lets a global body parser fully
    // consume the request stream before it reaches the writer, so the writer
    // sees zero bytes despite a declared Content-Length. The writer detects
    // this (UploadIncompleteError) and the controller must surface it as a
    // client error, not let it fall through as a false 200.
    writer.writeStream.mockRejectedValue(new UploadIncompleteError('short body', 0, 10));
    const err = await build()
      .upload(validQuery(), makeReq(), {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('passes the request stream itself to the writer, not a buffer', async () => {
    const req = makeReq();
    await build().upload(validQuery(), req, {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as any);
    expect(writer.writeStream.mock.calls[0][0].source).toBe(req);
  });
});

/**
 * Item 4 from the task dispatch: the unit tests above call `controller.upload()`
 * directly, which never exercises Nest's request pipeline — so they cannot tell
 * us whether the app's *global* `ValidationPipe` (main.ts: `{ whitelist: true,
 * transform: true, forbidNonWhitelisted: true }`) would strip the four
 * `@Query()` params before the handler ever sees them. `whitelist: true` drops
 * any property a DTO doesn't declare with class-validator decorators; `query`
 * here is `PresignQuery`, a plain TS interface with no decorators at all, whose
 * emitted design-type metadata is bare `Object`. Nest's ValidationPipe has a
 * `toValidate()` check that skips primitive/plain-Object metatypes entirely
 * (no `class-validator` metadata to validate against), so the pipe should
 * pass the query through untouched rather than validating-and-stripping it.
 *
 * This spins up a real Nest HTTP pipeline (Test.createTestingModule +
 * supertest) with the *exact* ValidationPipe config from main.ts applied, and
 * asserts the handler actually receives all four params by checking the
 * writer.writeStream call args reflect the real signed key/max — not the 400
 * "Missing presigned upload parameters" that a silent strip would produce.
 */
describe('LocalPresignedUploadController with the real global ValidationPipe', () => {
  const presignKey = derivePresignKey({ ENCRYPTION_KEY: 'test' });
  const KEY = 'o/r/uploads/content/pipe-check.bin';
  const MAX = 1024;

  let app: INestApplication;
  let writer: { writeStream: jest.Mock };

  beforeAll(async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const sig = signLocalUpload({ key: KEY, exp, max: MAX }, presignKey);

    writer = { writeStream: jest.fn().mockResolvedValue({ bytesWritten: 5, etag: 'pipe-etag' }) };
    const flags = { isEnabled: jest.fn().mockResolvedValue(true) };
    const quota = { checkQuota: jest.fn().mockResolvedValue({ allowed: true }) };
    const localAdapter = {
      isLocalAdapter: true,
      getStorageBasePath: () => '/tmp/base',
      getPresignKey: () => presignKey,
    };
    const storageAdapter = { getUnderlyingAdapter: () => localAdapter };

    const moduleRef = await Test.createTestingModule({
      controllers: [LocalPresignedUploadController],
      providers: [
        { provide: STORAGE_ADAPTER, useValue: storageAdapter },
        { provide: LocalUploadWriterService, useValue: writer },
        { provide: FeatureFlagsService, useValue: flags },
        { provide: StorageQuotaService, useValue: quota },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts's global pipe exactly — this is the thing under test.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    (app as any).__fixture = { exp, sig };
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not strip the undecorated @Query() params', async () => {
    const { exp, sig } = (app as any).__fixture;
    const body = Buffer.alloc(5);
    const res = await request(app.getHttpServer())
      .put('/api/storage/presigned/local')
      .query({
        key: Buffer.from(KEY, 'utf8').toString('base64url'),
        exp: String(exp),
        max: String(MAX),
        sig,
      })
      .set('Content-Type', 'application/octet-stream')
      .send(body);

    // A silent strip would surface as 400 "Missing presigned upload
    // parameters" (query.key/exp/max/sig all undefined). Confirm instead that
    // the handler reached the writer with the real, decoded params. maxBytes
    // is Math.min(max, contentLength) = min(1024, 5) = 5 per the fix-round
    // hardening, and expectedBytes mirrors the declared Content-Length.
    expect(res.status).toBe(200);
    expect(writer.writeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: '/tmp/base',
        storageKey: KEY,
        maxBytes: 5,
        expectedBytes: 5,
      }),
    );
  });
});
