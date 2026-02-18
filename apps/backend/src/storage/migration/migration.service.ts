import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IStorageAdapter } from '../storage.interface';
import {
  MigrationStatus,
  MigrationProgress,
  MigrationOptions,
  MigrationFileResult,
  MigrationJob,
  MigrationScope,
} from './migration.interface';

@Injectable()
export class StorageMigrationService {
  private readonly logger = new Logger(StorageMigrationService.name);
  private currentMigration: MigrationJob | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Start a new migration
   */
  async startMigration(
    sourceAdapter: IStorageAdapter,
    targetAdapter: IStorageAdapter,
    sourceProviderName: string,
    targetProviderName: string,
    targetConfig: Record<string, unknown>,
    options: MigrationOptions = {},
  ): Promise<string> {
    // Check if migration is already in progress
    if (this.currentMigration?.status === MigrationStatus.IN_PROGRESS) {
      throw new BadRequestException('Migration already in progress');
    }

    // Validate target connection
    try {
      await targetAdapter.testConnection();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Cannot connect to target storage provider: ${message}`);
    }

    // Calculate migration scope
    const allKeys = await sourceAdapter.listKeys(options.filterPrefix);
    let totalBytes = 0;

    for (const key of allKeys) {
      try {
        const metadata = await sourceAdapter.getMetadata(key);
        totalBytes += metadata.size;
      } catch {
        // File may have been deleted, skip
      }
    }

    // Create migration job
    const jobId = `migration-${Date.now()}`;
    this.currentMigration = {
      id: jobId,
      sourceProvider: sourceProviderName,
      targetProvider: targetProviderName,
      targetConfig, // Store config for use after completion
      status: MigrationStatus.IN_PROGRESS,
      options: {
        continueOnError: true,
        concurrency: 5,
        verifyIntegrity: true,
        deleteSourceAfter: false,
        maxRetries: 3,
        ...options,
      },
      progress: {
        status: MigrationStatus.IN_PROGRESS,
        totalFiles: allKeys.length,
        migratedFiles: 0,
        failedFiles: 0,
        skippedFiles: 0,
        totalBytes,
        migratedBytes: 0,
        startedAt: new Date(),
        errors: [],
        canResume: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Start migration in background
    this.runMigration(sourceAdapter, targetAdapter, allKeys, this.currentMigration);

    this.logger.log(
      `Migration started: ${jobId} (${allKeys.length} files, ${this.formatBytes(totalBytes)})`,
    );

    return jobId;
  }

  /**
   * Run the actual migration (background)
   */
  private async runMigration(
    source: IStorageAdapter,
    target: IStorageAdapter,
    keys: string[],
    job: MigrationJob,
  ): Promise<void> {
    const { options } = job;
    // Note: We don't accumulate results to avoid memory issues with large migrations
    // Progress is tracked in job.progress instead
    const concurrency = options.concurrency ?? 2; // Lower default to reduce memory pressure

    // Process files in batches for concurrency
    for (let i = 0; i < keys.length; i += concurrency) {
      // Check for cancellation
      if (this.abortController?.signal.aborted) {
        job.status = MigrationStatus.CANCELLED;
        job.progress.status = MigrationStatus.CANCELLED;
        break;
      }

      const batch = keys.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((key) => this.migrateFile(source, target, key, options)),
      );

      // Update progress
      for (const result of batchResults) {
        if (result.status === 'success') {
          job.progress.migratedFiles++;
          job.progress.migratedBytes += result.size;
        } else if (result.status === 'failed') {
          job.progress.failedFiles++;
          // Limit errors array to prevent memory growth (keep last 100)
          if (job.progress.errors.length < 100) {
            job.progress.errors.push({
              key: result.key,
              error: result.error || 'Unknown error',
              timestamp: new Date(),
              retryable: true,
            });
          }

          if (!options.continueOnError) {
            job.status = MigrationStatus.FAILED;
            job.progress.status = MigrationStatus.FAILED;
            break;
          }
        } else {
          job.progress.skippedFiles++;
        }

        job.progress.currentFile = result.key;
        job.checkpoint = result.key;
        job.updatedAt = new Date();

        // Estimate completion time
        const elapsed = Date.now() - job.progress.startedAt.getTime();
        const rate = job.progress.migratedBytes / elapsed;
        const remaining = job.progress.totalBytes - job.progress.migratedBytes;
        if (rate > 0) {
          job.progress.estimatedCompletionAt = new Date(Date.now() + remaining / rate);
        }

        // Emit progress event
        this.eventEmitter.emit('migration.progress', job.progress);
      }

      // Allow event loop to breathe and give GC a chance to run
      // This small delay prevents memory pressure from building up
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Mark complete
    if (job.status === MigrationStatus.IN_PROGRESS) {
      job.status = MigrationStatus.COMPLETED;
      job.progress.status = MigrationStatus.COMPLETED;
    }
    job.completedAt = new Date();
    job.updatedAt = new Date();

    this.eventEmitter.emit('migration.complete', {
      success: job.status === MigrationStatus.COMPLETED,
      ...job.progress,
      durationMs: job.completedAt.getTime() - job.progress.startedAt.getTime(),
    });

    this.logger.log(
      `Migration ${job.status}: ${job.progress.migratedFiles}/${job.progress.totalFiles} files`,
    );
  }

  /**
   * Migrate a single file
   */
  private async migrateFile(
    source: IStorageAdapter,
    target: IStorageAdapter,
    key: string,
    options: MigrationOptions,
  ): Promise<MigrationFileResult> {
    const startTime = Date.now();
    let retries = 0;
    const maxRetries = options.maxRetries ?? 3;

    while (retries <= maxRetries) {
      try {
        // Download from source
        const data = await source.download(key);
        const metadata = await source.getMetadata(key);

        // Upload to target
        await target.upload(data, key, {
          mimeType: metadata.mimeType,
        });

        // Verify integrity if enabled
        if (options.verifyIntegrity) {
          const targetExists = await target.exists(key);
          if (!targetExists) {
            throw new Error('Verification failed: file not found after upload');
          }
          // Could also compare checksums if adapters support it
        }

        return {
          key,
          status: 'success',
          size: metadata.size,
          durationMs: Date.now() - startTime,
        };
      } catch (error: unknown) {
        retries++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Migration failed for ${key} (attempt ${retries}/${maxRetries}): ${errorMessage}`,
        );

        if (retries > maxRetries) {
          return {
            key,
            status: 'failed',
            size: 0,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          };
        }

        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 1000));
      }
    }

    return {
      key,
      status: 'failed',
      size: 0,
      error: 'Max retries exceeded',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Get current migration progress
   */
  getProgress(): MigrationProgress | null {
    return this.currentMigration?.progress || null;
  }

  /**
   * Get current migration job
   */
  getCurrentJob(): MigrationJob | null {
    return this.currentMigration;
  }

  /**
   * Cancel current migration
   */
  async cancelMigration(): Promise<void> {
    if (!this.currentMigration) {
      throw new BadRequestException('No migration in progress');
    }

    this.abortController?.abort();
    this.currentMigration.status = MigrationStatus.CANCELLED;
    this.currentMigration.progress.status = MigrationStatus.CANCELLED;
    this.currentMigration.updatedAt = new Date();

    this.logger.log('Migration cancelled');
  }

  /**
   * Clear migration job (after provider switch is complete)
   */
  clearMigrationJob(): void {
    this.currentMigration = null;
    this.abortController = null;
    this.logger.log('Migration job cleared');
  }

  /**
   * Resume a paused/failed migration
   */
  async resumeMigration(source: IStorageAdapter, target: IStorageAdapter): Promise<void> {
    if (!this.currentMigration?.checkpoint) {
      throw new BadRequestException('No migration to resume');
    }

    // Get remaining keys (after checkpoint)
    const allKeys = await source.listKeys(this.currentMigration.options.filterPrefix);
    const checkpointIndex = allKeys.indexOf(this.currentMigration.checkpoint);
    const remainingKeys = allKeys.slice(checkpointIndex + 1);

    this.currentMigration.status = MigrationStatus.IN_PROGRESS;
    this.currentMigration.progress.status = MigrationStatus.IN_PROGRESS;
    this.abortController = new AbortController();

    this.runMigration(source, target, remainingKeys, this.currentMigration);

    this.logger.log(`Migration resumed from checkpoint: ${this.currentMigration.checkpoint}`);
  }

  /**
   * Calculate migration scope without starting
   */
  async calculateScope(source: IStorageAdapter, filterPrefix?: string): Promise<MigrationScope> {
    const keys = await source.listKeys(filterPrefix);
    let totalBytes = 0;

    for (const key of keys) {
      try {
        const metadata = await source.getMetadata(key);
        totalBytes += metadata.size;
      } catch {
        // Skip
      }
    }

    // Estimate duration (rough: 1MB per second)
    const estimatedSeconds = totalBytes / (1024 * 1024);
    const estimatedDuration = this.formatDuration(estimatedSeconds);

    return {
      fileCount: keys.length,
      totalBytes,
      formattedSize: this.formatBytes(totalBytes),
      estimatedDuration,
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Format seconds to human-readable duration string
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)} seconds`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
    return `${(seconds / 3600).toFixed(1)} hours`;
  }
}
