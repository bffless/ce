import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * UsageReportDto - sent to Control Plane after upload/delete
 */
export interface UsageReportDto {
  totalBytes: number;
  assetCount: number;
  event: 'upload' | 'delete';
  deltaBytes: number;
}

/**
 * StorageUsage - returned by getLocalUsage()
 */
export interface StorageUsage {
  totalBytes: number;
  assetCount: number;
}

/**
 * UsageReporterService
 *
 * Reports storage usage to Control Plane (L2) after upload/delete operations.
 *
 * **Purpose:** Enables L2 to track workspace storage usage for:
 * - Billing dashboards
 * - Usage analytics
 * - Quota monitoring
 *
 * **Fire-and-forget pattern:**
 * - Reporting does not block the main operation
 * - If L2 is unavailable, the upload/delete still succeeds
 * - Errors are logged but don't affect the user
 *
 * **Platform Mode Only:**
 * - Requires CONTROL_PLANE_URL, WORKSPACE_ID, and WORKSPACE_SECRET env vars
 * - Skipped for CE self-hosted deployments (no Control Plane)
 *
 * @example
 * ```typescript
 * // After successful upload in AssetsService:
 * this.usageReporter.reportUpload(file.size).catch(() => {});
 *
 * // After successful delete:
 * this.usageReporter.reportDelete(asset.size).catch(() => {});
 * ```
 */
@Injectable()
export class UsageReporterService implements OnModuleInit {
  private readonly logger = new Logger(UsageReporterService.name);
  private readonly controlPlaneUrl: string | undefined;
  private readonly workspaceId: string | undefined;
  private readonly workspaceSecret: string | undefined;
  private readonly enabled: boolean;
  private httpClient: AxiosInstance | null = null;

  // Callback to get current storage usage from AssetsService
  private getLocalUsageCallback: (() => Promise<StorageUsage>) | null = null;

  constructor(private readonly configService: ConfigService) {
    this.controlPlaneUrl = configService.get<string>('CONTROL_PLANE_URL');
    this.workspaceId = configService.get<string>('WORKSPACE_ID');
    this.workspaceSecret = configService.get<string>('WORKSPACE_SECRET');

    // Only enable if all required env vars are present
    this.enabled = !!(this.controlPlaneUrl && this.workspaceId && this.workspaceSecret);
  }

  onModuleInit() {
    if (this.enabled) {
      this.httpClient = axios.create({
        baseURL: this.controlPlaneUrl,
        timeout: 5000,
        headers: {
          'X-Workspace-Secret': this.workspaceSecret,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(
        `Usage reporting enabled for workspace ${this.workspaceId} -> ${this.controlPlaneUrl}`,
      );
    } else {
      this.logger.debug(
        'Usage reporting disabled (missing CONTROL_PLANE_URL, WORKSPACE_ID, or WORKSPACE_SECRET)',
      );
    }
  }

  /**
   * Register a callback to get current local storage usage.
   * Called by AssetsModule during initialization.
   */
  registerUsageCallback(callback: () => Promise<StorageUsage>): void {
    this.getLocalUsageCallback = callback;
  }

  /**
   * Report usage to Control Plane (fire-and-forget).
   * Called after upload/delete operations.
   * Skipped if not in platform mode.
   */
  async reportUsage(event: 'upload' | 'delete', deltaBytes: number): Promise<void> {
    if (!this.enabled || !this.httpClient) {
      return;
    }

    try {
      // Get current local usage
      const usage = await this.getLocalUsage();

      const dto: UsageReportDto = {
        totalBytes: usage.totalBytes,
        assetCount: usage.assetCount,
        event,
        deltaBytes,
      };

      await this.httpClient.post(`/api/internal/workspaces/${this.workspaceId}/usage`, dto);

      this.logger.debug(`Reported ${event} (${deltaBytes} bytes) to Control Plane`);
    } catch (error) {
      // Fire-and-forget: log but don't throw
      this.logger.warn(
        `Failed to report usage to Control Plane: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Report an upload event.
   * Convenience method for reportUsage('upload', size).
   */
  async reportUpload(size: number): Promise<void> {
    return this.reportUsage('upload', size);
  }

  /**
   * Report a delete event.
   * Convenience method for reportUsage('delete', -size).
   */
  async reportDelete(size: number): Promise<void> {
    return this.reportUsage('delete', -size);
  }

  /**
   * Get current local storage usage.
   * Uses the registered callback from AssetsService.
   */
  private async getLocalUsage(): Promise<StorageUsage> {
    if (this.getLocalUsageCallback) {
      return this.getLocalUsageCallback();
    }

    // Default fallback - return zeros (will be updated by next report with callback)
    return {
      totalBytes: 0,
      assetCount: 0,
    };
  }

  /**
   * Check if usage reporting is enabled (for testing/debugging).
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Report setup completion to Control Plane (fire-and-forget).
   * Called after the setup wizard completes.
   * Skipped if not in platform mode (self-hosted CE).
   */
  async reportSetupComplete(): Promise<void> {
    if (!this.enabled || !this.httpClient) {
      return;
    }

    try {
      await this.httpClient.post(`/api/internal/workspaces/${this.workspaceId}/setup-status`);

      this.logger.log('Reported setup completion to Control Plane');
    } catch (error) {
      // Fire-and-forget: log but don't throw
      this.logger.warn(
        `Failed to report setup completion to Control Plane: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
