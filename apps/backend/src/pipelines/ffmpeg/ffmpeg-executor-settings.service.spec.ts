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
import { __resetKeyForTests } from '../../common/crypto/aes-gcm';
import { InflightFuse } from '../../remote-connections/fuse';
import type { ResolvedConnection } from '../../remote-connections/remote-connections.types';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const SA_KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'x@p.iam.gserviceaccount.com',
});

/** A resolved connection as RemoteConnectionsService.list() would hand one back. */
function conn(over: Partial<ResolvedConnection> = {}): ResolvedConnection {
  const source: ResolvedConnection['source'] = {
    url: 'db',
    auth: 'db',
    credential: 'db',
    maxInflight: 'db',
    healthPath: 'db',
    envOnly: false,
    ...(over.source ?? {}),
  };
  return {
    id: 'c1',
    name: 'ffmpeg',
    url: 'https://w.run.app',
    auth: 'google_id_token',
    credential: SA_KEY,
    maxInflight: 8,
    healthPath: '/health',
    ...over,
    source,
  };
}

/** A row as Drizzle would return it. The remote_url/auth/sa_key columns are deprecated (Plan 4) and must be ignored. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    localEnabled: true,
    remoteEnabled: false,
    remoteUrl: 'https://legacy.example.com',
    remoteAuth: 'none',
    saKeyEncrypted: 'legacy-ciphertext',
    remoteConnectionId: null,
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
    /** What RemoteConnectionsService would resolve on this instance. */
    connections?: ResolvedConnection[];
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
  const list = o.connections ?? [];
  const connections = {
    list: () => list,
    resolve: (n: string) => list.find((c) => c.name === n) ?? null,
    byId: (id: string) => list.find((c) => c.id === id) ?? null,
    registerUsageProbe: jest.fn(),
    fuse: new InflightFuse(),
  };
  const service = new FfmpegExecutorSettingsService(
    storage as never,
    capability as never,
    connections as never,
    () => o.env ?? {},
    o.remote as never,
  );
  return { service, storage, capability, connections };
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
    it('with no row and no connection selected: Remote is off and nothing remote is derived', async () => {
      mockSelect([]);
      const { service } = make();
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.localEnabled).toBe(true);
      expect(cfg.remoteEnabled).toBe(false);
      expect(cfg.remoteConnection).toBeNull();
      expect(cfg.remoteUrl).toBeNull();
      expect(cfg.remoteSaKeyJson).toBeNull();
      expect(cfg.remoteMaxInflight).toBe(8);
      expect(cfg.executor).toBe('local');
    });

    it('a row pointing at a connection derives url/auth/credential/maxInflight from it', async () => {
      mockSelect([
        row({ remoteEnabled: true, remoteConnectionId: 'c1', defaultExecutor: 'remote' }),
      ]);
      const { service } = make({ connections: [conn({ maxInflight: 8 })] });
      await service.reload();
      expect(service.resolved()).toMatchObject({
        remoteEnabled: true,
        remoteConnection: 'ffmpeg',
        remoteUrl: 'https://w.run.app',
        remoteAuth: 'google_id_token',
        remoteSaKeyJson: SA_KEY,
        remoteMaxInflight: 8,
        executor: 'remote',
      });
      // The deprecated columns on the row are never read.
      expect(service.resolved().remoteUrl).not.toBe('https://legacy.example.com');
    });

    it("auth 'none' on the connection carries through", async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const { service } = make({
        connections: [conn({ auth: 'none', credential: null, maxInflight: 2 })],
      });
      await service.reload();
      expect(service.resolved()).toMatchObject({
        remoteAuth: 'none',
        remoteSaKeyJson: null,
        remoteMaxInflight: 2,
      });
    });

    it('a dangling remoteConnectionId (the connection was deleted) leaves Remote off', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'gone' })]);
      const { service } = make({ connections: [conn()] });
      await service.reload();
      expect(service.resolved().remoteEnabled).toBe(false);
      expect(service.resolved().remoteConnection).toBeNull();
      expect((await service.getStatus()).remoteConnection).toBeNull();
    });

    it('FFMPEG_REMOTE_URL pins the connection named ffmpeg regardless of the row, and forces Remote on', async () => {
      mockSelect([row({ remoteEnabled: false, remoteConnectionId: null })]);
      const { service } = make({
        env: { FFMPEG_REMOTE_URL: 'https://env.example.com' },
        connections: [conn({ id: null, source: { envOnly: true } as never })],
      });
      await service.reload();
      expect(service.resolved()).toMatchObject({
        remoteConnection: 'ffmpeg',
        remoteEnabled: true,
        remoteUrl: 'https://w.run.app',
      });
      expect(service.envManaged()).toEqual({ defaultExecutor: false, remoteConnection: true });
    });

    it('FFMPEG_REMOTE_CONNECTION selects by name and is env-managed', async () => {
      mockSelect([row({ remoteEnabled: false, remoteConnectionId: 'c1' })]);
      const { service } = make({
        env: { FFMPEG_REMOTE_CONNECTION: 'pdf' },
        connections: [conn(), conn({ id: 'c2', name: 'pdf', url: 'https://pdf.run.app' })],
      });
      await service.reload();
      expect(service.resolved()).toMatchObject({
        remoteConnection: 'pdf',
        remoteUrl: 'https://pdf.run.app',
        remoteEnabled: true,
      });
      expect(service.envManaged().remoteConnection).toBe(true);
    });

    it("'' env values count as unset (compose passthrough)", async () => {
      mockSelect([
        row({ remoteEnabled: true, remoteConnectionId: 'c1', defaultExecutor: 'remote' }),
      ]);
      const { service } = make({
        env: { FFMPEG_EXECUTOR: '', FFMPEG_REMOTE_URL: '', FFMPEG_REMOTE_CONNECTION: '' },
        connections: [conn()],
      });
      await service.reload();
      expect(service.resolved().remoteConnection).toBe('ffmpeg');
      expect(service.resolved().executor).toBe('remote');
      expect(service.envManaged()).toEqual({ defaultExecutor: false, remoteConnection: false });
    });

    it('a missing table (pre-migration boot) is tolerated: env-only, no throw', async () => {
      mockSelectThrows(new Error('relation "ffmpeg_executor_settings" does not exist'));
      const { service } = make();
      await expect(service.reload()).resolves.toBeUndefined();
      expect(service.resolved().localEnabled).toBe(true);
    });
  });

  describe('getStatus()', () => {
    it('reports the selected connection + the dropdown list + envManaged, and never the credential', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const { service } = make({ connections: [conn()] });
      await service.reload();
      const status = await service.getStatus();
      expect(JSON.stringify(status)).not.toContain('service_account');
      expect(JSON.stringify(status)).not.toContain('gserviceaccount');
      expect(status).toEqual({
        localAvailable: true,
        localVersion: 'ffmpeg version 6.1.1',
        localEnabled: true,
        remoteEnabled: true,
        remoteConnection: {
          id: 'c1',
          name: 'ffmpeg',
          url: 'https://w.run.app',
          auth: 'google_id_token',
          hasCredential: true,
          credentialSource: 'db',
          envOnly: false,
        },
        connections: [{ id: 'c1', name: 'ffmpeg', auth: 'google_id_token', envOnly: false }],
        defaultExecutor: 'local',
        storagePresignable: true,
        envManaged: { defaultExecutor: false, remoteConnection: false },
      });
    });

    it('an env-only connection reports envOnly + credentialSource env; storagePresignable false on local-FS', async () => {
      mockSelect([]);
      const { service, storage } = make({
        presign: false,
        env: { FFMPEG_REMOTE_URL: 'https://env.example.com' },
        connections: [
          conn({
            id: null,
            source: { credential: 'env', envOnly: true } as never,
          }),
        ],
      });
      await service.reload();
      const status = await service.getStatus();
      expect(status.remoteConnection).toMatchObject({
        id: null,
        envOnly: true,
        hasCredential: true,
        credentialSource: 'env',
      });
      expect(status.connections).toEqual([
        { id: null, name: 'ffmpeg', auth: 'google_id_token', envOnly: true },
      ]);
      // The local adapter advertises presigning; being LOCAL is what disqualifies it.
      expect(storage.supportsPresignedUrls?.()).toBe(true);
      expect(status.storagePresignable).toBe(false);
    });

    it('remoteConnection is null when nothing is selected', async () => {
      mockSelect([]);
      const { service } = make({ connections: [conn()] });
      await service.reload();
      const status = await service.getStatus();
      expect(status.remoteConnection).toBeNull();
      expect(status.remoteEnabled).toBe(false);
      expect(status.connections).toHaveLength(1);
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

    it('inserts the connection FK (never a URL or a key), refreshes the cache and returns status', async () => {
      mockSelect([]);
      const { values } = mockWrite();
      const { service } = make({ connections: [conn()] });
      await service.reload();
      const status = await service.update(
        { remoteEnabled: true, remoteConnection: 'ffmpeg', defaultExecutor: 'remote' },
        'user-1',
      );
      expect(values).toHaveBeenCalledTimes(1);
      const inserted = values.mock.calls[0][0];
      expect(inserted.remoteConnectionId).toBe('c1');
      expect(inserted).not.toHaveProperty('remoteUrl');
      expect(inserted).not.toHaveProperty('saKeyEncrypted');
      expect(inserted.updatedByUserId).toBe('user-1');
      expect(status.remoteConnection?.name).toBe('ffmpeg');
      expect(status.defaultExecutor).toBe('remote');
      expect(service.resolved().remoteSaKeyJson).toBe(SA_KEY);
    });

    it('remoteConnection null clears the selection (and switches Remote off with it)', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const { set } = mockWrite();
      const { service } = make({ connections: [conn()] });
      await service.reload();
      const status = await service.update({ remoteEnabled: false, remoteConnection: null });
      expect(set.mock.calls[0][0].remoteConnectionId).toBeNull();
      expect(status.remoteConnection).toBeNull();
      expect(service.resolved().remoteEnabled).toBe(false);
    });

    it('rejects an unknown connection name', async () => {
      mockSelect([]);
      mockWrite();
      const { service } = make({ connections: [conn()] });
      await service.reload();
      await expect(service.update({ remoteConnection: 'nope' })).rejects.toThrow(
        /Unknown remote connection 'nope'/,
      );
      await expect(service.update({ remoteConnection: 'nope' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an env-only connection: it has no row to point the FK at', async () => {
      mockSelect([]);
      mockWrite();
      const { service } = make({
        connections: [conn({ id: null, source: { envOnly: true } as never })],
      });
      await service.reload();
      await expect(service.update({ remoteConnection: 'ffmpeg' })).rejects.toThrow(
        /FFMPEG_REMOTE_CONNECTION/,
      );
    });

    it('refuses to edit the connection while FFMPEG_REMOTE_URL / FFMPEG_REMOTE_CONNECTION pins it', async () => {
      mockSelect([]);
      mockWrite();
      const pinnedUrl = make({
        env: { FFMPEG_REMOTE_URL: 'https://env.example.com' },
        connections: [conn()],
      });
      await pinnedUrl.service.reload();
      await expect(pinnedUrl.service.update({ remoteConnection: 'ffmpeg' })).rejects.toThrow(
        /FFMPEG_REMOTE_CONNECTION \/ FFMPEG_REMOTE_URL/,
      );

      const pinnedName = make({
        env: { FFMPEG_REMOTE_CONNECTION: 'ffmpeg' },
        connections: [conn()],
      });
      await pinnedName.service.reload();
      await expect(pinnedName.service.update({ remoteConnection: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const pinnedDefault = make({ env: { FFMPEG_EXECUTOR: 'local' }, connections: [conn()] });
      await pinnedDefault.service.reload();
      await expect(
        pinnedDefault.service.update({ defaultExecutor: 'local' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects Remote on with no connection, and a default executor that is not enabled', async () => {
      mockSelect([]);
      mockWrite();
      const { service } = make({ connections: [] });
      await service.reload();
      await expect(service.update({ remoteEnabled: true })).rejects.toThrow(
        /Remote executor needs a connection/,
      );
      await expect(service.update({ defaultExecutor: 'remote' })).rejects.toBeInstanceOf(
        BadRequestException,
      ); // remote not enabled
      await expect(service.update({ localEnabled: false })).rejects.toBeInstanceOf(
        BadRequestException,
      ); // default 'local' would not be enabled
      await expect(service.update({ defaultExecutor: 'cloud' as never })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses Remote on non-presignable (local-FS) storage', async () => {
      mockSelect([]);
      mockWrite();
      const localFs = make({ presign: false, connections: [conn()] });
      await localFs.service.reload();
      await expect(
        localFs.service.update({ remoteEnabled: true, remoteConnection: 'ffmpeg' }),
      ).rejects.toThrow(/bucket storage/);
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
        connections: [conn({ id: null, source: { envOnly: true } as never })],
      });
      await localFs.service.reload();

      const status = await localFs.service.update({ localEnabled: true });
      expect(set).toHaveBeenCalledTimes(1);
      expect(status.storagePresignable).toBe(false);
    });
  });

  describe('registerUsage()', () => {
    it('tells the connections service which connection the Remote executor is on', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const { service, connections } = make({ connections: [conn()] });
      await service.reload();
      service.registerUsage();
      expect(connections.registerUsageProbe).toHaveBeenCalledWith(
        'ffmpegExecutor',
        expect.any(Function),
      );
      const probe = connections.registerUsageProbe.mock.calls[0][1] as (n: string) => boolean;
      expect(probe('ffmpeg')).toBe(true);
      expect(probe('pdf')).toBe(false);
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
        connections?: ResolvedConnection[];
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
      const { service } = make({ env: o.env, remote, connections: o.connections });
      return { service, remote };
    }

    it('returns worker health + latency + readiness for the saved connection', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const { service, remote } = makeWithRemote({
        connections: [conn({ credential: null })],
      });
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

    it('a draft connection is resolved into url/auth/credential overrides for the executor', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote({
        connections: [conn(), conn({ id: 'c2', name: 'pdf', url: 'https://pdf.run.app' })],
      });
      await service.reload();
      const res = await service.testConnection({ remoteConnection: 'pdf' });
      expect(remote.testConnection).toHaveBeenCalledWith({
        remoteUrl: 'https://pdf.run.app',
        remoteAuth: 'google_id_token',
        remoteSaKeyJson: SA_KEY,
      });
      expect(remote.ready).toHaveBeenCalledWith(
        expect.objectContaining({
          fresh: true,
          env: expect.objectContaining({ remoteUrl: 'https://pdf.run.app' }),
        }),
      );
      expect(res.credential).toBe('sa_key');
      expect(JSON.stringify(res)).not.toContain('gserviceaccount');
    });

    it('an env-pinned connection cannot be overridden by a draft', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote({
        env: { FFMPEG_REMOTE_CONNECTION: 'ffmpeg' },
        connections: [conn(), conn({ id: 'c2', name: 'pdf', url: 'https://pdf.run.app' })],
      });
      await service.reload();
      await service.testConnection({ remoteConnection: 'pdf' });
      expect(remote.testConnection).toHaveBeenCalledWith({});
    });

    it('an unknown draft connection is refused', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote({ connections: [conn()] });
      await service.reload();
      await expect(service.testConnection({ remoteConnection: 'nope' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(remote.testConnection).not.toHaveBeenCalled();
    });

    it('unreachable worker → ok:false with error, latency null, readiness reason passed through', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const { service } = makeWithRemote({
        connections: [conn()],
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

    it('a malformed credential fails through the same channel, without quoting the key back', async () => {
      mockSelect([row({ remoteEnabled: true, remoteConnectionId: 'c1' })]);
      const secret = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----abc';
      const { service, remote } = makeWithRemote({
        connections: [conn({ credential: secret })],
      });
      await service.reload();
      const res = await service.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toBe('The connection credential must be valid JSON.');
      expect(res.readiness).toEqual({
        ok: false,
        reason: 'The connection credential must be valid JSON.',
      });
      expect(res.latencyMs).toBeNull();
      expect(res.credential).toBe('sa_key');
      expect(JSON.stringify(res)).not.toContain('BEGIN PRIVATE KEY');
      expect(JSON.stringify(res)).not.toContain(secret.slice(0, 30));
      expect(remote.testConnection).not.toHaveBeenCalled();
      expect(remote.ready).not.toHaveBeenCalled();
    });

    it('without a wired remote executor it fails loudly instead of reporting a healthy worker', async () => {
      mockSelect([]);
      const { service } = make({ connections: [conn()] });
      await service.reload();
      await expect(service.testConnection()).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
