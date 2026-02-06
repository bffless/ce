import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { count, desc, eq, sum } from 'drizzle-orm';
import axios from 'axios';
import { db } from '../db/client';
import { assets, projects } from '../db/schema';

/**
 * Quota configuration from Control Plane (L2)
 */
export interface QuotaConfig {
  quotaBytes: number | null; // null = unlimited
  overageBehavior: 'block' | 'charge' | 'unlimited';
  overagePricePerGb: number | null;
  alertThresholdPercent: number;
  planName: string | null;
}

/**
 * Workspace storage usage summary
 */
export interface WorkspaceStorageUsage {
  totalBytes: number;
  assetCount: number;
  quotaBytes: number | null;
  usagePercent: number | null;
  overageBytes: number;
  isOverQuota: boolean;
  isNearQuota: boolean;
  overageBehavior: 'block' | 'charge' | 'unlimited';
  overagePricePerGb: number | null;
  planName: string | null;
}

/**
 * Storage usage breakdown by project
 */
export interface ProjectUsage {
  projectId: string;
  projectName: string;
  owner: string;
  assetCount: number;
  totalBytes: number;
  percentOfTotal: number;
}

/**
 * Storage usage breakdown by branch (within a project)
 */
export interface BranchUsage {
  branch: string;
  assetCount: number;
  totalBytes: number;
  commitCount: number;
  percentOfProject: number;
}

/**
 * StorageUsageService
 *
 * Provides storage usage aggregation and quota information.
 *
 * In Platform mode (with CONTROL_PLANE_URL configured):
 * - Fetches quota config from L2 Control Plane
 * - Calculates overage and status
 *
 * In CE self-hosted mode:
 * - Returns unlimited quota (no enforcement)
 * - Still provides usage aggregation
 */
@Injectable()
export class StorageUsageService {
  private readonly logger = new Logger(StorageUsageService.name);
  private readonly controlPlaneUrl: string | undefined;
  private readonly workspaceId: string | undefined;
  private readonly workspaceSecret: string | undefined;
  private readonly isPlatformMode: boolean;

  // Cache quota config for 60 seconds to reduce L2 calls
  private quotaCache: { config: QuotaConfig; expiresAt: number } | null = null;
  private readonly QUOTA_CACHE_TTL = 60 * 1000; // 60 seconds

  constructor(private readonly configService: ConfigService) {
    this.controlPlaneUrl = configService.get<string>('CONTROL_PLANE_URL');
    this.workspaceId = configService.get<string>('WORKSPACE_ID');
    this.workspaceSecret = configService.get<string>('WORKSPACE_SECRET');
    this.isPlatformMode = !!(
      this.controlPlaneUrl &&
      this.workspaceId &&
      this.workspaceSecret
    );

    if (this.isPlatformMode) {
      this.logger.log(
        `Storage usage service running in platform mode (workspace: ${this.workspaceId})`,
      );
    } else {
      this.logger.debug(
        'Storage usage service running in CE mode (unlimited storage)',
      );
    }
  }

  /**
   * Get workspace storage usage with quota information.
   */
  async getWorkspaceUsage(): Promise<WorkspaceStorageUsage> {
    // Get current usage from database
    const [usage] = await db
      .select({
        assetCount: count(assets.id),
        totalBytes: sum(assets.size),
      })
      .from(assets);

    const totalBytes = Number(usage?.totalBytes ?? 0);
    const assetCount = Number(usage?.assetCount ?? 0);

    // Get quota config (from L2 in platform mode, unlimited otherwise)
    const quotaConfig = await this.getQuotaConfig();

    // Calculate usage metrics
    const quotaBytes = quotaConfig.quotaBytes;
    const usagePercent = quotaBytes ? (totalBytes / quotaBytes) * 100 : null;
    const overageBytes = quotaBytes ? Math.max(0, totalBytes - quotaBytes) : 0;
    const isOverQuota = quotaBytes ? totalBytes > quotaBytes : false;
    const isNearQuota = quotaBytes
      ? (totalBytes / quotaBytes) * 100 >= quotaConfig.alertThresholdPercent
      : false;

    return {
      totalBytes,
      assetCount,
      quotaBytes,
      usagePercent,
      overageBytes,
      isOverQuota,
      isNearQuota,
      overageBehavior: quotaConfig.overageBehavior,
      overagePricePerGb: quotaConfig.overagePricePerGb,
      planName: quotaConfig.planName,
    };
  }

