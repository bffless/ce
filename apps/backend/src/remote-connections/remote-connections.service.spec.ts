import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    execute: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../db/client');

import { RemoteConnectionsService } from './remote-connections.service';
import { decryptString, encryptString, __resetKeyForTests } from '../common/crypto/aes-gcm';
import type { ResolvedConnection } from './remote-connections.types';
import type { RemoteClient } from './remote-client';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const SA_KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'x@p.iam.gserviceaccount.com',
});
const SA_KEY_2 = JSON.stringify({
  type: 'service_account',
  client_email: 'y@p.iam.gserviceaccount.com',
});

/** A row as Drizzle would return it. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1',
    name: 'ffmpeg',
    url: 'https://w.run.app',
    auth: 'google_id_token',
    credentialEncrypted: null,
    maxInflight: 8,
    healthPath: '/health',
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedByUserId: null,
    ...over,
  };
}

/**
 * Stand-in for the table: `select` reads it, the `insert`/`update`/`delete`
 * mocks write to it, so the `reload()` a save performs sees what was persisted.
 */
let table: Record<string, unknown>[] = [];

function mockSelect(rows: unknown[]) {
  table = rows as Record<string, unknown>[];
  db.select.mockReturnValue({
    from: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockImplementation(async () => table),
    }),
  });
}
function mockSelectThrows(err: Error) {
  db.select.mockReturnValue({
    from: jest.fn().mockReturnValue({ orderBy: jest.fn().mockRejectedValue(err) }),
  });
}

function mockWrite() {
  const values = jest.fn().mockImplementation((vals: Record<string, unknown>) => ({
    returning: jest.fn().mockImplementation(async () => {
      const created = { ...row(), id: `c${table.length + 1}`, ...vals };
      table = [...table, created];
      return [created];
    }),
  }));
  db.insert.mockReturnValue({ values });

  const set = jest.fn().mockImplementation((patch: Record<string, unknown>) => ({
    where: jest.fn().mockReturnValue({
      returning: jest.fn().mockImplementation(async () => {
        table = table.map((r) => ({ ...r, ...patch }));
        return table;
      }),
    }),
  }));
  db.update.mockReturnValue({ set });

  const del = jest.fn().mockImplementation(async () => {
    table = [];
  });
  db.delete.mockReturnValue({ where: del });

  db.execute.mockResolvedValue([]);
  return { values, set, del };
}

type Factory = (c: ResolvedConnection) => RemoteClient;

function make(env: NodeJS.ProcessEnv = {}, clientFactory?: Factory) {
  return new RemoteConnectionsService(() => env, clientFactory);
}

/** A RemoteClient stand-in: only `probe()` is exercised by `test()`. */
function fakeFactory(probe: jest.Mock) {
  return jest.fn(() => ({ probe }) as unknown as RemoteClient);
}

