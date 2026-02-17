import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Inject,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { DeploymentsService } from './deployments.service';
import { PendingUploadsService } from './pending-uploads.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  CreateDeploymentDto,
  CreateDeploymentZipDto,
  ListDeploymentsQueryDto,
  CreateAliasDto,
  UpdateAliasDto,
  ListAliasesQueryDto,
  CreateDeploymentResponseDto,
  DeploymentDetailResponseDto,
  ListDeploymentsResponseDto,
  AliasResponseDto,
  ListAliasesResponseDto,
  UpdateAliasVisibilityDto,
  AliasVisibilityResponseDto,
  DeleteCommitResponseDto,
  DeleteCommitErrorDto,
  PrepareBatchUploadDto,
  PrepareBatchUploadResponseDto,
  FinalizeUploadDto,
  FinalizeUploadResponseDto,
  PrepareBatchDownloadDto,
  PrepareBatchDownloadResponseDto,
} from './deployments.dto';
import { VisibilityService } from '../domains/visibility.service';
import { ProjectsService } from '../projects/projects.service';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { PendingUploadFile } from '../db/schema/pending-uploads.schema';
import { db } from '../db/client';
import { assets, deploymentAliases } from '../db/schema';
import { eq, and, like, desc } from 'drizzle-orm';

