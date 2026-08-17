import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

jest.mock('../../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../db/client');

import { FfmpegExecutorSettingsService } from './ffmpeg-executor-settings.service';
import { encryptString, __resetKeyForTests } from '../../common/crypto/aes-gcm';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const SA_KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'x@p.iam.gserviceaccount.com',
});

/** A row as Drizzle would return it. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    localEnabled: true,
    remoteEnabled: false,
    remoteUrl: null,
    remoteAuth: 'google_id_token',
    saKeyEncrypted: null,
    defaultExecutor: 'local',
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedByUserId: null,
    ...over,
  };
}

/**
 * Stand-in for the single-row table: `select` reads it, the `update`/`insert`
 * mocks write to it, so a `reload()` after a save sees what was persisted.
 */
let table: Record<string, unknown>[] = [];

function mockSelect(rows: unknown[]) {
  table = rows as Record<string, unknown>[];
  db.select.mockReturnValue({
    from: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockImplementation(async () => table),
      }),
    }),
  });
}
function mockSelectThrows(err: Error) {
  db.select.mockReturnValue({
    from: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockRejectedValue(err) }),
    }),
  });
}

function make(
  o: {
    env?: NodeJS.ProcessEnv;
    presign?: boolean;
    localAvailable?: boolean;
    /** The RemoteFfmpegExecutor stand-in — only testConnection() needs one. */
    remote?: unknown;
  } = {},
) {
  // `presign: false` = the local-filesystem adapter, which DOES sign — its URLs
  // just point at CE's own route, so a Worker cannot use them. resolveLocalAdapter()
  // keys off the `isLocalAdapter` marker (storage/local.adapter.ts), not the shape.
  const storage =
    o.presign === false
      ? {
          isLocalAdapter: true,
          getUrl: async () => '/api/storage/local/x',
          supportsPresignedUrls: () => true,
          getPresignedUploadUrl: async () => '/api/storage/presigned/local?key=x',
        }
      : {
          getUrl: async () => 'https://bucket.example.com/x?sig=1',
          supportsPresignedUrls: () => true,
          getPresignedUploadUrl: async () => 'https://bucket.example.com/x?put=1',
        };
  const capability = {
    isAvailable: () => o.localAvailable ?? true,
    getVersion: () => ((o.localAvailable ?? true) ? 'ffmpeg version 6.1.1' : null),
  };
  const service = new FfmpegExecutorSettingsService(
    storage as never,
    capability as never,
    () => o.env ?? {},
    o.remote as never,
  );
  return { service, storage, capability };
}

