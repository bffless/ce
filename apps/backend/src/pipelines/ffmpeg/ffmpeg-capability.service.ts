import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

const execFileAsync = promisify(execFile);

/** Flag key: DB > file > env > default-OFF (see FLAG_DEFINITIONS) — the operator's per-instance policy. */
export const SERVER_VIDEO_OPS_FLAG = 'FFMPEG_HANDLER_ENABLED';

/** The curated operation set — the `ops` of the capability payload. */
export const FFMPEG_OPS = [
  'probe',
  'extract_audio',
  'slice',
  'concat',
  'frames',
  'contact_sheet',
] as const;

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
  /**
   * Filter names this ffmpeg listed, or null when we never learned them (probe
   * skipped, binaries missing, or the `-filters` call itself failed). Null is
   * NOT "no filters" — see `hasFilter`.
   */
  private filters: Set<string> | null = null;

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.probe();
  }

  async probe(): Promise<void> {
    this.filters = null;
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-version']);
      await execFileAsync('ffprobe', ['-version']);
      this.version = stdout.split('\n')[0]?.trim() || null;
      this.available = true;
      this.logger.log({ event: 'ffmpeg_capability', available: true, version: this.version });
      await this.probeFilters();
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

  /**
   * Which filters this ffmpeg was built with. Deliberately its own try/catch:
   * a build whose `-filters` call fails must still count as available (the
   * curated ops that need no optional filter keep working), so this only ever
   * downgrades `filters` to null.
   *
   * Each line after the legend is `<flags> <name> <io> <description>`, e.g.
   * ` T.C drawbox           V->V       Draw a colored box on the input video.`
   * — so the NAME is field 1 and the io field carries the `->` that
   * distinguishes a filter row from the legend. Matching on the raw stdout
   * instead would also match a name mentioned in another filter's DESCRIPTION.
   */
  private async probeFilters(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-filters']);
      const names = new Set<string>();
      for (const line of stdout.split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 3 || !fields[2].includes('->')) continue;
        names.add(fields[1]);
      }
      this.filters = names;
    } catch (error) {
      this.filters = null;
      this.logger.warn({
        event: 'ffmpeg_filters_probe_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Tri-state on purpose: `true`/`false` once the filter probe has run,
   * `undefined` when it never did (no binaries, NODE_ENV=test, or the
   * `-filters` call failed). Callers gating optional filters must treat
   * `undefined` as "attempt it" and only act on an explicit `false` — a
   * remote-only instance has no local ffmpeg to probe, and its Worker's
   * build is not this box's (Ruling R77).
   */
  hasFilter(name: string): boolean | undefined {
    return this.filters ? this.filters.has(name) : undefined;
  }

  async isEnabled(): Promise<boolean> {
    return this.available && (await this.featureFlags.isEnabled(SERVER_VIDEO_OPS_FLAG));
  }

  /**
   * The operator's policy flag ALONE, without the local-binary requirement
   * `isEnabled()` folds in: an instance that runs its jobs on a remote Worker
   * has no local ffmpeg and must still be able to turn server video ops on.
   */
  async isFlagOn(): Promise<boolean> {
    return this.featureFlags.isEnabled(SERVER_VIDEO_OPS_FLAG);
  }

  getVersion(): string | null {
    return this.version;
  }

  async getOps(): Promise<string[]> {
    return (await this.isEnabled()) ? [...FFMPEG_OPS] : [];
  }
}
