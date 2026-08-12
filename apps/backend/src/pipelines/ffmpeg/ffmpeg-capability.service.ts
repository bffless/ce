import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

const execFileAsync = promisify(execFile);

/** Flag key: DB > file > env > default-OFF (see FLAG_DEFINITIONS) — the operator's per-instance policy. */
export const SERVER_VIDEO_OPS_FLAG = 'FFMPEG_HANDLER_ENABLED';

/**
 * Boot-time capability probe: ffmpeg + ffprobe both present → server video ops
 * capability. Missing binaries are normal (local dev without ffmpeg, minimal
 * images) — degrade silently to unavailable, warn once, never block boot.
 * Mirrors EdgeBlocklistService's ENOENT tolerance (domains/edge-blocklist.service.ts).
 *
 * Enablement is opt-in: even with both binaries present, `isEnabled()` stays
 * false until the operator turns on the SERVER_VIDEO_OPS_FLAG feature flag
 * (default off). This is a policy switch only — it must never read memory or
 * other resource state; per-job memory/disk pre-flights enforce that separately.
 */
@Injectable()
export class FfmpegCapabilityService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegCapabilityService.name);
  private available = false;
  private version: string | null = null;

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.probe();
  }

  async probe(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-version']);
      await execFileAsync('ffprobe', ['-version']);
      this.version = stdout.split('\n')[0]?.trim() || null;
      this.available = true;
      this.logger.log({ event: 'ffmpeg_capability', available: true, version: this.version });
    } catch (error) {
      this.available = false;
      this.version = null;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.logger.warn(
          'ffmpeg/ffprobe not found — server video ops disabled (wasm fallback applies)',
        );
      } else {
        this.logger.warn({
          event: 'ffmpeg_probe_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async isEnabled(): Promise<boolean> {
    return this.available && (await this.featureFlags.isEnabled(SERVER_VIDEO_OPS_FLAG));
  }

  getVersion(): string | null {
    return this.version;
  }

  async getOps(): Promise<string[]> {
    return (await this.isEnabled()) ? ['probe', 'extract_audio', 'slice', 'concat'] : [];
  }
}
