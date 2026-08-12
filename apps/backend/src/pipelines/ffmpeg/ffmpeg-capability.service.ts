import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFfmpegEnv } from './ffmpeg-env';

const execFileAsync = promisify(execFile);

/**
 * Boot-time capability probe: ffmpeg + ffprobe both present → server video ops
 * capability. Missing binaries are normal (local dev without ffmpeg, minimal
 * images) — degrade silently to unavailable, warn once, never block boot.
 * Mirrors EdgeBlocklistService's ENOENT tolerance (domains/edge-blocklist.service.ts).
 */
@Injectable()
export class FfmpegCapabilityService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegCapabilityService.name);
  private available = false;
  private version: string | null = null;

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

  isEnabled(): boolean {
    return this.available && readFfmpegEnv().enabled;
  }

  getVersion(): string | null {
    return this.version;
  }

  getOps(): string[] {
    return this.isEnabled() ? ['probe', 'extract_audio', 'slice', 'concat'] : [];
  }
}