describe('RemoteConnectionsService', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY;
    __resetKeyForTests();
    jest.clearAllMocks();
    table = [];
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    __resetKeyForTests();
  });

  describe('reload() / resolve() / list()', () => {
    it('decrypts the stored credential and reports every field as db-sourced', async () => {
      mockSelect([row({ credentialEncrypted: encryptString(SA_KEY) })]);
      const service = make();
      await service.reload();

      const conn = service.resolve('ffmpeg');
      expect(conn).toMatchObject({
        id: 'c1',
        name: 'ffmpeg',
        url: 'https://w.run.app',
        auth: 'google_id_token',
        credential: SA_KEY,
        maxInflight: 8,
        healthPath: '/health',
      });
      expect(conn?.source).toEqual({
        url: 'db',
        auth: 'db',
        credential: 'db',
        maxInflight: 'db',
        healthPath: 'db',
        envOnly: false,
      });
      expect(service.resolve('nope')).toBeNull();
      expect(service.byId('c1')?.name).toBe('ffmpeg');
      expect(service.byId('nope')).toBeNull();
    });

    it('an undecryptable credential leaves the connection usable with credential null', async () => {
      mockSelect([row({ credentialEncrypted: 'not:valid:ciphertext' })]);
      const service = make();
      await service.reload();
      expect(service.resolve('ffmpeg')?.credential).toBeNull();
    });

    it('env pins override the DB row field-by-field; an env-only name lists with id null', async () => {
      mockSelect([row()]);
      const service = make({
        REMOTE_CONNECTION_FFMPEG_URL: 'https://env.run.app/',
        REMOTE_CONNECTION_FFMPEG_MAX_INFLIGHT: '16',
        REMOTE_CONNECTION_PDF_RENDERER_URL: 'https://pdf.run.app',
        REMOTE_CONNECTION_PDF_RENDERER_AUTH: 'none',
        // No URL and no row: nothing to connect to, so it is not a connection.
        REMOTE_CONNECTION_ORPHAN_AUTH: 'none',
      });
      await service.reload();

      const ffmpeg = service.resolve('ffmpeg');
      expect(ffmpeg?.url).toBe('https://env.run.app');
      expect(ffmpeg?.maxInflight).toBe(16);
      expect(ffmpeg?.source).toMatchObject({
        url: 'env',
        maxInflight: 'env',
        auth: 'db',
        healthPath: 'db',
        envOnly: false,
      });

      const pdf = service.resolve('pdf-renderer');
      expect(pdf).toMatchObject({ id: null, url: 'https://pdf.run.app', auth: 'none' });
      expect(pdf?.source).toMatchObject({ url: 'env', auth: 'env', envOnly: true });

      expect(service.list().map((c) => c.name)).toEqual(['ffmpeg', 'pdf-renderer']);
      expect(service.resolve('orphan')).toBeNull();
    });

    it('legacy FFMPEG_REMOTE_* vars resolve as the "ffmpeg" connection', async () => {
      mockSelect([]);
      const service = make({
        FFMPEG_REMOTE_URL: 'https://legacy.run.app',
        FFMPEG_REMOTE_SA_KEY_JSON: SA_KEY,
      });
      await service.reload();

      const conn = service.resolve('ffmpeg');
      expect(conn).toMatchObject({
        id: null,
        url: 'https://legacy.run.app',
        credential: SA_KEY,
        maxInflight: 8,
        healthPath: '/health',
      });
      expect(conn?.source).toMatchObject({ url: 'env', credential: 'env', envOnly: true });
    });
  });

  describe('create()', () => {
    it('encrypts the credential, refreshes the cache and returns the status', async () => {
      mockSelect([]);
      const { values } = mockWrite();
      const service = make();
      await service.reload();

      const status = await service.create(
        {
          name: 'pdf-renderer',
          url: 'https://pdf.run.app/',
          auth: 'google_id_token',
          credential: SA_KEY,
          maxInflight: 16,
          healthPath: 'healthz',
        },
        'user-1',
      );

      const inserted = values.mock.calls[0][0];
      expect(inserted.name).toBe('pdf-renderer');
      expect(inserted.url).toBe('https://pdf.run.app');
      expect(inserted.healthPath).toBe('/healthz');
      expect(inserted.credentialEncrypted).not.toContain('service_account');
      expect(decryptString(inserted.credentialEncrypted)).toBe(SA_KEY);
      expect(inserted.updatedByUserId).toBe('user-1');

      expect(status).toMatchObject({
        name: 'pdf-renderer',
        hasCredential: true,
        maxInflight: 16,
        healthPath: '/healthz',
        envOnly: false,
      });
      expect(service.resolve('pdf-renderer')?.credential).toBe(SA_KEY);
    });

    it('rejects a bad name, http with google_id_token, a bad credential, a bad cap and a duplicate', async () => {
      mockSelect([row()]);
      const { values } = mockWrite();
      const service = make();
      await service.reload();

      await expect(
        service.create({ name: 'Bad_Name', url: 'https://x.run.app', auth: 'none' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: '-x', url: 'https://x.run.app', auth: 'none' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: 'x', url: 'http://x.run.app', auth: 'google_id_token' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: 'x', url: 'not a url', auth: 'none' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: 'x', url: 'https://x.run.app', auth: 'basic' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({
          name: 'x',
          url: 'https://x.run.app',
          auth: 'google_id_token',
          credential: '{not json',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({
          name: 'x',
          url: 'https://x.run.app',
          auth: 'google_id_token',
          credential: '{"type":"authorized_user"}',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: 'x', url: 'https://x.run.app', auth: 'none', maxInflight: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: 'x', url: 'https://x.run.app', auth: 'none', maxInflight: 65 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ name: 'ffmpeg', url: 'https://x.run.app', auth: 'none' }),
      ).rejects.toThrow(/already exists/);

      expect(values).not.toHaveBeenCalled();
    });

    it('accepts an http URL when auth is none', async () => {
      mockSelect([]);
      mockWrite();
      const service = make();
      await service.reload();
      await expect(
        service.create({ name: 'lan', url: 'http://renderer:8080', auth: 'none' }),
      ).resolves.toMatchObject({ name: 'lan', hasCredential: false });
    });
  });

  describe('update()', () => {
    it('credential undefined keeps the stored one, a string replaces it, null clears it', async () => {
      mockSelect([row({ credentialEncrypted: encryptString(SA_KEY) })]);
      const { set } = mockWrite();
      const service = make();
      await service.reload();

      await service.update('c1', { maxInflight: 4 });
      expect(set.mock.calls[0][0]).not.toHaveProperty('credentialEncrypted');
      expect(service.resolve('ffmpeg')?.credential).toBe(SA_KEY);
      expect(service.resolve('ffmpeg')?.maxInflight).toBe(4);

      await service.update('c1', { credential: SA_KEY_2 });
      expect(decryptString(set.mock.calls[1][0].credentialEncrypted as string)).toBe(SA_KEY_2);
      expect(service.resolve('ffmpeg')?.credential).toBe(SA_KEY_2);

      await service.update('c1', { credential: null });
      expect(set.mock.calls[2][0].credentialEncrypted).toBeNull();
      expect(service.resolve('ffmpeg')?.credential).toBeNull();
    });

    it('a blanked credential field clears the key rather than failing as invalid JSON', async () => {
      mockSelect([row({ credentialEncrypted: encryptString(SA_KEY) })]);
      const { set } = mockWrite();
      const service = make();
      await service.reload();

      await service.update('c1', { credential: '   ' });
      expect(set.mock.calls[0][0].credentialEncrypted).toBeNull();
      expect(service.resolve('ffmpeg')?.credential).toBeNull();
    });

    it('refuses to edit a field pinned by env, naming the variable', async () => {
      mockSelect([row()]);
      const { set } = mockWrite();
      const pinned = make({ REMOTE_CONNECTION_FFMPEG_URL: 'https://env.run.app' });
      await pinned.reload();
      await expect(pinned.update('c1', { url: 'https://other.run.app' })).rejects.toThrow(
        /managed by REMOTE_CONNECTION_FFMPEG_URL on this instance/,
      );

      mockSelect([row({ id: 'c2', name: 'pdf-renderer' })]);
      const pinnedCap = make({ REMOTE_CONNECTION_PDF_RENDERER_MAX_INFLIGHT: '16' });
      await pinnedCap.reload();
      await expect(pinnedCap.update('c2', { maxInflight: 4 })).rejects.toThrow(
        /managed by REMOTE_CONNECTION_PDF_RENDERER_MAX_INFLIGHT on this instance/,
      );
      expect(set).not.toHaveBeenCalled();
    });

    it('refuses to rename a connection whose fields are pinned by env', async () => {
      mockSelect([row()]);
      const { set } = mockWrite();
      const service = make({ REMOTE_CONNECTION_FFMPEG_URL: 'https://env.run.app' });
      await service.reload();
      await expect(service.update('c1', { name: 'ffmpeg-2' })).rejects.toThrow(/cannot be renamed/);
      expect(set).not.toHaveBeenCalled();
    });

    it('renames an unpinned connection', async () => {
      mockSelect([row()]);
      const { set } = mockWrite();
      const service = make();
      await service.reload();
      const status = await service.update('c1', { name: 'ffmpeg-2' });
      expect(set.mock.calls[0][0].name).toBe('ffmpeg-2');
      expect(status.name).toBe('ffmpeg-2');
    });

    it('mentions the legacy variable when the ffmpeg connection is pinned by FFMPEG_REMOTE_URL', async () => {
      mockSelect([row()]);
      mockWrite();
      const service = make({ FFMPEG_REMOTE_URL: 'https://legacy.run.app' });
      await service.reload();
      await expect(service.update('c1', { url: 'https://other.run.app' })).rejects.toThrow(
        /FFMPEG_REMOTE_URL/,
      );
    });

    it('rejects an unknown id', async () => {
      mockSelect([row()]);
      mockWrite();
      const service = make();
      await service.reload();
      await expect(service.update('nope', { maxInflight: 4 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to save while the rows could not be loaded — never merges onto defaults', async () => {
      const { set, values } = mockWrite();
      mockSelectThrows(new Error('relation "remote_connections" does not exist'));
      const service = make();
      await service.reload();

      await expect(service.update('c1', { maxInflight: 4 })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(
        service.create({ name: 'x', url: 'https://x.run.app', auth: 'none' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(set).not.toHaveBeenCalled();
      expect(values).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('refuses with 409 while the ffmpeg executor references the connection', async () => {
      mockSelect([row()]);
      const { del } = mockWrite();
      const service = make();
      await service.reload();

      service.registerUsageProbe('ffmpegExecutor', (name) => name === 'ffmpeg');
      await expect(service.remove('c1')).rejects.toBeInstanceOf(ConflictException);
      expect(del).not.toHaveBeenCalled();

      service.registerUsageProbe('ffmpegExecutor', () => false);
      await service.remove('c1');
      expect(del).toHaveBeenCalledTimes(1);
      expect(service.list()).toEqual([]);
    });
  });

  describe('status()', () => {
    it('reports hasCredential and usage without ever exposing the credential', async () => {
      mockSelect([row({ credentialEncrypted: encryptString(SA_KEY) })]);
      mockWrite();
      db.execute.mockRejectedValue(new Error('relation "proxy_rules" does not exist'));
      const service = make();
      await service.reload();
      service.registerUsageProbe('ffmpegExecutor', () => true);

      const status = await service.status();
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({
        id: 'c1',
        name: 'ffmpeg',
        url: 'https://w.run.app',
        auth: 'google_id_token',
        hasCredential: true,
        maxInflight: 8,
        healthPath: '/health',
        envOnly: false,
        usedBy: { ffmpegExecutor: true, rules: 0 },
      });
      expect(status[0]).not.toHaveProperty('credential');
      expect(status[0]).not.toHaveProperty('credentialEncrypted');
      const json = JSON.stringify(status);
      expect(json).not.toContain('gserviceaccount');
      expect(json).not.toContain(SA_KEY);
    });

    it('counts the rules naming the connection, best-effort', async () => {
      mockSelect([row()]);
      mockWrite();
      db.execute.mockResolvedValue([{ n: 3 }]);
      const service = make();
      await service.reload();

      const status = await service.status();
      expect(status[0].usedBy).toEqual({ ffmpegExecutor: false, rules: 3 });
      expect(db.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('client()', () => {
    it('memoises per name + fingerprint and rebuilds after the url changes', async () => {
      mockSelect([row()]);
      const factory = fakeFactory(jest.fn());
      const service = make({}, factory as unknown as Factory);
      await service.reload();

      const conn = service.resolve('ffmpeg') as ResolvedConnection;
      const first = service.client(conn);
      expect(service.client(conn)).toBe(first);
      expect(factory).toHaveBeenCalledTimes(1);

      const second = service.client({ ...conn, url: 'https://moved.run.app' });
      expect(second).not.toBe(first);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  describe('test()', () => {
    const okProbe = () =>
      jest.fn(async () => ({ status: 200, ok: true, body: { version: '1.0.0' }, latencyMs: 5 }));

    it('probes the draft through the client factory and reports status, latency and version', async () => {
      mockSelect([]);
      const probe = okProbe();
      const factory = fakeFactory(probe);
      const service = make({}, factory as unknown as Factory);
      await service.reload();

      const res = await service.test({
        url: 'https://draft.run.app/',
        auth: 'none',
        healthPath: '/healthz',
      });
      expect(res).toMatchObject({
        ok: true,
        status: 200,
        latencyMs: 5,
        version: '1.0.0',
        credential: 'none',
      });
      expect(probe).toHaveBeenCalledWith({ path: '/healthz' });
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://draft.run.app' }),
      );
    });

    it('with an id and no credential falls back to the stored one and reports sa_key', async () => {
      mockSelect([row({ credentialEncrypted: encryptString(SA_KEY) })]);
      const probe = jest.fn(async () => ({ status: 200, ok: true, body: {}, latencyMs: 1 }));
      const factory = fakeFactory(probe);
      const service = make({}, factory as unknown as Factory);
      await service.reload();

      const res = await service.test({ id: 'c1' });
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://w.run.app', credential: SA_KEY }),
      );
      expect(res.credential).toBe('sa_key');
      expect(res.version).toBeUndefined();
      expect(res.ok).toBe(true);
    });

    it('reports adc when google_id_token has no credential', async () => {
      mockSelect([row()]);
      const factory = fakeFactory(okProbe());
      const service = make({}, factory as unknown as Factory);
      await service.reload();
      const res = await service.test({ name: 'ffmpeg' });
      expect(res.credential).toBe('adc');
    });

    it('a failed probe becomes ok:false with the error message', async () => {
      mockSelect([]);
      const probe = jest.fn(async () => {
        throw new Error('health request failed: connect ECONNREFUSED');
      });
      const factory = fakeFactory(probe);
      const service = make({}, factory as unknown as Factory);
      await service.reload();

      const res = await service.test({ url: 'https://draft.run.app', auth: 'none' });
      expect(res).toMatchObject({ ok: false, status: null, latencyMs: null });
      expect(res.error).toMatch(/ECONNREFUSED/);
    });

    it('a connection with no health path reports so without calling the remote', async () => {
      mockSelect([]);
      const factory = fakeFactory(okProbe());
      const service = make({}, factory as unknown as Factory);
      await service.reload();

      const res = await service.test({
        url: 'https://draft.run.app',
        auth: 'none',
        healthPath: null,
      });
      expect(res).toMatchObject({
        ok: false,
        status: null,
        latencyMs: null,
        error: 'no health path configured',
        credential: 'none',
      });
      expect(factory).not.toHaveBeenCalled();
    });

    it('a malformed credential fails through the same channel without quoting the key back', async () => {
      mockSelect([]);
      const factory = fakeFactory(okProbe());
      const service = make({}, factory as unknown as Factory);
      await service.reload();

      const secret = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----abc';
      const res = await service.test({
        url: 'https://draft.run.app',
        auth: 'google_id_token',
        credential: secret,
      });
      expect(res).toMatchObject({ ok: false, error: 'Credential must be valid JSON.' });
      expect(JSON.stringify(res)).not.toContain('BEGIN PRIVATE KEY');
      expect(JSON.stringify(res)).not.toContain(secret.slice(0, 30));
      expect(factory).not.toHaveBeenCalled();
    });
  });
});
