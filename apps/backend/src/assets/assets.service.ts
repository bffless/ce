import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { eq, like, and, asc, desc, count, gte, lte, SQL, sum } from 'drizzle-orm';
import { db } from '../db/client';
import { assets, Asset } from '../db/schema';
import { STORAGE_ADAPTER } from '../storage/storage.module';
import { IStorageAdapter } from '../storage/storage.interface';
import { StorageQuotaService } from '../storage/storage-quota.service';
import {
  UploadAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
  AssetResponseDto,
  ListAssetsResponseDto,
  AssetSortField,
  SortOrder,
} from './assets.dto';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as mime from 'mime-types';
import * as crypto from 'crypto';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';
import { UsageReporterService } from '../platform/usage-reporter.service';

// File validation constants
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

@Injectable()
export class AssetsService implements OnModuleInit {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly projectsService: ProjectsService,
    private readonly permissionsService: PermissionsService,
    private readonly usageReporter: UsageReporterService,
    private readonly quotaService: StorageQuotaService,
  ) {}

  /**
   * Register the usage callback with UsageReporterService on module init.
   * This allows UsageReporterService to fetch current usage when reporting to L2.
   */
  async onModuleInit() {
    this.usageReporter.registerUsageCallback(() => this.getStorageUsage());
  }

  /**
   * Get total storage usage across all assets.
   * Used by UsageReporterService to report usage to Control Plane.
   */
  async getStorageUsage(): Promise<{ totalBytes: number; assetCount: number }> {
    const [result] = await db
      .select({
        assetCount: count(assets.id),
        totalBytes: sum(assets.size),
      })
      .from(assets);

    return {
      assetCount: Number(result?.assetCount ?? 0),
      totalBytes: Number(result?.totalBytes ?? 0),
    };
  }

  /**
   * Phase 3H.6: Helper to check if user has required role for project
   * Replaces allowedRepositories checks with proper permission system
   */
  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string | undefined,
    requiredRole: 'viewer' | 'contributor' | 'admin' | 'owner' = 'contributor',
  ): Promise<void> {
    // Admin users have access to all projects
    if (userRole === 'admin') {
      return;
    }

    // Check project permissions
    const role = await this.permissionsService.getUserProjectRole(userId, projectId);

    if (!role) {
      throw new ForbiddenException('You do not have access to this project');
    }

    // Check if user has required role level
    const roleHierarchy = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
    const userLevel = roleHierarchy[role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(`This action requires ${requiredRole} role or higher`);
    }
  }

  /**
   * Upload a single asset
   */
  async upload(
    file: Express.Multer.File,
    dto: UploadAssetDto,
    userId: string,
    userRole?: string,
  ): Promise<AssetResponseDto> {
    // Validate file
    this.validateFile(file);

    // Check storage quota (throws PayloadTooLargeException if blocked)
    await this.quotaService.enforceQuota(file.size);

    // Get or create project (Phase 3A migration)
    let projectId: string;
    if (dto.repository) {
      const [owner, name] = dto.repository.split('/');
      if (!owner || !name) {
        throw new BadRequestException('Invalid repository format. Expected: owner/name');
      }
      const project = await this.projectsService.findOrCreateProject(owner, name, userId);
      projectId = project.id;

      // Phase 3H.6: Check project access (requires contributor role to upload)
      await this.checkProjectAccess(projectId, userId, userRole, 'contributor');
    } else {
      throw new BadRequestException('repository field is required');
    }

    // Sanitize filename
    const sanitizedFilename = this.sanitizeFilename(file.originalname);

    // Generate storage key
    const storageKey = this.generateStorageKey(
      dto.repository,
      dto.commitSha,
      dto.publicPath || sanitizedFilename,
    );

    // Compute content hash for ETag optimization (MD5)
    const contentHash = crypto.createHash('md5').update(file.buffer).digest('hex');

    // Upload to storage backend
    await this.storageAdapter.upload(file.buffer, storageKey, {
      mimeType: file.mimetype,
    });

    // Parse tags if provided (can be comma-separated string or JSON array)
    let tagsJson: string | null = null;
    if (dto.tags) {
      try {
        // Try parsing as JSON array first
        const parsed = JSON.parse(dto.tags);
        tagsJson = JSON.stringify(Array.isArray(parsed) ? parsed : [dto.tags]);
      } catch {
        // Treat as comma-separated string
        const tagsArray = dto.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        tagsJson = JSON.stringify(tagsArray);
      }
    }

    // Create database record
    const [newAsset] = await db
      .insert(assets)
      .values({
        fileName: sanitizedFilename,
        originalPath: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        size: file.size,
        contentHash, // Pre-computed for ETag optimization
        projectId, // Required (Phase 3H - made NOT NULL)
        branch: dto.branch || null,
        commitSha: dto.commitSha || null,
        workflowName: dto.workflowName || null,
        workflowRunId: dto.workflowRunId || null,
        workflowRunNumber: dto.workflowRunNumber || null,
        uploadedBy: userId,
        tags: tagsJson,
        description: dto.description || null,
        deploymentId: dto.deploymentId || null,
        publicPath: dto.publicPath || null,
      })
      .returning();

    // Report usage to Control Plane (fire-and-forget)
    this.usageReporter.reportUpload(file.size).catch(() => {});

    return this.toAssetResponse(newAsset);
  }

  /**
   * Upload multiple assets (batch upload)
   */
  async batchUpload(
    files: Express.Multer.File[],
    dto: UploadAssetDto,
    userId: string,
    userRole?: string,
  ): Promise<{ assets: AssetResponseDto[]; failed: { file: string; error: string }[] }> {
    // Check bulk quota before starting uploads
    const fileSizes = files.map((f) => f.size);
    await this.quotaService.checkBulkQuota(fileSizes).then((result) => {
      if (!result.allowed) {
        // For bulk uploads with 'block' behavior, reject the entire batch
        throw result;
      }
    });

    const uploadedAssets: AssetResponseDto[] = [];
    const failedFiles: { file: string; error: string }[] = [];

    // Generate a deployment ID if not provided (to group files together)
    const deploymentId = dto.deploymentId || uuidv4();

    for (const file of files) {
      try {
        const assetDto = {
          ...dto,
          deploymentId,
          publicPath: dto.publicPath || file.originalname,
        };

        const asset = await this.upload(file, assetDto, userId, userRole);
        uploadedAssets.push(asset);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failedFiles.push({ file: file.originalname, error: errorMessage });
      }
    }

    return {
      assets: uploadedAssets,
      failed: failedFiles,
    };
  }

  /**
   * Find all assets with pagination and filtering
   */
  async findAll(
    query: ListAssetsQueryDto,
    userId: string,
    userRole: string,
  ): Promise<ListAssetsResponseDto> {
    const {
      page = 1,
      limit = 10,
      search,
      repository,
      branch,
      commitSha,
      workflowName,
      deploymentId,
      tags,
      startDate,
      endDate,
      mimeType,
      sortBy = AssetSortField.CREATED_AT,
      sortOrder = SortOrder.DESC,
    } = query;

    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions: SQL<unknown>[] = [];

    // Phase 3H.6: Convert repository string to projectId if provided
    let projectId: string | undefined;
    if (repository) {
      const [owner, name] = repository.split('/');
      if (owner && name) {
        try {
          const project = await this.projectsService.getProjectByOwnerName(owner, name);
          projectId = project.id;

          // Phase 3H.6: Check project access (requires viewer role to list)
          await this.checkProjectAccess(projectId, userId, userRole, 'viewer');
        } catch (error) {
          // Project not found or access denied - return empty result
          return this.emptyPaginatedResponse(page, limit);
        }
      }
    }

    // Phase 3H.6: Authorization logic
    if (userRole !== 'admin') {
      if (projectId) {
        // Specific project requested - filter by projectId (access already checked)
        conditions.push(eq(assets.projectId, projectId));
      } else {
        // No specific project - show only user's own assets
        conditions.push(eq(assets.uploadedBy, userId));
      }
    } else if (projectId) {
      // Admin can filter by repository
      conditions.push(eq(assets.projectId, projectId));
    }

    // Apply filters
    if (search) {
      conditions.push(like(assets.fileName, `%${search}%`));
    }

    if (branch) {
      conditions.push(eq(assets.branch, branch));
    }

    if (commitSha) {
      conditions.push(eq(assets.commitSha, commitSha));
    }

    if (workflowName) {
      conditions.push(like(assets.workflowName, `%${workflowName}%`));
    }

    if (deploymentId) {
      conditions.push(eq(assets.deploymentId, deploymentId));
    }

    if (mimeType) {
      conditions.push(eq(assets.mimeType, mimeType));
    }

    if (startDate) {
      conditions.push(gte(assets.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(assets.createdAt, new Date(endDate)));
    }

    // Note: Tags filtering requires JSON search which is more complex
    // For now, we'll do post-filtering if needed

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [countResult] = await db.select({ count: count() }).from(assets).where(whereClause);
    const total = Number(countResult?.count || 0);

    // Get paginated data
    const sortColumn = this.getSortColumn(sortBy);
    const orderBy = sortOrder === SortOrder.ASC ? asc(sortColumn) : desc(sortColumn);

    let data = await db
      .select()
      .from(assets)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // Post-filter by tags if provided
    if (tags) {
      const tagList = tags.split(',').map((t) => t.trim().toLowerCase());
      data = data.filter((asset) => {
        if (!asset.tags) return false;
        const assetTags: string[] = JSON.parse(asset.tags);
        return tagList.some((tag) => assetTags.map((t) => t.toLowerCase()).includes(tag));
      });
    }

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((asset) => this.toAssetResponse(asset)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Find asset by ID
   */
  async findById(id: string, userId: string, userRole: string): Promise<AssetResponseDto> {
    const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);

    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    // Phase 3H.6: Check project access (requires viewer role)
    if (asset.projectId) {
      await this.checkProjectAccess(asset.projectId, userId, userRole, 'viewer');
    } else if (userRole !== 'admin' && asset.uploadedBy !== userId) {
      // Fallback for assets without projectId - only owner or admin can access
      throw new ForbiddenException('Not authorized to access this asset');
    }

    return this.toAssetResponse(asset);
  }

  /**
   * Download asset
   */
  async download(
    id: string,
    userId: string,
    userRole: string,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    // First get and authorize the asset
    const asset = await this.findById(id, userId, userRole);

    // Download from storage
    const buffer = await this.storageAdapter.download(asset.storageKey);

    return {
      buffer,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    };
  }

  /**
   * Get asset URL (presigned or direct)
   */
  async getUrl(
    id: string,
    userId: string,
    userRole: string,
    expiresIn?: number,
  ): Promise<{ url: string; expiresAt?: string }> {
    // First get and authorize the asset
    const asset = await this.findById(id, userId, userRole);

    // Get URL from storage adapter
    const url = await this.storageAdapter.getUrl(asset.storageKey, expiresIn);

    // Calculate expiration if provided
    // Note: For local storage, expiresIn is ignored (URLs are permanent)
    // For MinIO/S3, if expiresIn is undefined, the adapter uses its default
    let expiresAt: string | undefined;
    if (expiresIn !== undefined) {
      expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    }

    return { url, expiresAt };
  }

  /**
   * Update asset metadata
   */
  async update(
    id: string,
    dto: UpdateAssetDto,
    userId: string,
    userRole: string,
  ): Promise<AssetResponseDto> {
    // Get existing asset
    const [existingAsset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);

    if (!existingAsset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    // Authorization check: only owner or admin can update
    if (userRole !== 'admin' && existingAsset.uploadedBy !== userId) {
      throw new ForbiddenException('Not authorized to update this asset');
    }

    // Build update data
    const updateData: Partial<Asset> = {
      updatedAt: new Date(),
    };

    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }

    if (dto.tags !== undefined) {
      try {
        const parsed = JSON.parse(dto.tags);
        updateData.tags = JSON.stringify(Array.isArray(parsed) ? parsed : [dto.tags]);
      } catch {
        const tagsArray = dto.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        updateData.tags = JSON.stringify(tagsArray);
      }
    }

    // Phase 3H.7: isPublic field removed - visibility now controlled at project level

    if (dto.publicPath !== undefined) {
      updateData.publicPath = dto.publicPath;
    }

    // Update database record
    const [updatedAsset] = await db
      .update(assets)
      .set(updateData)
      .where(eq(assets.id, id))
      .returning();

    return this.toAssetResponse(updatedAsset);
  }

  /**
   * Delete asset
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    // Get existing asset
    const [existingAsset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);

    if (!existingAsset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }

    // Authorization check: only owner or admin can delete
    if (userRole !== 'admin' && existingAsset.uploadedBy !== userId) {
      throw new ForbiddenException('Not authorized to delete this asset');
    }

    const assetSize = existingAsset.size;

    // Delete from storage
    try {
      await this.storageAdapter.delete(existingAsset.storageKey);
    } catch (error) {
      // Log error but continue with database deletion
      console.error(`Failed to delete file from storage: ${existingAsset.storageKey}`, error);
    }

    // Delete from database
    await db.delete(assets).where(eq(assets.id, id));

    // Report usage to Control Plane (fire-and-forget)
    this.usageReporter.reportDelete(assetSize).catch(() => {});
  }

  /**
   * Batch delete assets
   */
  async batchDelete(ids: string[], userId: string, userRole: string): Promise<number> {
    let deletedCount = 0;

    for (const id of ids) {
      try {
        await this.delete(id, userId, userRole);
        deletedCount++;
      } catch (error) {
        // Continue with other deletions
        console.error(`Failed to delete asset ${id}:`, error);
      }
    }

    return deletedCount;
  }

  /**
   * Delete all assets for a repository (optionally filtered by commit)
   */
  async deleteByRepository(
    repository: string,
    userId: string,
    userRole: string,
    commitSha?: string,
  ): Promise<number> {
    // Phase 3H.6: Convert repository string to projectId
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected: owner/name');
    }
    const project = await this.projectsService.getProjectByOwnerName(owner, name);

    // Phase 3H.6: Check project access (requires contributor role to delete)
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    // Build query conditions
    const conditions: SQL<unknown>[] = [eq(assets.projectId, project.id)];

    // Add commit filter if provided
    if (commitSha) {
      conditions.push(eq(assets.commitSha, commitSha));
    }

    // Non-admin users can only delete their own assets
    if (userRole !== 'admin') {
      conditions.push(eq(assets.uploadedBy, userId));
    }

    const assetsToDelete = await db
      .select()
      .from(assets)
      .where(and(...conditions));

    const scope = commitSha
      ? `repository: ${repository}, commit: ${commitSha}`
      : `repository: ${repository}`;
    console.log(`Found ${assetsToDelete.length} assets to delete for ${scope}`);

    let deletedCount = 0;

    // Delete each asset (includes storage cleanup)
    for (const asset of assetsToDelete) {
      try {
        // Delete from storage
        await this.storageAdapter.delete(asset.storageKey);

        // Delete from database
        await db.delete(assets).where(eq(assets.id, asset.id));

        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete asset ${asset.id}:`, error);
        // Continue with other deletions
      }
    }

    return deletedCount;
  }

  // Helper methods

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // Determine MIME type from file extension if not provided or generic
    let mimeType = file.mimetype;
    if (!mimeType || mimeType === 'application/octet-stream') {
      const detectedMime = mime.lookup(file.originalname);
      if (detectedMime) {
        mimeType = detectedMime;
      }
    }

    // Update file mimetype for accurate storage
    file.mimetype = mimeType;

    // For now, allow all types but could restrict based on ALLOWED_MIME_TYPES
    // if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    //   throw new BadRequestException(`File type ${mimeType} is not allowed`);
    // }
  }

  private sanitizeFilename(filename: string): string {
    // Remove path traversal characters and dangerous patterns
    let sanitized = filename
      .replace(/\.\./g, '') // Remove ..
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid characters
      .trim();

    // Ensure filename is not empty
    if (!sanitized) {
      sanitized = `file_${Date.now()}`;
    }

    // Add extension if missing
    const ext = path.extname(filename);
    if (!ext) {
      sanitized = `${sanitized}.bin`;
    }

    return sanitized;
  }

  private generateStorageKey(repository?: string, commitSha?: string, publicPath?: string): string {
    // GitHub-style format: owner/repo/commitSha/path/filename
    const parts: string[] = [];

    if (repository) {
      parts.push(repository);
    } else {
      parts.push('uploads'); // Default folder for non-GitHub uploads
    }

    if (commitSha) {
      parts.push(commitSha);
    } else {
      // Use timestamp-based folder for non-commit uploads
      parts.push(new Date().toISOString().split('T')[0]);
    }

    if (publicPath) {
      // Remove leading slash if present
      const cleanPath = publicPath.startsWith('/') ? publicPath.slice(1) : publicPath;
      parts.push(cleanPath);
    } else {
      parts.push(uuidv4());
    }

    return parts.join('/');
  }

  private getSortColumn(sortBy: AssetSortField) {
    switch (sortBy) {
      case AssetSortField.FILE_NAME:
        return assets.fileName;
      case AssetSortField.SIZE:
        return assets.size;
      case AssetSortField.REPOSITORY:
        // Phase 3H.7: repository field removed, sort by projectId instead
        // @todo how does sorting by projectId work?
        return assets.projectId;
      case AssetSortField.UPDATED_AT:
        return assets.updatedAt;
      case AssetSortField.CREATED_AT:
      default:
        return assets.createdAt;
    }
  }

  private toAssetResponse(asset: Asset): AssetResponseDto {
    return {
      id: asset.id,
      fileName: asset.fileName,
      originalPath: asset.originalPath,
      storageKey: asset.storageKey,
      mimeType: asset.mimeType,
      size: asset.size,
      repository: null, // Phase 3H.7: Deprecated - removed from database
      branch: asset.branch,
      commitSha: asset.commitSha,
      workflowName: asset.workflowName,
      workflowRunId: asset.workflowRunId,
      workflowRunNumber: asset.workflowRunNumber,
      uploadedBy: asset.uploadedBy,
      organizationId: asset.organizationId,
      tags: asset.tags ? JSON.parse(asset.tags) : null,
      description: asset.description,
      deploymentId: asset.deploymentId,
      isPublic: null, // Phase 3H.7: Deprecated - visibility controlled at project level
      publicPath: asset.publicPath,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    };
  }

  private emptyPaginatedResponse(page: number, limit: number): ListAssetsResponseDto {
    return {
      data: [],
      meta: {
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }
}
