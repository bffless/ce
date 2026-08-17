import { Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FfmpegExecutorSettingsService } from '../ffmpeg-executor-settings.service';
import { FFMPEG_CONFIG, FFMPEG_REMOTE_DEPS } from './ffmpeg-config.tokens';

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
    useFactory: (ref: ModuleRef) => ({
      env: () => ref.get(FfmpegExecutorSettingsService).resolved(),
    }),
    inject: [ModuleRef],
  },
];
