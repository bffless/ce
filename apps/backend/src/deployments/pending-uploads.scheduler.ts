import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PendingUploadsService } from './pending-uploads.service';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { resolveLocalAdapter } from '../storage/local.adapter';
import { LocalUploadWriterService } from '../storage/local-upload-writer.service';

/**
 * Scheduler for cleaning up expired pending uploads
 *
 * Runs every 15 minutes to:
 * 1. Find expired pending upload records
 * 2. Delete any orphaned files from storage
 * 3. Delete the pending upload records from database
 */
@Injectable()
export class PendingUploadsScheduler {
  private readonly logger = new Logger(PendingUploadsScheduler.name);

  constructor(
    private readonly pendingUploadsService: PendingUploadsService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly uploadWriter: LocalUploadWriterService,
  ) {}

  /**
   * Clean up expired pending uploads every 15 minutes
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredUploads(): Promise<void> {
    try {
      // Find all expired pending uploads
      const expiredUploads = await this.pendingUploadsService.findExpired();

      if (expiredUploads.length === 0) {
        return;
      }

      this.logger.log({
        event: 'cleanup_started',
        expiredCount: expiredUploads.length,
      });

      let deletedFiles = 0;
      let failedFiles = 0;

      // Clean up storage files for each expired upload
      for (const upload of expiredUploads) {
        const storageKeys = this.pendingUploadsService.getStorageKeysFromUpload(upload);

        for (const key of storageKeys) {
          try {
            // Check if file exists before deleting (it might not have been uploaded)
            const exists = await this.storageAdapter.exists(key);
            if (exists) {
              await this.storageAdapter.delete(key);
              deletedFiles++;
            }
          } catch (error) {
            failedFiles++;
            this.logger.warn({
              event: 'cleanup_file_failed',
              key,
              uploadId: upload.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // Delete the pending upload records
      const deletedRecords = await this.pendingUploadsService.deleteMany(
        expiredUploads.map((u) => u.id),
      );

      this.logger.log({
        event: 'cleanup_completed',
        deletedRecords,
        deletedFiles,
        failedFiles,
      });
    } catch (error) {
      this.logger.error({
        event: 'cleanup_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove upload temp files abandoned by clients that disconnected
   * mid-body. Local storage only — bucket backends (S3/MinIO/GCS/Azure)
   * manage their own multipart upload state and have no local temp dir for
   * this to sweep, so `resolveLocalAdapter` makes this a no-op for them.
   *
   * `olderThanMs`: `LocalUploadWriterService.sweepTempFiles` infers liveness
   * purely from a temp file's `mtime`, which an actively-writing upload keeps
   * refreshing — so the only files this can ever claim are ones whose writes
   * have genuinely stopped. The obligation on this cutoff is therefore that
   * it exceeds the longest plausible *stall inside* a legitimate upload, not
   * the upload's total duration. The 1-hour value here is bounded by Task
   * 10's nginx `proxy_read_timeout 600s` / `proxy_send_timeout 600s`: nginx
   * itself kills any request stalled beyond 10 minutes, so a temp file that
   * survives a stall long enough for an hourly sweep to see it is guaranteed
   * to already be abandoned at the proxy, not merely slow. Do NOT shrink this
   * interval without first re-checking that bound (or widening it correctly
   * if the proxy timeout ever changes) — see also the liveness contract on
   * `sweepTempFiles` itself.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepPresignedTempFiles(): Promise<void> {
    const local = resolveLocalAdapter(this.storageAdapter);
    if (!local) return;

    try {
      await this.uploadWriter.sweepTempFiles(local.getStorageBasePath(), 60 * 60 * 1000);
    } catch (error) {
      this.logger.error({
        event: 'presigned_temp_sweep_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