@ApiTags('Deployments')
@Controller('api/deployments')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class DeploymentsController {
  constructor(
    private readonly deploymentsService: DeploymentsService,
    private readonly pendingUploadsService: PendingUploadsService,
    private readonly projectsService: ProjectsService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
    }),
  )
  @ApiOperation({ summary: 'Create a new deployment with files' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: CreateDeploymentResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or no files provided' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async createDeployment(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: CreateDeploymentDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CreateDeploymentResponseDto> {
    return this.deploymentsService.createDeployment(files, dto, user.id, user.role);
  }

  @Post('zip')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 uploads per minute (stricter than global 100/min)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for zip file
    }),
  )
  @ApiOperation({ summary: 'Create a new deployment from a zip file' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: CreateDeploymentResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or zip file' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async createDeploymentFromZip(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDeploymentZipDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CreateDeploymentResponseDto> {
    return this.deploymentsService.createDeploymentFromZip(file, dto, user.id, user.role);
  }

  @Get()
  @ApiOperation({ summary: 'List deployments with filtering and pagination' })
  @ApiResponse({ status: 200, type: ListDeploymentsResponseDto })
  async listDeployments(
    @Query() query: ListDeploymentsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListDeploymentsResponseDto> {
    return this.deploymentsService.listDeployments(query, user.id, user.role || 'user');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deployment details including all files' })
  @ApiResponse({ status: 200, type: DeploymentDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this deployment' })
  async getDeployment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<DeploymentDetailResponseDto> {
    return this.deploymentsService.getDeployment(id, user.id, user.role || 'user');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete entire deployment and all its files' })
  @ApiResponse({ status: 204, description: 'Deployment deleted successfully' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to delete this deployment' })
  async deleteDeployment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    return this.deploymentsService.deleteDeployment(id, user.id, user.role || 'user');
  }

  // Alias management endpoints

  @Post(':id/aliases')
  @ApiOperation({ summary: 'Create alias for a deployment' })
  @ApiResponse({ status: 201, type: AliasResponseDto })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to create alias' })
  async createAlias(
    @Param('id') deploymentId: string,
    @Body() dto: CreateAliasDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasResponseDto> {
    return this.deploymentsService.createAlias(deploymentId, dto, user.id, user.role || 'user');
  }

  // Pre-signed URL Batch Upload Endpoints

  @Post('prepare-batch-upload')
  @Throttle({ default: { ttl: 60000, limit: 30 } }) // 30 per minute (prepare calls are lightweight)
  @ApiOperation({
    summary: 'Prepare batch upload with presigned URLs',
    description:
      'Requests presigned URLs for direct-to-storage file uploads. If the storage backend does not support presigned URLs, returns a fallback response indicating ZIP upload should be used.',
  })
  @ApiResponse({ status: 201, type: PrepareBatchUploadResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or too many files' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async prepareBatchUpload(
    @Body() dto: PrepareBatchUploadDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PrepareBatchUploadResponseDto> {
    // Check if storage supports presigned URLs
    const supportsPresigned = this.storageAdapter.supportsPresignedUrls?.() ?? false;

    if (!supportsPresigned) {
      // Return fallback response - client should use ZIP upload
      return {
        presignedUrlsSupported: false,
      };
    }

    // Parse repository
    const [owner, name] = dto.repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }

    // Find or create project
    const project = await this.projectsService.findOrCreateProject(owner, name, user.id);

    // Validate file count
    if (dto.files.length > 10000) {
      throw new BadRequestException('Maximum 10,000 files per batch upload');
    }

    if (dto.files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    // Generate presigned URLs for each file
    const expiresInSeconds = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const filesWithUrls: Array<{
      path: string;
      presignedUrl: string;
      storageKey: string;
    }> = [];
    const pendingFiles: PendingUploadFile[] = [];

    for (const file of dto.files) {
      const storageKey = this.deploymentsService.generateStorageKeyPublic(
        dto.repository,
        dto.commitSha,
        file.path,
      );

      const presignedUrl = await this.storageAdapter.getPresignedUploadUrl!(
        storageKey,
        expiresInSeconds,
      );

      filesWithUrls.push({
        path: file.path,
        presignedUrl,
        storageKey,
      });

      pendingFiles.push({
        path: file.path,
        size: file.size,
        contentType: file.contentType,
        storageKey,
      });
    }

    // Create pending upload record
    const pendingUpload = await this.pendingUploadsService.create({
      projectId: project.id,
      repository: dto.repository,
      commitSha: dto.commitSha,
      branch: dto.branch,
      alias: dto.alias,
      basePath: dto.basePath,
      description: dto.description,
      tags: dto.tags,
      proxyRuleSetId: dto.proxyRuleSetId,
      files: pendingFiles,
      uploadedBy: user.id,
      expiresInSeconds,
    });

    return {
      presignedUrlsSupported: true,
      uploadToken: pendingUpload.uploadToken,
      expiresAt: expiresAt.toISOString(),
      files: filesWithUrls,
    };
  }

  @Post('finalize-upload')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 per minute (similar to zip upload)
  @ApiOperation({
    summary: 'Finalize batch upload',
    description:
      'Completes a batch upload by verifying files were uploaded and creating asset records.',
  })
  @ApiResponse({ status: 201, type: FinalizeUploadResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid upload token or upload expired' })
  @ApiResponse({ status: 404, description: 'Upload token not found' })
  async finalizeUpload(
    @Body() dto: FinalizeUploadDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<FinalizeUploadResponseDto> {
    // Find pending upload by token
    const pendingUpload = await this.pendingUploadsService.findByToken(dto.uploadToken);

    if (!pendingUpload) {
      throw new NotFoundException('Upload token not found');
    }

    // Check if expired
    if (new Date() > pendingUpload.expiresAt) {
      // Clean up expired record
      await this.pendingUploadsService.delete(pendingUpload.id);
      throw new BadRequestException('Upload session has expired. Please start a new upload.');
    }

    // Verify all files exist in storage
    const missingFiles: string[] = [];
    for (const file of pendingUpload.files) {
      const exists = await this.storageAdapter.exists(file.storageKey);
      if (!exists) {
        missingFiles.push(file.path);
      }
    }

    if (missingFiles.length > 0) {
      throw new BadRequestException({
        message: 'Some files were not uploaded',
        missingFiles: missingFiles.slice(0, 20), // Limit to first 20
        totalMissing: missingFiles.length,
      });
    }

    // Create asset records from manifest
    const result = await this.deploymentsService.createAssetsFromManifest(
      {
        projectId: pendingUpload.projectId!,
        repository: pendingUpload.repository,
        commitSha: pendingUpload.commitSha,
        branch: pendingUpload.branch ?? undefined,
        description: pendingUpload.description ?? undefined,
        tags: typeof pendingUpload.tags === 'string' ? pendingUpload.tags : JSON.stringify(pendingUpload.tags),
        proxyRuleSetId: pendingUpload.proxyRuleSetId ?? undefined,
        alias: pendingUpload.alias ?? undefined,
        basePath: pendingUpload.basePath ?? undefined,
        files: pendingUpload.files,
        userId: pendingUpload.uploadedBy ?? undefined,
      },
      user.role,
    );

    // Delete pending upload record (successful finalization)
    await this.pendingUploadsService.delete(pendingUpload.id);

    // Generate URLs
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
    const primaryDomain = process.env.PRIMARY_DOMAIN;

    // Find preview alias name from created aliases
    const previewAliasName = result.aliases.find((a) => a.startsWith('pr-'));
    let previewUrl: string | undefined;
    if (previewAliasName && primaryDomain) {
      previewUrl = `https://${previewAliasName}.${primaryDomain}/`;
    } else if (previewAliasName) {
      previewUrl = `${baseUrl}/public/subdomain-alias/${previewAliasName}/`;
    }

    return {
      deploymentId: result.deploymentId,
      commitSha: pendingUpload.commitSha,
      fileCount: result.fileCount,
      totalSize: result.totalSize,
      urls: {
        sha: `${baseUrl}/public/${pendingUpload.repository}/commits/${pendingUpload.commitSha}/`,
        branch: pendingUpload.branch
          ? `${baseUrl}/public/${pendingUpload.repository}/alias/${pendingUpload.branch}/`
          : undefined,
        default: `${baseUrl}/public/${pendingUpload.repository}/`,
        preview: previewUrl,
      },
      aliases: result.aliases,
      failed: result.failed.length > 0 ? result.failed : undefined,
    };
  }

  @Post('prepare-batch-download')
  @Throttle({ default: { ttl: 60000, limit: 60 } }) // 60 per minute (read-only operation)
  @ApiOperation({
    summary: 'Prepare batch download with presigned URLs',
    description:
      'Requests presigned URLs for downloading files from a deployment. Resolves alias/branch/commitSha to get the file manifest.',
  })
  @ApiResponse({ status: 201, type: PrepareBatchDownloadResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or missing resolution parameter' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async prepareBatchDownload(
    @Body() dto: PrepareBatchDownloadDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PrepareBatchDownloadResponseDto> {
    // Validate that at least one resolution parameter is provided
    if (!dto.alias && !dto.commitSha && !dto.branch) {
      throw new BadRequestException(
        'One of alias, commitSha, or branch is required to identify the deployment',
      );
    }

    // Parse repository
    const [owner, name] = dto.repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }

    // Get project
    const project = await this.projectsService.getProjectByOwnerName(owner, name);

    // Resolve to commitSha
    let commitSha: string | null = null;

    if (dto.commitSha) {
      // Direct commitSha provided
      commitSha = dto.commitSha;
    } else if (dto.alias) {
      // Resolve alias to commitSha
      const [aliasRecord] = await db
        .select()
        .from(deploymentAliases)
        .where(
          and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, dto.alias)),
        )
        .limit(1);

      if (!aliasRecord) {
        throw new NotFoundException(`Alias "${dto.alias}" not found`);
      }
      commitSha = aliasRecord.commitSha;
    } else if (dto.branch) {
      // Resolve branch to commitSha (branch is treated as an alias)
      const [aliasRecord] = await db
        .select()
        .from(deploymentAliases)
        .where(
          and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, dto.branch)),
        )
        .limit(1);

      if (aliasRecord) {
        commitSha = aliasRecord.commitSha;
      } else {
        // Fallback: find most recent deployment on this branch
        const [latestAsset] = await db
          .select()
          .from(assets)
          .where(and(eq(assets.projectId, project.id), eq(assets.branch, dto.branch)))
          .orderBy(desc(assets.createdAt))
          .limit(1);

        if (latestAsset) {
          commitSha = latestAsset.commitSha;
        }
      }

      if (!commitSha) {
        throw new NotFoundException(`No deployment found for branch "${dto.branch}"`);
      }
    }

    if (!commitSha) {
      throw new NotFoundException('Could not resolve deployment');
    }

    // Get all assets for this deployment that match the path prefix
    const normalizedPath = dto.path.replace(/^\/+/, '').replace(/\/+$/, '');
    const pathPrefix = normalizedPath ? `${normalizedPath}/` : '';

    // Get matching assets
    const matchingAssets = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.projectId, project.id),
          eq(assets.commitSha, commitSha),
          pathPrefix ? like(assets.publicPath, `${pathPrefix}%`) : undefined,
        ),
      );

    if (matchingAssets.length === 0) {
      // If no assets found with prefix, try without prefix (maybe path is the exact deployment)
      const allAssets = await db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, commitSha)));

      if (allAssets.length === 0) {
        throw new NotFoundException(`No files found for commit ${commitSha}`);
      }

      // Return all assets if path doesn't match but deployment exists
      // This handles the case where the sourcePath is the root of the deployment
    }

    const finalAssets = matchingAssets.length > 0 ? matchingAssets : await db
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, commitSha)));

    // Check if storage supports presigned URLs
    const supportsPresigned = this.storageAdapter.supportsPresignedUrls?.() ?? false;

    // Generate presigned URLs for each file
    const expiresInSeconds = 3600; // 1 hour
    const files: Array<{ path: string; size: number; downloadUrl: string }> = [];

    for (const asset of finalAssets) {
      let downloadUrl: string;

      if (supportsPresigned) {
        // Generate presigned URL for direct download from storage
        downloadUrl = await this.storageAdapter.getUrl(asset.storageKey, expiresInSeconds);
      } else {
        // Generate API fallback URL
        const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
        downloadUrl = `${baseUrl}/api/files/${encodeURIComponent(asset.publicPath || asset.fileName)}?repository=${encodeURIComponent(dto.repository)}&commitSha=${commitSha}`;
      }

      // Calculate relative path within the source-path
      let relativePath = asset.publicPath || asset.fileName;
      if (pathPrefix && relativePath.startsWith(pathPrefix)) {
        relativePath = relativePath.slice(pathPrefix.length);
      }

      files.push({
        path: relativePath,
        size: asset.size,
        downloadUrl,
      });
    }

    return {
      presignedUrlsSupported: supportsPresigned,
      commitSha,
      files,
    };
  }

  @Delete('commit/:owner/:repo/:commitSha')
  @ApiOperation({ summary: 'Delete a commit and all its deployments' })
  @ApiResponse({
    status: 200,
    description: 'Commit deleted successfully',
    type: DeleteCommitResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete commit with active aliases',
    type: DeleteCommitErrorDto,
  })
  @ApiResponse({ status: 404, description: 'Commit not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to delete this commit' })
  async deleteCommit(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commitSha') commitSha: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<DeleteCommitResponseDto> {
    return this.deploymentsService.deleteCommit(owner, repo, commitSha, user.id, user.role);
  }
}

