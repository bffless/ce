import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { StorageUsageService, QuotaConfig } from './storage-usage.service';

/**
 * Result of quota check before upload
 */
export interface QuotaCheckResult {
  allowed: boolean;
  currentUsage: number;
  quota: number | null;
  projectedUsage: number;
  overageBytes: number;
  isOverage: boolean;
  behavior: 'block' | 'charge' | 'unlimited';
  message?: string;
}

/**
 * Error details for quota exceeded response
 */
export interface QuotaExceededError {
  message: string;
  code: 'QUOTA_EXCEEDED';
  currentUsage: number;
  quota: number;
  uploadSize: number;
  overageBytes: number;
  behavior: 'block';
}

/**
 * StorageQuotaService
 *
 * Enforces storage quotas before upload operations.
 *
 * Usage:
 * ```typescript
 * // In assets.service.ts before upload:
 * const quotaResult = await this.quotaService.checkQuota(fileSize);
 * if (!quotaResult.allowed) {
 *   throw new PayloadTooLargeException(quotaResult);
 * }
 * ```
 *
 * Behavior:
 * - In CE self-hosted mode (no L2): Always allows (unlimited)
 * - In Platform mode with 'block' behavior: Rejects if over quota
 * - In Platform mode with 'charge' behavior: Allows but flags as overage
 */
@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);

  constructor(private readonly storageUsageService: StorageUsageService) {}

  /**
   * Check if an upload of the given size is allowed.
   *
   * @param uploadSize - Size of the file to upload in bytes
   * @returns QuotaCheckResult indicating whether upload is allowed
   */
  async checkQuota(uploadSize: number): Promise<QuotaCheckResult> {
    // Get current usage and quota config
    const usage = await this.storageUsageService.getWorkspaceUsage();

    // No quota configured = unlimited
    if (!usage.quotaBytes || usage.overageBehavior === 'unlimited') {
      return {
        allowed: true,
        currentUsage: usage.totalBytes,
        quota: null,
        projectedUsage: usage.totalBytes + uploadSize,
        overageBytes: 0,
        isOverage: false,
        behavior: 'unlimited',
      };
    }

    const projectedUsage = usage.totalBytes + uploadSize;
    const overageBytes = Math.max(0, projectedUsage - usage.quotaBytes);
    const isOverage = overageBytes > 0;

    // Check behavior when over quota
    if (isOverage && usage.overageBehavior === 'block') {
      this.logger.warn(
        `Upload blocked: ${uploadSize} bytes would exceed quota. ` +
          `Current: ${usage.totalBytes}, Quota: ${usage.quotaBytes}, Projected: ${projectedUsage}`,
      );

      return {
        allowed: false,
        currentUsage: usage.totalBytes,
        quota: usage.quotaBytes,
        projectedUsage,
        overageBytes,
        isOverage: true,
        behavior: 'block',
        message: `Storage quota exceeded. Current usage: ${this.formatBytes(usage.totalBytes)}, ` +
          `Quota: ${this.formatBytes(usage.quotaBytes)}, ` +
          `Upload size: ${this.formatBytes(uploadSize)}`,
      };
    }

    // Log overage for charge behavior
    if (isOverage && usage.overageBehavior === 'charge') {
      this.logger.debug(
        `Upload allowed with overage: ${uploadSize} bytes. ` +
          `Current: ${usage.totalBytes}, Quota: ${usage.quotaBytes}, Overage: ${overageBytes}`,
      );
    }

    return {
      allowed: true,
      currentUsage: usage.totalBytes,
      quota: usage.quotaBytes,
      projectedUsage,
      overageBytes,
      isOverage,
      behavior: usage.overageBehavior,
    };
  }

  /**
   * Check quota and throw PayloadTooLargeException if blocked.
   * Convenience method for use in upload flows.
   *
   * @param uploadSize - Size of the file to upload in bytes
   * @throws PayloadTooLargeException if quota exceeded and behavior is 'block'
   */
  async enforceQuota(uploadSize: number): Promise<QuotaCheckResult> {
    const result = await this.checkQuota(uploadSize);

    if (!result.allowed) {
      const error: QuotaExceededError = {
        message: result.message || 'Storage quota exceeded',
        code: 'QUOTA_EXCEEDED',
        currentUsage: result.currentUsage,
        quota: result.quota!,
        uploadSize,
        overageBytes: result.overageBytes,
        behavior: 'block',
      };

      throw new PayloadTooLargeException(error);
    }

    return result;
  }

  /**
   * Check if bulk uploads of the given sizes are allowed.
   * Used for batch/deployment uploads.
   *
   * @param fileSizes - Array of file sizes in bytes
   * @returns QuotaCheckResult for the combined upload
   */
  async checkBulkQuota(fileSizes: number[]): Promise<QuotaCheckResult> {
    const totalSize = fileSizes.reduce((sum, size) => sum + size, 0);
    return this.checkQuota(totalSize);
  }

  /**
   * Get current quota configuration.
   */
  async getQuotaConfig(): Promise<QuotaConfig> {
    return this.storageUsageService.getQuotaConfig();
  }

  /**
   * Format bytes to human-readable string (server-side helper).
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}