describe('FfmpegExecutorSettingsService', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY;
    __resetKeyForTests();
    jest.clearAllMocks();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    __resetKeyForTests();
  });

  describe('resolved()', () => {
    it('with no row behaves exactly like readFfmpegEnv (Plan 1 semantics)', async () => {
      mockSelect([]);
      const { service } = make({ env: { FFMPEG_REMOTE_URL: 'https://w.example.com' } });
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.localEnabled).toBe(true);
      expect(cfg.remoteEnabled).toBe(true);
      expect(cfg.remoteUrl).toBe('https://w.example.com');
      expect(cfg.executor).toBe('local');
    });

    it('DB row fills fields env leaves unset; the SA key is decrypted into memory', async () => {
      mockSelect([
        row({
          localEnabled: false,
          remoteEnabled: true,
          remoteUrl: 'https://db.example.com/',
          remoteAuth: 'none',
          saKeyEncrypted: encryptString(SA_KEY),
          defaultExecutor: 'remote',
        }),
      ]);
      const { service } = make();
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.localEnabled).toBe(false);
      expect(cfg.remoteEnabled).toBe(true);
      expect(cfg.remoteUrl).toBe('https://db.example.com'); // trailing slash stripped like env
      expect(cfg.remoteAuth).toBe('none');
      expect(cfg.remoteSaKeyJson).toBe(SA_KEY);
      expect(cfg.executor).toBe('remote');
    });

    it('env wins per field, and FFMPEG_REMOTE_URL forces remoteEnabled', async () => {
      mockSelect([
        row({
          remoteEnabled: false,
          remoteUrl: 'https://db.example.com',
          remoteAuth: 'none',
          defaultExecutor: 'remote',
          saKeyEncrypted: encryptString(SA_KEY),
        }),
      ]);
      const { service } = make({
        env: {
          FFMPEG_EXECUTOR: 'local',
          FFMPEG_REMOTE_URL: 'https://env.example.com',
          FFMPEG_REMOTE_AUTH: 'google_id_token',
          FFMPEG_REMOTE_SA_KEY_JSON: '{"type":"service_account","env":true}',
        },
      });
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.executor).toBe('local');
      expect(cfg.remoteEnabled).toBe(true);
      expect(cfg.remoteUrl).toBe('https://env.example.com');
      expect(cfg.remoteAuth).toBe('google_id_token');
      expect(cfg.remoteSaKeyJson).toBe('{"type":"service_account","env":true}');
      expect(service.envManaged()).toEqual({
        defaultExecutor: true,
        remoteUrl: true,
        remoteAuth: true,
        saKey: true,
      });
    });

    it("'' env values count as unset (compose passthrough)", async () => {
      mockSelect([
        row({
          remoteEnabled: true,
          remoteUrl: 'https://db.example.com',
          defaultExecutor: 'remote',
        }),
      ]);
      const { service } = make({
        env: {
          FFMPEG_EXECUTOR: '',
          FFMPEG_REMOTE_URL: '',
          FFMPEG_REMOTE_AUTH: '',
          FFMPEG_REMOTE_SA_KEY_JSON: '',
        },
      });
      await service.reload();
      expect(service.resolved().remoteUrl).toBe('https://db.example.com');
      expect(service.envManaged()).toEqual({
        defaultExecutor: false,
        remoteUrl: false,
        remoteAuth: false,
        saKey: false,
      });
    });

    it('a missing table (pre-migration boot) is tolerated: env-only, no throw', async () => {
      mockSelectThrows(new Error('relation "ffmpeg_executor_settings" does not exist'));
      const { service } = make();
      await expect(service.reload()).resolves.toBeUndefined();
      expect(service.resolved().localEnabled).toBe(true);
    });

    it('an undecryptable key is treated as absent (does not poison the config)', async () => {
      mockSelect([row({ saKeyEncrypted: 'not-a-ciphertext' })]);
      const { service } = make();
      await service.reload();
      expect(service.resolved().remoteSaKeyJson).toBeNull();
    });
  });

  describe('getStatus()', () => {
    it('never includes the key; reports source + envManaged + storagePresignable', async () => {
      mockSelect([
        row({
          remoteEnabled: true,
          remoteUrl: 'https://db.example.com',
          saKeyEncrypted: encryptString(SA_KEY),
        }),
      ]);
      const { service } = make();
      await service.reload();
      const status = await service.getStatus();
      expect(JSON.stringify(status)).not.toContain('service_account');
      expect(status).toEqual({
        localAvailable: true,
        localVersion: 'ffmpeg version 6.1.1',
        localEnabled: true,
        remoteEnabled: true,
        remoteUrl: 'https://db.example.com',
        remoteAuth: 'google_id_token',
        hasSaKey: true,
        saKeySource: 'db',
        defaultExecutor: 'local',
        storagePresignable: true,
        envManaged: { defaultExecutor: false, remoteUrl: false, remoteAuth: false, saKey: false },
      });
    });

    it("saKeySource is 'env' when FFMPEG_REMOTE_SA_KEY_JSON is set, storagePresignable false on local-FS", async () => {
      mockSelect([]);
      const { service, storage } = make({
        env: { FFMPEG_REMOTE_SA_KEY_JSON: SA_KEY },
        presign: false,
      });
      await service.reload();
      const status = await service.getStatus();
      expect(status.hasSaKey).toBe(true);
      expect(status.saKeySource).toBe('env');
      // The local adapter advertises presigning; being LOCAL is what disqualifies it.
      expect(storage.supportsPresignedUrls?.()).toBe(true);
      expect(status.storagePresignable).toBe(false);
    });
  });

  describe('update()', () => {
    function mockWrite() {
      const set = jest.fn().mockImplementation((patch: Record<string, unknown>) => ({
        where: jest.fn().mockImplementation(async () => {
          table = [{ ...table[0], ...patch }];
        }),
      }));
      db.update.mockReturnValue({ set });
      const values = jest.fn().mockImplementation(async (vals: Record<string, unknown>) => {
        table = [{ ...row(), ...vals }];
      });
      db.insert.mockReturnValue({ values });
      return { set, values };
    }

    it('inserts when no row exists, encrypts the key, refreshes the cache and returns status', async () => {
      mockSelect([]);
      const { values } = mockWrite();
      const { service } = make();
      await service.reload();
      // After the write, reload() re-reads: return the row the write produced.
      const status = await service
        .update(
          {
            remoteEnabled: true,
            remoteUrl: 'https://w.example.com/',
            remoteAuth: 'google_id_token',
            defaultExecutor: 'remote',
            saKeyJson: SA_KEY,
          },
          'user-1',
        )
        .catch((e) => {
          throw e;
        });
      expect(values).toHaveBeenCalledTimes(1);
      const inserted = values.mock.calls[0][0];
      expect(inserted.remoteUrl).toBe('https://w.example.com');
      expect(inserted.saKeyEncrypted).not.toContain('service_account');
      expect(inserted.updatedByUserId).toBe('user-1');
      expect(status.hasSaKey).toBe(true);
      expect(status.defaultExecutor).toBe('remote');
      expect(service.resolved().remoteSaKeyJson).toBe(SA_KEY);
    });

    it('updates the existing row; saKeyJson undefined keeps the stored key, null clears it', async () => {
      const stored = encryptString(SA_KEY);
      mockSelect([
        row({ remoteEnabled: true, remoteUrl: 'https://w.example.com', saKeyEncrypted: stored }),
      ]);
      const { set } = mockWrite();
      const { service } = make();
      await service.reload();

      await service.update({ remoteAuth: 'none' });
      expect(set.mock.calls[0][0]).not.toHaveProperty('saKeyEncrypted');
      expect(service.resolved().remoteSaKeyJson).toBe(SA_KEY);

      await service.update({ saKeyJson: null });
      expect(set.mock.calls[1][0].saKeyEncrypted).toBeNull();
      expect(service.resolved().remoteSaKeyJson).toBeNull();
    });

    it('rejects: remote on without URL / bad URL / http with google_id_token / non-service-account key / default not enabled', async () => {
      mockSelect([]);
      mockWrite();
      const { service } = make();
      await service.reload();
      await expect(service.update({ remoteEnabled: true, remoteUrl: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.update({ remoteEnabled: true, remoteUrl: 'not a url' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update({
          remoteEnabled: true,
          remoteUrl: 'http://w.example.com',
          remoteAuth: 'google_id_token',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update({ saKeyJson: '{"type":"authorized_user"}' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update({ saKeyJson: '{not json' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.update({ defaultExecutor: 'remote' })).rejects.toBeInstanceOf(
        BadRequestException,
      ); // remote not enabled
      await expect(service.update({ localEnabled: false })).rejects.toBeInstanceOf(
        BadRequestException,
      ); // default 'local' would not be enabled
    });

    it('http URL is fine with auth none; refuses Remote on non-presignable storage; refuses editing env-managed fields', async () => {
      mockSelect([]);
      mockWrite();
      const ok = make();
      await ok.service.reload();
      await expect(
        ok.service.update({
          remoteEnabled: true,
          remoteUrl: 'http://ffmpeg-worker:8080',
          remoteAuth: 'none',
        }),
      ).resolves.toBeDefined();

      const localFs = make({ presign: false });
      await localFs.service.reload();
      await expect(
        localFs.service.update({ remoteEnabled: true, remoteUrl: 'https://w.example.com' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const pinned = make({ env: { FFMPEG_REMOTE_URL: 'https://env.example.com' } });
      await pinned.service.reload();
      await expect(
        pinned.service.update({ remoteUrl: 'https://other.example.com' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const pinnedAuth = make({ env: { FFMPEG_REMOTE_AUTH: 'none' } });
      await pinnedAuth.service.reload();
      await expect(pinnedAuth.service.update({ remoteAuth: 'none' })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const pinnedKey = make({ env: { FFMPEG_REMOTE_SA_KEY_JSON: SA_KEY } });
      await pinnedKey.service.reload();
      await expect(pinnedKey.service.update({ saKeyJson: SA_KEY })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const pinnedDefault = make({ env: { FFMPEG_EXECUTOR: 'local' } });
      await pinnedDefault.service.reload();
      await expect(
        pinnedDefault.service.update({ defaultExecutor: 'local' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("saKeyJson '' clears the stored key (a blanked UI field is not a JSON error)", async () => {
      mockSelect([row({ saKeyEncrypted: encryptString(SA_KEY) })]);
      const { set } = mockWrite();
      const { service } = make();
      await service.reload();

      await service.update({ saKeyJson: '   ' });
      expect(set.mock.calls[0][0].saKeyEncrypted).toBeNull();
      expect(service.resolved().remoteSaKeyJson).toBeNull();
    });

    it('refuses to save while the row could not be loaded — never merges onto defaults', async () => {
      mockSelectThrows(new Error('relation "ffmpeg_executor_settings" does not exist'));
      const { set, values } = mockWrite();
      const { service } = make();
      await service.reload();

      await expect(service.update({ localEnabled: true })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(values).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it('a non-Remote save is not blocked by local-FS storage when FFMPEG_REMOTE_URL pins Remote on', async () => {
      mockSelect([row({ localEnabled: true })]);
      const { set } = mockWrite();
      const localFs = make({
        presign: false,
        env: { FFMPEG_REMOTE_URL: 'https://env.example.com' },
      });
      await localFs.service.reload();

      const status = await localFs.service.update({ localEnabled: true });
      expect(set).toHaveBeenCalledTimes(1);
      expect(status.storagePresignable).toBe(false);
    });
  });

  describe('testConnection()', () => {
    const HEALTH = {
      ok: true,
      version: '0.4.31',
      ffmpeg: 'ffmpeg version 6.1.1',
      ops: ['probe', 'extract_audio', 'slice', 'concat'],
      uptimeS: 12,
    };
    function makeWithRemote(
      o: {
        health?: () => Promise<unknown>;
        readiness?: { ok: boolean; reason?: string };
        env?: NodeJS.ProcessEnv;
      } = {},
    ) {
      const remote = {
        testConnection: jest.fn(async (_overrides?: Record<string, unknown>) =>
          o.health ? o.health() : HEALTH,
        ),
        ready: jest.fn(
          async (_opts?: Record<string, unknown>) => o.readiness ?? { ok: true, version: '0.4.31' },
        ),
      };
      const { service } = make({ env: o.env, remote });
      return { service, remote };
    }

    it('returns worker health + latency + readiness; credential=adc when no key stored', async () => {
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://w.example.com' })]);
      const { service, remote } = makeWithRemote();
      await service.reload();
      const res = await service.testConnection();
      expect(res.ok).toBe(true);
      expect(res.worker?.version).toBe('0.4.31');
      expect(res.worker?.ops).toContain('slice');
      expect(typeof res.latencyMs).toBe('number');
      expect(res.readiness).toEqual({ ok: true });
      expect(res.credential).toBe('adc');
      expect(remote.ready).toHaveBeenCalledWith(expect.objectContaining({ fresh: true }));
    });

    it('draft overrides reach the executor; env-managed fields cannot be overridden; credential reflects the draft key', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote({ env: { FFMPEG_REMOTE_AUTH: 'none' } });
      await service.reload();
      const res = await service.testConnection({
        remoteUrl: 'https://draft.example.com',
        remoteAuth: 'google_id_token',
        saKeyJson: SA_KEY,
      });
      expect(remote.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteUrl: 'https://draft.example.com',
          remoteSaKeyJson: SA_KEY,
        }),
      );
      expect(remote.testConnection.mock.calls[0][0]).not.toHaveProperty('remoteAuth'); // pinned by env
      expect(res.credential).toBe('none'); // effective auth is env's 'none'
    });

    it('unreachable worker → ok:false with error, latency null, readiness reason passed through', async () => {
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://w.example.com' })]);
      const { service } = makeWithRemote({
        health: async () => {
          throw new Error('worker unreachable: connect ECONNREFUSED');
        },
        readiness: { ok: false, reason: 'worker unreachable: connect ECONNREFUSED' },
      });
      await service.reload();
      const res = await service.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/ECONNREFUSED/);
      expect(res.latencyMs).toBeNull();
      expect(res.readiness.reason).toMatch(/ECONNREFUSED/);
      expect(res.worker).toBeUndefined();
    });

    it('a malformed draft key fails through the same channel, without quoting the key back', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote();
      await service.reload();
      const secret = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----abc';
      const res = await service.testConnection({ saKeyJson: secret });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Service-account key must be valid JSON.');
      expect(res.readiness).toEqual({
        ok: false,
        reason: 'Service-account key must be valid JSON.',
      });
      expect(res.latencyMs).toBeNull();
      expect(res.credential).toBe('sa_key');
      expect(JSON.stringify(res)).not.toContain('BEGIN PRIVATE KEY');
      expect(JSON.stringify(res)).not.toContain(secret.slice(0, 30));
      expect(remote.testConnection).not.toHaveBeenCalled();
      expect(remote.ready).not.toHaveBeenCalled();
    });

    it('a malformed env-pinned key fails through the same channel, without quoting the key back, and never calls the executor', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote({
        env: { FFMPEG_REMOTE_SA_KEY_JSON: '{not json -----BEGIN PRIVATE KEY-----' },
      });
      await service.reload();
      const res = await service.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Service-account key must be valid JSON.');
      expect(res.readiness).toEqual({
        ok: false,
        reason: 'Service-account key must be valid JSON.',
      });
      expect(JSON.stringify(res)).not.toContain('BEGIN PRIVATE KEY');
      expect(remote.testConnection).not.toHaveBeenCalled();
      expect(remote.ready).not.toHaveBeenCalled();
    });

    it('credential=sa_key when a key is stored in the DB, and the key never reaches the result', async () => {
      mockSelect([
        row({
          remoteEnabled: true,
          remoteUrl: 'https://w.example.com',
          saKeyEncrypted: encryptString(SA_KEY),
        }),
      ]);
      const { service } = makeWithRemote();
      await service.reload();
      const res = await service.testConnection();
      expect(res.credential).toBe('sa_key');
      expect(JSON.stringify(res)).not.toContain('gserviceaccount');
    });

    it('without a wired remote executor it fails loudly instead of reporting a healthy worker', async () => {
      mockSelect([]);
      const { service } = make();
      await service.reload();
      await expect(service.testConnection()).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
