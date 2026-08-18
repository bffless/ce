import type { InflightFuse } from '../../../remote-connections/fuse';
import type { FfmpegEnvConfig } from '../ffmpeg-env';

/**
 * DI tokens through which the executors receive the EFFECTIVE ffmpeg config —
 * env merged over the admin-saved DB row (FfmpegExecutorSettingsService.resolved()).
 * Both are @Optional() at the injection sites and default to plain readFfmpegEnv(),
 * so unit tests and older wiring keep working unchanged.
 */
export const FFMPEG_CONFIG = Symbol('FFMPEG_CONFIG');
export type FfmpegConfigResolver = () => FfmpegEnvConfig;

export const FFMPEG_REMOTE_DEPS = Symbol('FFMPEG_REMOTE_DEPS');
export interface FfmpegRemoteDeps {
  env?: FfmpegConfigResolver;
  /**
   * The process-wide per-connection in-flight counter (spec D5). Shared with
   * every other consumer of the same connection (remote_request steps), so the
   * cap is a property of the CONNECTION, not of this executor object.
   */
  fuse?: InflightFuse;
}