  /**
   * Get storage usage breakdown by project.
   */
  async getUsageByProject(): Promise<ProjectUsage[]> {
    const results = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        owner: projects.owner,
        assetCount: count(assets.id),
        totalBytes: sum(assets.size),
      })
      .from(assets)
      .innerJoin(projects, eq(assets.projectId, projects.id))
      .groupBy(projects.id, projects.name, projects.owner)
      .orderBy(desc(sum(assets.size)));

    // Calculate total for percentages
    const total = results.reduce(
      (sum, r) => sum + Number(r.totalBytes ?? 0),
      0,
    );

    return results.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      owner: r.owner,
      assetCount: Number(r.assetCount),
      totalBytes: Number(r.totalBytes ?? 0),
      percentOfTotal: total > 0 ? (Number(r.totalBytes ?? 0) / total) * 100 : 0,
    }));
  }

  /**
   * Get storage usage breakdown by branch for a specific project.
   */
  async getUsageByBranch(projectId: string): Promise<BranchUsage[]> {
    const results = await db
      .select({
        branch: assets.branch,
        assetCount: count(assets.id),
        totalBytes: sum(assets.size),
      })
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .groupBy(assets.branch)
      .orderBy(desc(sum(assets.size)));

    // Get unique commit count per branch
    const branchCommits = await db
      .selectDistinct({ branch: assets.branch, commitSha: assets.commitSha })
      .from(assets)
      .where(eq(assets.projectId, projectId));

    const commitCountByBranch = branchCommits.reduce(
      (acc, r) => {
        const branch = r.branch || 'unknown';
        acc[branch] = (acc[branch] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Calculate project total for percentages
    const projectTotal = results.reduce(
      (sum, r) => sum + Number(r.totalBytes ?? 0),
      0,
    );

    return results.map((r) => ({
      branch: r.branch || 'unknown',
      assetCount: Number(r.assetCount),
      totalBytes: Number(r.totalBytes ?? 0),
      commitCount: commitCountByBranch[r.branch || 'unknown'] || 0,
      percentOfProject:
        projectTotal > 0
          ? (Number(r.totalBytes ?? 0) / projectTotal) * 100
          : 0,
    }));
  }

  /**
   * Get quota configuration from Control Plane (cached).
   * Returns unlimited config if not in platform mode.
   */
  async getQuotaConfig(): Promise<QuotaConfig> {
    // Not in platform mode = unlimited
    if (!this.isPlatformMode) {
      return {
        quotaBytes: null,
        overageBehavior: 'unlimited',
        overagePricePerGb: null,
        alertThresholdPercent: 80,
        planName: null,
      };
    }

    // Check cache
    if (this.quotaCache && Date.now() < this.quotaCache.expiresAt) {
      return this.quotaCache.config;
    }

    try {
      const response = await axios.get<QuotaConfig>(
        `${this.controlPlaneUrl}/api/internal/workspaces/${this.workspaceId}/quota`,
        {
          headers: {
            'X-Workspace-Secret': this.workspaceSecret,
          },
          timeout: 5000,
        },
      );

      // Cache the result
      this.quotaCache = {
        config: response.data,
        expiresAt: Date.now() + this.QUOTA_CACHE_TTL,
      };

      return response.data;
    } catch (error) {
      // If L2 is unavailable, fail open with unlimited
      this.logger.warn(
        `Failed to fetch quota from Control Plane: ${error instanceof Error ? error.message : 'Unknown error'}. Using unlimited.`,
      );
      return {
        quotaBytes: null,
        overageBehavior: 'unlimited',
        overagePricePerGb: null,
        alertThresholdPercent: 80,
        planName: null,
      };
    }
  }

  /**
   * Check if platform mode is enabled.
   */
  isInPlatformMode(): boolean {
    return this.isPlatformMode;
  }

  /**
   * Clear the quota cache (useful for testing or after quota changes).
   */
  clearQuotaCache(): void {
    this.quotaCache = null;
  }
}