// Separate controller for alias management at /api/aliases
@ApiTags('Aliases')
@Controller('api/aliases')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class AliasesController {
  constructor(
    private readonly deploymentsService: DeploymentsService,
    private readonly visibilityService: VisibilityService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all aliases' })
  @ApiResponse({ status: 200, type: ListAliasesResponseDto })
  async listAliases(
    @Query() query: ListAliasesQueryDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListAliasesResponseDto> {
    return this.deploymentsService.listAliases(query, user.id, user.role || 'user');
  }

  @Put(':repository/:alias')
  @ApiOperation({ summary: 'Update alias to point to different commit SHA' })
  @ApiResponse({ status: 200, type: AliasResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to update alias' })
  async updateAlias(
    @Param('repository') repository: string,
    @Param('alias') alias: string,
    @Body() dto: UpdateAliasDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasResponseDto> {
    // Decode repository path (e.g., "owner%2Frepo" -> "owner/repo")
    const decodedRepo = decodeURIComponent(repository);
    return this.deploymentsService.updateAlias(
      decodedRepo,
      alias,
      dto,
      user.id,
      user.role || 'user',
    );
  }

  @Delete(':repository/:alias')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alias' })
  @ApiResponse({ status: 204, description: 'Alias deleted successfully' })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to delete alias' })
  async deleteAlias(
    @Param('repository') repository: string,
    @Param('alias') alias: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    const decodedRepo = decodeURIComponent(repository);
    return this.deploymentsService.deleteAlias(decodedRepo, alias, user.id, user.role || 'user');
  }

  // Phase B5: Alias Visibility Endpoints

  @Get(':projectId/:alias/visibility')
  @ApiOperation({ summary: 'Get resolved visibility for alias' })
  @ApiResponse({ status: 200, type: AliasVisibilityResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  async getAliasVisibility(
    @Param('projectId') projectId: string,
    @Param('alias') aliasName: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasVisibilityResponseDto> {
    const alias = await this.deploymentsService.getAlias(
      projectId,
      aliasName,
      user.id,
      user.role || 'user',
    );

    if (!alias) {
      throw new NotFoundException(`Alias not found: ${aliasName}`);
    }

    const project = await this.projectsService.getProjectById(projectId);
    const effectiveVisibility = await this.visibilityService.resolveAliasVisibility(
      projectId,
      aliasName,
    );

    return {
      projectId,
      alias: aliasName,
      effectiveVisibility: effectiveVisibility ? 'public' : 'private',
      source: alias.isPublic !== null ? 'alias' : 'project',
      aliasOverride: alias.isPublic,
      projectVisibility: project.isPublic,
    };
  }

  @Patch(':projectId/:alias/visibility')
  @ApiOperation({ summary: 'Update alias visibility' })
  @ApiResponse({ status: 200, type: AliasVisibilityResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to update alias visibility' })
  async updateAliasVisibility(
    @Param('projectId') projectId: string,
    @Param('alias') aliasName: string,
    @Body() dto: UpdateAliasVisibilityDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasVisibilityResponseDto> {
    const updated = await this.deploymentsService.updateAliasVisibility(
      projectId,
      aliasName,
      dto.isPublic ?? null,
      user.id,
      user.role || 'user',
    );

    const project = await this.projectsService.getProjectById(projectId);
    const effectiveVisibility = await this.visibilityService.resolveAliasVisibility(
      projectId,
      aliasName,
    );

    return {
      projectId,
      alias: aliasName,
      effectiveVisibility: effectiveVisibility ? 'public' : 'private',
      source: updated.isPublic !== null ? 'alias' : 'project',
      aliasOverride: updated.isPublic,
      projectVisibility: project.isPublic,
    };
  }
}

// Separate controller for direct file downloads at /api/files (fallback when presigned URLs not supported)
@ApiTags('Files')
@Controller('api/files')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class FilesController {
  constructor(
    private readonly projectsService: ProjectsService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  @Get('*')
  @ApiOperation({
    summary: 'Download a file from storage',
    description:
      'Direct file download endpoint used as fallback when presigned URLs are not supported. Used by download-artifact action.',
  })
  @ApiResponse({ status: 200, description: 'File content streamed' })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async downloadFile(
    @Param('0') filePath: string,
    @Query('repository') repository: string,
    @Query('commitSha') commitSha: string,
    @Query('alias') alias: string,
    @Query('branch') branch: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!repository) {
      throw new BadRequestException('repository query parameter is required');
    }

    if (!commitSha && !alias && !branch) {
      throw new BadRequestException('One of commitSha, alias, or branch is required');
    }

    // Parse repository
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }

    // Get project
    const project = await this.projectsService.getProjectByOwnerName(owner, name);

    // Resolve to commitSha
    let resolvedCommitSha: string | null = commitSha || null;

    if (!resolvedCommitSha && alias) {
      // Resolve alias to commitSha
      const [aliasRecord] = await db
        .select()
        .from(deploymentAliases)
        .where(and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, alias)))
        .limit(1);

      if (!aliasRecord) {
        throw new NotFoundException(`Alias "${alias}" not found`);
      }
      resolvedCommitSha = aliasRecord.commitSha;
    }

    if (!resolvedCommitSha && branch) {
      // Resolve branch to commitSha
      const [aliasRecord] = await db
        .select()
        .from(deploymentAliases)
        .where(and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, branch)))
        .limit(1);

      if (aliasRecord) {
        resolvedCommitSha = aliasRecord.commitSha;
      } else {
        // Fallback: find most recent deployment on this branch
        const [latestAsset] = await db
          .select()
          .from(assets)
          .where(and(eq(assets.projectId, project.id), eq(assets.branch, branch)))
          .orderBy(desc(assets.createdAt))
          .limit(1);

        if (latestAsset) {
          resolvedCommitSha = latestAsset.commitSha;
        }
      }

      if (!resolvedCommitSha) {
        throw new NotFoundException(`No deployment found for branch "${branch}"`);
      }
    }

    if (!resolvedCommitSha) {
      throw new NotFoundException('Could not resolve deployment');
    }

    // Find the asset
    const normalizedPath = filePath.replace(/^\/+/, '');
    const [asset] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.projectId, project.id),
          eq(assets.commitSha, resolvedCommitSha),
          eq(assets.publicPath, normalizedPath),
        ),
      )
      .limit(1);

    if (!asset) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    // Download from storage
    const buffer = await this.storageAdapter.download(asset.storageKey);

    // Set response headers
    res.set({
      'Content-Type': asset.mimeType || 'application/octet-stream',
      'Content-Length': asset.size,
      'Content-Disposition': `attachment; filename="${asset.fileName}"`,
    });

    return new StreamableFile(buffer);
  }
}
