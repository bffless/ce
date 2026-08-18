/**
 * The module graph itself: the settings service holds an @Optional() remote
 * executor while the executor's config comes from a provider that needs the
 * settings service. Wired eagerly (`inject: [FfmpegExecutorSettingsService]`)
 * that is a cycle Nest never finishes compiling — this spec is the fence.
 *
 * Since Plan 4 the settings service also injects RemoteConnectionsService
 * directly (that module depends on nothing here) and the executor draws the
 * shared in-flight fuse off it, so both edges are exercised here too.
 */
jest.mock('../../db/client', () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn() },
}));

import { Test } from '@nestjs/testing';
import { STORAGE_ADAPTER } from '../../storage/storage.interface';
import { FfmpegCapabilityService } from './ffmpeg-capability.service';
import { FfmpegExecutorSettingsService } from './ffmpeg-executor-settings.service';
import { FFMPEG_CONFIG_PROVIDERS } from './executor/ffmpeg-config.providers';
import { FFMPEG_CONFIG, type FfmpegConfigResolver } from './executor/ffmpeg-config.tokens';
import { FfmpegExecutorSelector } from './executor/ffmpeg-executor.selector';
import { LocalFfmpegExecutor } from './executor/local-ffmpeg.executor';
import { RemoteFfmpegExecutor } from './executor/remote/remote-ffmpeg.executor';
import { RemoteConnectionsService } from '../../remote-connections/remote-connections.service';
import {
  REMOTE_CONNECTIONS,
  REMOTE_CONNECTIONS_PROVIDER,
  type RemoteConnectionsPort,
} from '../../remote-connections/remote-connections.tokens';

const storage = {
  getUrl: async () => 'https://bucket.example.com/x?sig=1',
  supportsPresignedUrls: () => true,
  getPresignedUploadUrl: async () => 'https://bucket.example.com/x?put=1',
};
const capability = {
  isAvailable: () => true,
  getVersion: () => 'ffmpeg version 6.1.1',
  isEnabled: async () => true,
  isFlagOn: async () => true,
  getOps: async () => [],
};

it('compiles the ffmpeg provider graph and resolves the effective config lazily', async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: STORAGE_ADAPTER, useValue: storage },
      { provide: FfmpegCapabilityService, useValue: capability },
      { provide: LocalFfmpegExecutor, useValue: { name: 'local' } },
      RemoteFfmpegExecutor,
      FfmpegExecutorSelector,
      FfmpegExecutorSettingsService,
      RemoteConnectionsService,
      REMOTE_CONNECTIONS_PROVIDER,
      ...FFMPEG_CONFIG_PROVIDERS,
    ],
  }).compile();

  const settings = moduleRef.get(FfmpegExecutorSettingsService);
  const remote = moduleRef.get(RemoteFfmpegExecutor);
  // The @Optional() back-edge is real, not silently dropped.
  expect((settings as unknown as { remote?: unknown }).remote).toBe(remote);
  // Both executors read the SAME resolved config the settings service serves.
  expect(moduleRef.get<FfmpegConfigResolver>(FFMPEG_CONFIG)()).toEqual(settings.resolved());
  expect((remote as unknown as { env: FfmpegConfigResolver }).env()).toEqual(settings.resolved());
  expect(moduleRef.get(FfmpegExecutorSelector).enabled()).toEqual(['local']);

  // The lazy connections port resolves without dragging the service into the
  // executors' construction path.
  const port = moduleRef.get<RemoteConnectionsPort>(REMOTE_CONNECTIONS);
  expect(typeof port.acquire).toBe('function');
  // The executor draws on the SHARED fuse, not a private counter — read the way
  // run() reads it, i.e. after the container is fully initialised.
  const connections = moduleRef.get(RemoteConnectionsService);
  expect((remote as unknown as { fuse: () => unknown }).fuse.call(remote)).toBe(connections.fuse);
}, 10_000);
