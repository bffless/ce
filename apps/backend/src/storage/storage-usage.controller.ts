import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { StorageUsageService, WorkspaceStorageUsage, ProjectUsage, BranchUsage } from './storage-usage.service';

/**
 * Storage Usage Controller
 *
 * Provides endpoints for querying storage usage and quota information.
 * Used by the frontend to display usage metrics and quota warnings.
 */
@ApiTags('Storage')
@Controller('api/storage')
@UseGuards(SessionAuthGuard)
@ApiBearerAuth()
export class StorageUsageController {
  constructor(private readonly storageUsageService: StorageUsageService) {}

  /**
   * GET /api/storage/usage
   *
   * Get overall workspace storage usage with quota information.
   */
  @Get('usage')
  @ApiOperation({
    summary: 'Get workspace storage usage',
    description:
      'Returns total storage usage, asset count, and quota information. ' +
      'In platform mode, quota is fetched from Control Plane. ' +
      'In CE self-hosted mode, quota is unlimited.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage usage summary',
    schema: {
      type: 'object',
      properties: {
        totalBytes: { type: 'number', description: 'Total storage used in bytes' },
        assetCount: { type: 'number', description: 'Number of assets' },
        quotaBytes: { type: 'number', nullable: true, description: 'Quota limit in bytes (null = unlimited)' },
        usagePercent: { type: 'number', nullable: true, description: 'Percentage of quota used' },
        overageBytes: { type: 'number', description: 'Bytes over quota (0 if under)' },
        isOverQuota: { type: 'boolean', description: 'Whether currently over quota' },
        isNearQuota: { type: 'boolean', description: 'Whether near quota threshold' },
        overageBehavior: {
          type: 'string',
          enum: ['block', 'charge', 'unlimited'],
          description: 'What happens when quota exceeded',
        },
        overagePricePerGb: { type: 'number', nullable: true, description: 'Price per GB overage' },
      },
    },
  })
  async getUsage(): Promise<WorkspaceStorageUsage> {
    return this.storageUsageService.getWorkspaceUsage();
  }

  /**
   * GET /api/storage/usage/by-project
   *
   * Get storage usage breakdown by project.
   */
  @Get('usage/by-project')
  @ApiOperation({
    summary: 'Get storage usage by project',
    description: 'Returns storage usage breakdown for each project in the workspace.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage usage by project',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
          projectName: { type: 'string', description: 'Project name' },
          owner: { type: 'string', description: 'Project owner' },
          assetCount: { type: 'number', description: 'Number of assets' },
          totalBytes: { type: 'number', description: 'Total storage in bytes' },
          percentOfTotal: { type: 'number', description: 'Percentage of total workspace storage' },
        },
      },
    },
  })
  async getUsageByProject(): Promise<ProjectUsage[]> {
    return this.storageUsageService.getUsageByProject();
  }

  /**
   * GET /api/storage/usage/by-branch/:projectId
   *
   * Get storage usage breakdown by branch for a specific project.
   */
  @Get('usage/by-branch/:projectId')
  @ApiOperation({
    summary: 'Get storage usage by branch',
    description: 'Returns storage usage breakdown for each branch within a project.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage usage by branch',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch name' },
          assetCount: { type: 'number', description: 'Number of assets' },
          totalBytes: { type: 'number', description: 'Total storage in bytes' },
          commitCount: { type: 'number', description: 'Number of unique commits' },
          percentOfProject: { type: 'number', description: 'Percentage of project storage' },
        },
      },
    },
  })
  async getUsageByBranch(@Param('projectId') projectId: string): Promise<BranchUsage[]> {
    return this.storageUsageService.getUsageByBranch(projectId);
  }

  /**
   * GET /api/storage/quota
   *
   * Get just the quota configuration (useful for checking limits before upload).
   */
  @Get('quota')
  @ApiOperation({
    summary: 'Get quota configuration',
    description:
      'Returns the current quota configuration. ' +
      'In platform mode, fetched from Control Plane. ' +
      'In CE self-hosted mode, returns unlimited.',
  })
  @ApiResponse({
    status: 200,
    description: 'Quota configuration',
    schema: {
      type: 'object',
      properties: {
        quotaBytes: { type: 'number', nullable: true },
        overageBehavior: { type: 'string', enum: ['block', 'charge', 'unlimited'] },
        overagePricePerGb: { type: 'number', nullable: true },
        alertThresholdPercent: { type: 'number' },
      },
    },
  })
  async getQuotaConfig() {
    return this.storageUsageService.getQuotaConfig();
  }
}
