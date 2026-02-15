import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PendingUploadsService } from './pending-uploads.service';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';

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
}
