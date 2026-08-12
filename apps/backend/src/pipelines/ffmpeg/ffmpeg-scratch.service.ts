import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { readFfmpegEnv } from './ffmpeg-env';
import { FfmpegInsufficientDiskError } from './ffmpeg-errors';

/**
 * Bounded scratch space for ffmpeg temp transcodes. One mkdtemp dir per job,
 * removed in the handler's finally; the sweeps are the backstop for crashes.
 *
 * Liveness is inferred from mtime, like LocalUploadWriterService.sweepTempFiles
 * (storage/local-upload-writer.service.ts): an actively-written output file
 * refreshes its mtime on every write, so a dir whose NEWEST content mtime is
 * older than 2× the watchdog ceiling cannot belong to a live job (the watchdog
 * kills at 1×). A floor of 1h guards against tiny FFMPEG_MAX_SECONDS values.
 */
@Injectable()
export class FfmpegScratchService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegScratchService.name);

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.sweepOrphans();
    } catch (error) {
      // A failed sweep must never block boot.
      this.logger.error({ event: 'ffmpeg_scratch_boot_sweep_failed', error: String(error) });
    }
  }

  private scratchRoot(): string {
    return readFfmpegEnv().scratchDir;
  }

  async createJobDir(): Promise<string> {
    const root = this.scratchRoot();
    await fs.mkdir(root, { recursive: true });
    return fs.mkdtemp(path.join(root, 'job-'));
  }

  async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn({ event: 'ffmpeg_scratch_cleanup_failed', dir, error: String(error) });
    }
  }

  /**
   * Pre-flight: require free space ≥ requiredBytes on the scratch volume.
   * Callers pass 2× total input size + margin (input temp + output estimate).
   */
  async assertFreeSpace(requiredBytes: number): Promise<void> {
    const root = this.scratchRoot();
    await fs.mkdir(root, { recursive: true });
    let free: number;
    try {
      const s = await (fs as any).statfs(root);
      free = s.bsize * s.bavail;
    } catch {
      return; // statfs unavailable → skip the check rather than false-refuse
    }
    if (free < requiredBytes) {
      throw new FfmpegInsufficientDiskError(
        `insufficient scratch disk for server video ops: need ${requiredBytes} bytes free, have ${free}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepScheduled(): Promise<void> {
    try {
      const n = await this.sweepOrphans();
      if (n > 0) this.logger.log({ event: 'ffmpeg_scratch_sweep', removed: n });
    } catch (error) {
      this.logger.error({ event: 'ffmpeg_scratch_sweep_failed', error: String(error) });
    }
  }

  async sweepOrphans(): Promise<number> {
    const root = this.scratchRoot();
    const cfg = readFfmpegEnv();
    const cutoffMs = Math.max(2 * cfg.maxSeconds * 1000, 60 * 60 * 1000);
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return 0; // root doesn't exist yet
    }
    let removed = 0;
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith('job-')) continue;
      const dir = path.join(root, entry);
      try {
        const newest = await this.newestMtime(dir);
        if (now - newest > cutoffMs) {
          await fs.rm(dir, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // raced with a concurrent cleanup — fine
      }
    }
    return removed;
  }

  /** Newest mtime of the dir itself or anything inside it (one level is enough — jobs write flat). */
  private async newestMtime(dir: string): Promise<number> {
    const stat = await fs.stat(dir);
    let newest = stat.mtimeMs;
    for (const f of await fs.readdir(dir)) {
      try {
        newest = Math.max(newest, (await fs.stat(path.join(dir, f))).mtimeMs);
      } catch {
        /* file vanished mid-scan */
      }
    }
    return newest;
  }
}
