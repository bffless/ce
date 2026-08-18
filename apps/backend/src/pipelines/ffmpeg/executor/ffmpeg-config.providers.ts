import { Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RemoteConnectionsService } from '../../../remote-connections/remote-connections.service';
import { FfmpegExecutorSettingsService } from '../ffmpeg-executor-settings.service';
import { FFMPEG_CONFIG, FFMPEG_REMOTE_DEPS, type FfmpegRemoteDeps } from './ffmpeg-config.tokens';

/**
 * The effective-config providers, shared by PipelinesModule and the wiring spec
 * so there is one definition to get right.
 *
 * Resolved LAZILY through ModuleRef on purpose: the settings service holds an
 * @Optional() RemoteFfmpegExecutor (for Test connection) and the executor reads
 * its config from FFMPEG_REMOTE_DEPS, so `inject: [FfmpegExecutorSettingsService]`
 * would close a cycle Nest cannot instantiate — the module graph never finishes
 * compiling. Nothing calls these closures during construction, so deferring the
 * lookup to first use breaks the cycle without changing behaviour.
 */
export const FFMPEG_CONFIG_PROVIDERS: Provider[] = [
  {
    provide: FFMPEG_CONFIG,
    useFactory: (ref: ModuleRef) => () => ref.get(FfmpegExecutorSettingsService).resolved(),
    inject: [ModuleRef],
  },
  {
    provide: FFMPEG_REMOTE_DEPS,
    // `fuse` is a GETTER, not a value: reading it during factory execution would
    // resolve RemoteConnectionsService eagerly and defeat the laziness above.
    // `strict: false` because that provider lives in another module.
    useFactory: (ref: ModuleRef): FfmpegRemoteDeps => ({
      env: () => ref.get(FfmpegExecutorSettingsService).resolved(),
      get fuse() {
        return ref.get(RemoteConnectionsService, { strict: false }).fuse;
      },
    }),
    inject: [ModuleRef],
  },
];
