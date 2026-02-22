import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, desc, like, SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { unzip } from 'fflate';
import * as mimeTypes from 'mime-types';
import * as crypto from 'crypto';
import { db } from '../db/client';
import { assets, Asset, deploymentAliases, projects, proxyRuleSets } from '../db/schema';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { AssetType } from '../types/asset-type.enum';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { UsageReporterService } from '../platform/usage-reporter.service';
import {
  CreateDeploymentDto,
  CreateDeploymentZipDto,
  ListDeploymentsQueryDto,
  CreateAliasDto,
  UpdateAliasDto,
  ListAliasesQueryDto,
  DeploymentResponseDto,
  DeploymentDetailResponseDto,
  CreateDeploymentResponseDto,
  ListDeploymentsResponseDto,
  AliasResponseDto,
  ListAliasesResponseDto,
  DeploymentSortField,
  SortOrder,
  DeleteCommitResponseDto,
} from './deployments.dto';
import { generatePreviewAliasName } from './preview-alias.util';

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly projectsService: ProjectsService,
    private readonly permissionsService: PermissionsService,
    private readonly nginxRegenerationService: NginxRegenerationService,
    private readonly usageReporter: UsageReporterService,
  ) {}

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
   * Resolve proxy rule set name to ID for a project
   * Returns undefined if name is not provided or rule set not found
   */
  private async resolveProxyRuleSetId(
    projectId: string,
    proxyRuleSetName?: string,
    proxyRuleSetId?: string,
  ): Promise<string | undefined> {
    // If ID is provided directly, use it (but name takes precedence)
    if (proxyRuleSetName) {
      const [ruleSet] = await db
        .select({ id: proxyRuleSets.id })
        .from(proxyRuleSets)
        .where(
          and(eq(proxyRuleSets.projectId, projectId), eq(proxyRuleSets.name, proxyRuleSetName)),
        )
        .limit(1);

      if (!ruleSet) {
        throw new BadRequestException(
          `Proxy rule set "${proxyRuleSetName}" not found for this project`,
        );
      }
      return ruleSet.id;
    }

    // Fall back to ID if provided
    return proxyRuleSetId;
  }

  /**
   * Create a new deployment from a zip file
   */
  async createDeploymentFromZip(
    file: Express.Multer.File,
    dto: CreateDeploymentZipDto,
    userId: string,
    userRole?: string,
  ): Promise<CreateDeploymentResponseDto> {
    // Parse repository string to get owner and name
    const [owner, name] = dto.repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }

    // Find or create project
    const project = await this.projectsService.findOrCreateProject(owner, name, userId);

    // Phase 3H.6: Check project access with proper permission system
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    if (!file) {
      throw new BadRequestException('No zip file provided');
    }

    // Validate file is a zip
    const isZip =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip');

    if (!isZip) {
      throw new BadRequestException('File must be a zip archive');
    }

    const deploymentId = uuidv4();
    const uploadedAssets: (typeof assets.$inferSelect)[] = [];
    const failed: { file: string; error: string }[] = [];
    let totalSize = 0;
    let fileCount = 0;

    const maxFiles = dto.maxFiles || 1000;
    const maxTotalSize = dto.maxTotalSize || 500 * 1024 * 1024;

    // Parse commit timestamp if provided
    const committedAt = this.parseCommittedAt(dto.committedAt);

    // Parse tags if provided
    const tags = this.parseTags(dto.tags);

    // Resolve proxy rule set name to ID if provided
    const resolvedProxyRuleSetId = await this.resolveProxyRuleSetId(
      project.id,
      dto.proxyRuleSetName,
      dto.proxyRuleSetId,
    );

    try {
      // Parse zip with fflate (async, non-blocking - better CPU performance)
      const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(new Uint8Array(file.buffer), (err, result) => {
          if (err) reject(new BadRequestException(`Failed to parse zip: ${err.message}`));
          else resolve(result);
        });
      });

      // Process each file in the zip
      for (const [entryPath, contentArray] of Object.entries(unzipped)) {
        // Skip directories (fflate marks them with trailing /)
        if (entryPath.endsWith('/')) {
          continue;
        }

        // Check file count limit
        fileCount++;
        if (fileCount > maxFiles) {
          throw new BadRequestException(
            `Zip contains too many files. Maximum allowed: ${maxFiles}`,
          );
        }

        // Get file path (remove leading slash if present)
        const filePath = entryPath.replace(/^\/+/, '');

        // Skip hidden files and system files
        if (filePath.startsWith('.') || filePath.includes('/__MACOSX/')) {
          fileCount--; // Don't count these
          continue;
        }

        try {
          // Convert Uint8Array to Buffer
          const content = Buffer.from(contentArray);
          const fileSize = content.length;

          // Check total size limit
          totalSize += fileSize;
          if (totalSize > maxTotalSize) {
            throw new BadRequestException(
              `Total size exceeds maximum allowed: ${maxTotalSize} bytes`,
            );
          }

          // Normalize public path
          const publicPath = this.normalizePublicPath(filePath);

          // Generate storage key
          const storageKey = this.generateStorageKey(dto.repository, dto.commitSha, publicPath);

          // Detect MIME type
          const mimeType = mimeTypes.lookup(filePath) || 'application/octet-stream';

          // Compute content hash for ETag optimization (MD5)
          const contentHash = crypto.createHash('md5').update(content).digest('hex');

          // Upload to storage
          await this.storageAdapter.upload(content, storageKey, {
            contentType: mimeType,
          });

          // Check if asset already exists (upsert logic for re-runs)
          const [existingAsset] = await db
            .select()
            .from(assets)
            .where(
              and(
                eq(assets.projectId, project.id),
                eq(assets.commitSha, dto.commitSha),
                eq(assets.publicPath, publicPath),
              ),
            )
            .limit(1);

          let newAsset: Asset;
          if (existingAsset) {
            // Update existing asset
            const [updated] = await db
              .update(assets)
              .set({
                fileName: filePath.split('/').pop() || filePath,
                originalPath: filePath,
                storageKey,
                mimeType,
                size: fileSize,
                contentHash,
                branch: dto.branch,
                uploadedBy: userId,
                deploymentId,
                description: dto.description,
                committedAt,
                tags,
                updatedAt: new Date(),
              })
              .where(eq(assets.id, existingAsset.id))
              .returning();
            newAsset = updated;
          } else {
            // Insert new asset
            const [inserted] = await db
              .insert(assets)
              .values({
                fileName: filePath.split('/').pop() || filePath,
                originalPath: filePath,
                storageKey,
                mimeType,
                size: fileSize,
                contentHash,
                projectId: project.id,
                branch: dto.branch,
                commitSha: dto.commitSha,
                uploadedBy: userId,
                deploymentId,
                publicPath,
                assetType: AssetType.COMMITS,
                description: dto.description,
                committedAt,
                tags,
              })
              .returning();
            newAsset = inserted;
          }

          uploadedAssets.push(newAsset);
        } catch (error) {
          // Track failed file with error details but continue processing
          const errorMessage = error instanceof Error ? error.message : String(error);
          failed.push({ file: filePath, error: errorMessage });
          console.error(`Failed to process ${filePath}:`, errorMessage);
        }
      }

      if (uploadedAssets.length === 0) {
        throw new BadRequestException('No valid files found in zip archive');
      }

      // Create or update alias if provided
      const aliases: string[] = [];
      if (dto.alias) {
        try {
          await this.createOrUpdateAlias(dto.repository, dto.alias, dto.commitSha, deploymentId, {
            proxyRuleSetId: resolvedProxyRuleSetId,
          });
          aliases.push(dto.alias);
        } catch (error) {
          // Alias creation failure is non-critical
          console.error(`Failed to create/update alias ${dto.alias}:`, error.message);
        }
      }

      // Auto-create preview alias (defaults to "/" if basePath not provided)
      const effectiveBasePath = dto.basePath || '/';
      const previewAliasName = generatePreviewAliasName(
        dto.commitSha,
        dto.repository,
        effectiveBasePath,
      );
      try {
        await this.createOrUpdateAlias(
          dto.repository,
          previewAliasName,
          dto.commitSha,
          deploymentId,
          {
            isAutoPreview: true,
            basePath: effectiveBasePath,
            proxyRuleSetId: resolvedProxyRuleSetId,
          },
        );
        aliases.push(previewAliasName);
      } catch (error) {
        this.logger.warn(`Failed to create preview alias: ${error.message}`);
      }

      // Generate URLs
      const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
      const primaryDomain = process.env.PRIMARY_DOMAIN;

      // Build preview URL using PRIMARY_DOMAIN if available
      let previewUrl: string | undefined;
      if (primaryDomain) {
        previewUrl = `https://${previewAliasName}.${primaryDomain}/`;
      } else {
        // Fallback for development: use path-based URL
        previewUrl = `${baseUrl}/public/subdomain-alias/${previewAliasName}/`;
      }

      const urls = {
        sha: `${baseUrl}/repo/${dto.repository}/${dto.commitSha}`,
        default: `${baseUrl}/public/${dto.repository}/`,
        preview: previewUrl,
      };

      // Report usage to Control Plane (fire-and-forget)
      this.usageReporter.reportUpload(totalSize).catch(() => {});

      return {
        deploymentId,
        commitSha: dto.commitSha,
        fileCount: uploadedAssets.length,
        totalSize,
        urls,
        aliases,
        failed: failed.length > 0 ? failed : undefined,
      };
    } catch (error) {
      // If it's already a BadRequestException, rethrow it
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Otherwise wrap in BadRequestException
      throw new BadRequestException(`Failed to process zip file: ${error.message}`);
    }
  }

  /**
   * Create a new deployment with uploaded files
   */
  async createDeployment(
    files: Express.Multer.File[],
    dto: CreateDeploymentDto,
    userId: string,
    userRole?: string,
  ): Promise<CreateDeploymentResponseDto> {
    // Parse repository string to get owner and name
    const [owner, name] = dto.repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }

    // Find or create project
    const project = await this.projectsService.findOrCreateProject(owner, name, userId);

    // Phase 3H.6: Check project access with proper permission system
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided for deployment');
    }

    // Parse file paths if provided
    let filePathsArray: string[] = [];
    if (dto.filePaths) {
      try {
        filePathsArray = JSON.parse(dto.filePaths);
        if (!Array.isArray(filePathsArray)) {
          throw new Error('filePaths must be an array');
        }
        if (filePathsArray.length !== files.length) {
          throw new BadRequestException(
            `Number of file paths (${filePathsArray.length}) must match number of files (${files.length})`,
          );
        }
      } catch (error) {
        throw new BadRequestException(`Invalid filePaths format: ${error.message}`);
      }
    }

    const deploymentId = uuidv4();
    const uploadedAssets: (typeof assets.$inferSelect)[] = [];
    const failed: { file: string; error: string }[] = [];
    let totalSize = 0;

    // Parse commit timestamp if provided
    const committedAt = this.parseCommittedAt(dto.committedAt);

    // Parse tags if provided
    const tags = this.parseTags(dto.tags);

    // Resolve proxy rule set name to ID if provided
    const resolvedProxyRuleSetId = await this.resolveProxyRuleSetId(
      project.id,
      dto.proxyRuleSetName,
      dto.proxyRuleSetId,
    );

    // Upload each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Use provided path if available, otherwise fall back to original filename
        const filePath = filePathsArray[i] || file.originalname;

        const publicPath = this.normalizePublicPath(filePath);
        const storageKey = this.generateStorageKey(dto.repository, dto.commitSha, publicPath);

        // Compute content hash for ETag optimization (MD5)
        const contentHash = crypto.createHash('md5').update(file.buffer).digest('hex');

        // Upload to storage
        await this.storageAdapter.upload(file.buffer, storageKey, {
          contentType: file.mimetype,
        });

        // Check if asset already exists (upsert logic for re-runs)
        const [existingAsset] = await db
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.projectId, project.id),
              eq(assets.commitSha, dto.commitSha),
              eq(assets.publicPath, publicPath),
            ),
          )
          .limit(1);

        let newAsset: Asset;
        if (existingAsset) {
          // Update existing asset
          const [updated] = await db
            .update(assets)
            .set({
              fileName: filePath.split('/').pop() || filePath,
              originalPath: filePath,
              storageKey,
              mimeType: file.mimetype,
              size: file.size,
              contentHash,
              branch: dto.branch,
              uploadedBy: userId,
              deploymentId,
              description: dto.description,
              committedAt,
              tags,
              updatedAt: new Date(),
            })
            .where(eq(assets.id, existingAsset.id))
            .returning();
          newAsset = updated;
        } else {
          // Insert new asset
          const [inserted] = await db
            .insert(assets)
            .values({
              fileName: filePath.split('/').pop() || filePath,
              originalPath: filePath,
              storageKey,
              mimeType: file.mimetype,
              size: file.size,
              contentHash,
              projectId: project.id,
              branch: dto.branch,
              commitSha: dto.commitSha,
              uploadedBy: userId,
              deploymentId,
              publicPath,
              assetType: AssetType.COMMITS,
              description: dto.description,
              committedAt,
              tags,
            })
            .returning();
          newAsset = inserted;
        }

        uploadedAssets.push(newAsset);
        totalSize += file.size;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failed.push({ file: file.originalname, error: errorMessage });
      }
    }

    if (uploadedAssets.length === 0) {
      throw new BadRequestException('All file uploads failed');
    }

    // Create or update alias if provided
    const aliases: string[] = [];
    if (dto.alias) {
      try {
        await this.createOrUpdateAlias(dto.repository, dto.alias, dto.commitSha, deploymentId);
        aliases.push(dto.alias);
      } catch (error) {
        // Alias creation failure is non-critical
        console.error(`Failed to create/update alias ${dto.alias}:`, error.message);
      }
    }

    // Auto-create preview alias (defaults to "/" if basePath not provided)
    const effectiveBasePath = dto.basePath || '/';
    const previewAliasName = generatePreviewAliasName(
      dto.commitSha,
      dto.repository,
      effectiveBasePath,
    );
    try {
      await this.createOrUpdateAlias(
        dto.repository,
        previewAliasName,
        dto.commitSha,
        deploymentId,
        {
          isAutoPreview: true,
          basePath: effectiveBasePath,
          proxyRuleSetId: resolvedProxyRuleSetId,
        },
      );
      aliases.push(previewAliasName);
    } catch (error) {
      this.logger.warn(`Failed to create preview alias: ${error.message}`);
    }

    // Generate URLs
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
    const primaryDomain = process.env.PRIMARY_DOMAIN;

    // Build preview URL using PRIMARY_DOMAIN if available
    let previewUrl: string | undefined;
    if (primaryDomain) {
      previewUrl = `https://${previewAliasName}.${primaryDomain}/`;
    } else {
      // Fallback for development: use path-based URL
      previewUrl = `${baseUrl}/public/subdomain-alias/${previewAliasName}/`;
    }

    const urls = {
      sha: `${baseUrl}/repo/${dto.repository}/${dto.commitSha}`,
      default: `${baseUrl}/public/${dto.repository}/`,
      preview: previewUrl,
    };

    // Report usage to Control Plane (fire-and-forget)
    this.usageReporter.reportUpload(totalSize).catch(() => {});

    return {
      deploymentId,
      commitSha: dto.commitSha,
      fileCount: uploadedAssets.length,
      totalSize,
      urls,
      aliases,
      failed: failed.length > 0 ? failed : undefined,
    };
  }

  /**
   * List deployments with filtering and pagination
   */
  async listDeployments(
    query: ListDeploymentsQueryDto,
    userId: string,
    userRole: string,
  ): Promise<ListDeploymentsResponseDto> {
    const { page = 1, limit = 20, sortBy, sortOrder } = query;
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions: SQL<unknown>[] = [];

    // Filters
    if (query.repository) {
      // Phase 3H: Convert repository string to projectId
      const [owner, name] = query.repository.split('/');
      if (owner && name) {
        try {
          const project = await this.projectsService.getProjectByOwnerName(owner, name);

          // Phase 3H.6: Check project access for non-admin users
          if (userRole !== 'admin') {
            const role = await this.permissionsService.getUserProjectRole(userId, project.id);
            if (!role) {
              // User has no access to this project
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

          conditions.push(eq(assets.projectId, project.id));
        } catch (error) {
          // Project not found - return empty results
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
    }
    if (query.branch) {
      conditions.push(eq(assets.branch, query.branch));
    }
    if (query.commitSha) {
      conditions.push(like(assets.commitSha, `${query.commitSha}%`));
    }
    // Phase 3H.7: isPublic filter removed - now handled at project level
    if (query.isPublic !== undefined) {
      // Filter by project visibility
      conditions.push(eq(projects.isPublic, query.isPublic));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Phase 3H.7: Join with projects to get repository and isPublic info
    // Get unique deployments (group by deploymentId)
    // We need to aggregate data per deployment
    const allAssets = await db
      .select({
        asset: assets,
        project: projects,
      })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(whereClause)
      .orderBy(desc(assets.createdAt));

    // Group by deploymentId
    const deploymentMap = new Map<
      string,
      {
        assets: (typeof assets.$inferSelect)[];
        repository: string;
        commitSha: string;
        branch: string | null;
        isPublic: boolean;
        description: string | null;
        createdAt: Date;
        updatedAt: Date;
      }
    >();

    for (const row of allAssets) {
      const asset = row.asset;
      const project = row.project;
      if (!asset.deploymentId) continue;

      const key = asset.deploymentId;
      if (!deploymentMap.has(key)) {
        // Phase 3H.7: Derive repository from project
        const repository = project ? `${project.owner}/${project.name}` : '';
        const isPublic = project?.isPublic ?? false;

        deploymentMap.set(key, {
          assets: [],
          repository,
          commitSha: asset.commitSha || '',
          branch: asset.branch,
          isPublic,
          description: asset.description,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        });
      }
      deploymentMap.get(key)!.assets.push(asset);
    }

    // Phase 3H.6: No longer filter by allowedRepositories - authorization handled by project permissions
    const deployments = Array.from(deploymentMap.entries());

    // Sort
    const sortField = sortBy || DeploymentSortField.CREATED_AT;
    const order = sortOrder || SortOrder.DESC;
    deployments.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case DeploymentSortField.REPOSITORY:
          aVal = a[1].repository;
          bVal = b[1].repository;
          break;
        case DeploymentSortField.COMMIT_SHA:
          aVal = a[1].commitSha;
          bVal = b[1].commitSha;
          break;
        case DeploymentSortField.UPDATED_AT:
          aVal = a[1].updatedAt;
          bVal = b[1].updatedAt;
          break;
        default:
          aVal = a[1].createdAt;
          bVal = b[1].createdAt;
      }
      if (order === SortOrder.ASC) {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      }
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    });

    // Paginate
    const total = deployments.length;
    const paginatedDeployments = deployments.slice(offset, offset + limit);

    // Get aliases for each deployment
    const deploymentIds = paginatedDeployments.map(([id]) => id);
    const aliasesData =
      deploymentIds.length > 0
        ? await db.select().from(deploymentAliases).where(
            // This is a workaround - we'll filter in memory
            eq(deploymentAliases.deploymentId, deploymentIds[0]),
          )
        : [];

    // Build response
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
    const data: DeploymentResponseDto[] = paginatedDeployments.map(
      ([deploymentId, deploymentData]) => {
        const totalSize = deploymentData.assets.reduce((sum, a) => sum + a.size, 0);
        const deploymentAliasesList = aliasesData
          .filter((a) => a.deploymentId === deploymentId)
          .map((a) => a.alias);

        return {
          deploymentId,
          repository: deploymentData.repository,
          commitSha: deploymentData.commitSha,
          branch: deploymentData.branch || undefined,
          isPublic: deploymentData.isPublic,
          description: deploymentData.description || undefined,
          fileCount: deploymentData.assets.length,
          totalSize,
          createdAt: deploymentData.createdAt,
          updatedAt: deploymentData.updatedAt,
          urls: {
            sha: `${baseUrl}/repo/${deploymentData.repository}/${deploymentData.commitSha}`,
            default: `${baseUrl}/public/${deploymentData.repository}/`,
          },
          aliases: deploymentAliasesList,
        };
      },
    );

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get deployment details including all files
   */
  async getDeployment(
    deploymentId: string,
    userId: string,
    userRole: string,
  ): Promise<DeploymentDetailResponseDto> {
    // Phase 3H.7: Join with projects to get repository and isPublic info
    // Get all assets for this deployment
    const results = await db
      .select({
        asset: assets,
        project: projects,
      })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(eq(assets.deploymentId, deploymentId));

    if (results.length === 0) {
      throw new NotFoundException(`Deployment not found: ${deploymentId}`);
    }

    const firstResult = results[0];
    const firstAsset = firstResult.asset;
    const project = firstResult.project;

    // Phase 3H.6: Check project access
    if (firstAsset.projectId) {
      await this.checkProjectAccess(firstAsset.projectId, userId, userRole, 'viewer');
    }

    // Phase 3H.7: Derive repository from project
    const repository = project ? `${project.owner}/${project.name}` : '';
    const isPublic = project?.isPublic ?? false;

    // Get aliases
    const aliases = await db
      .select()
      .from(deploymentAliases)
      .where(eq(deploymentAliases.deploymentId, deploymentId));

    const deploymentAssets = results.map((r) => r.asset);
    const totalSize = deploymentAssets.reduce((sum, a) => sum + a.size, 0);
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

    return {
      deploymentId,
      repository,
      commitSha: firstAsset.commitSha || '',
      branch: firstAsset.branch || undefined,
      isPublic,
      description: firstAsset.description || undefined,
      fileCount: deploymentAssets.length,
      totalSize,
      createdAt: firstAsset.createdAt,
      updatedAt: firstAsset.updatedAt,
      urls: {
        sha: `${baseUrl}/repo/${repository}/${firstAsset.commitSha}`,
        default: `${baseUrl}/public/${repository}/`,
      },
      aliases: aliases.map((a) => a.alias),
      files: deploymentAssets.map((asset) => ({
        id: asset.id,
        fileName: asset.fileName,
        publicPath: asset.publicPath || asset.fileName,
        mimeType: asset.mimeType,
        size: asset.size,
      })),
    };
  }

  /**
   * Delete entire deployment and all its files
   */
  async deleteDeployment(deploymentId: string, userId: string, userRole: string): Promise<void> {
    // Get all assets for this deployment
    const deploymentAssets = await db
      .select()
      .from(assets)
      .where(eq(assets.deploymentId, deploymentId));

    if (deploymentAssets.length === 0) {
      throw new NotFoundException(`Deployment not found: ${deploymentId}`);
    }

    const firstAsset = deploymentAssets[0];

    // Phase 3H.6: Check project access with proper permission system
    if (!firstAsset.projectId) {
      throw new BadRequestException('Deployment has no associated project');
    }

    await this.checkProjectAccess(firstAsset.projectId, userId, userRole, 'contributor');

    // Calculate total size for usage reporting
    const totalSize = deploymentAssets.reduce((sum, asset) => sum + (asset.size || 0), 0);

    // Delete files from storage
    for (const asset of deploymentAssets) {
      try {
        await this.storageAdapter.delete(asset.storageKey);
      } catch (error) {
        // Continue deleting even if some files fail
      }
    }

    // Delete aliases
    await db.delete(deploymentAliases).where(eq(deploymentAliases.deploymentId, deploymentId));

    // Delete assets from database
    await db.delete(assets).where(eq(assets.deploymentId, deploymentId));

    // Report usage to Control Plane (fire-and-forget)
    this.usageReporter.reportDelete(totalSize).catch(() => {});
  }

  /**
   * Delete a commit and all its deployments
   * Validates that no aliases point to this commit
   */
  async deleteCommit(
    owner: string,
    repo: string,
    commitSha: string,
    userId: string,
    userRole?: string,
  ): Promise<DeleteCommitResponseDto> {
    // Get project
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Check project access with proper permission system
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    // Check for aliases pointing to this commit
    const allAliases = await this.getAliasesForCommit(project.id, commitSha);
    const manualAliases = allAliases.filter((a) => !a.isAutoPreview);
    const previewAliases = allAliases.filter((a) => a.isAutoPreview);

    // Block deletion only for manual aliases
    if (manualAliases.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Cannot delete commit with active aliases',
        aliases: manualAliases.map((a) => a.alias),
      });
    }

    // Auto-delete preview aliases
    if (previewAliases.length > 0) {
      await db
        .delete(deploymentAliases)
        .where(
          and(
            eq(deploymentAliases.projectId, project.id),
            eq(deploymentAliases.commitSha, commitSha),
            eq(deploymentAliases.isAutoPreview, true),
          ),
        );
    }

    // Get all deployments (assets) for this commit
    const commitAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, commitSha)));

    if (commitAssets.length === 0) {
      throw new NotFoundException('Commit not found');
    }

    // Calculate stats before deletion
    const deploymentIds = [...new Set(commitAssets.map((a) => a.deploymentId).filter(Boolean))];
    const totalFiles = commitAssets.length;
    const totalSize = commitAssets.reduce((sum, a) => sum + (a.size || 0), 0);

    // Delete from database (transaction)
    await db.transaction(async (tx) => {
      // Delete assets first (they belong to deployments)
      await tx
        .delete(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, commitSha)));
    });

    // Delete from storage (after transaction commits)
    // Storage key format matches generateStorageKey: owner/repo/commits/commitSha/
    const storageKey = `${owner}/${repo}/commits/${commitSha}/`;
    try {
      const result = await this.storageAdapter.deletePrefix(storageKey);
      this.logger.log({
        event: 'storage_cleanup',
        storageKey,
        deletedFromStorage: result.deleted,
        failedFiles: result.failed.length > 0 ? result.failed : undefined,
      });
    } catch (error) {
      this.logger.error(`Storage cleanup failed for ${storageKey}`, error);
      // Continue - database is already cleaned up
      // Storage can be cleaned up later by maintenance job
    }

    // Log deletion
    this.logger.log({
      event: 'commit_deleted',
      owner,
      repo,
      commitSha,
      userId,
      deletedDeployments: deploymentIds.length,
      deletedFiles: totalFiles,
      freedBytes: totalSize,
    });

    // Report usage to Control Plane (fire-and-forget)
    this.usageReporter.reportDelete(totalSize).catch(() => {});

    return {
      message: 'Commit deleted successfully',
      deletedDeployments: deploymentIds.length,
      deletedFiles: totalFiles,
      freedBytes: totalSize,
    };
  }

  /**
   * Get aliases pointing to a specific commit
   */
  private async getAliasesForCommit(
    projectId: string,
    commitSha: string,
  ): Promise<{ alias: string; isAutoPreview: boolean }[]> {
    return db
      .select({
        alias: deploymentAliases.alias,
        isAutoPreview: deploymentAliases.isAutoPreview,
      })
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.commitSha, commitSha)),
      );
  }

  // Alias Management Methods

  /**
   * Create or update an alias
   */
  async createOrUpdateAlias(
    repository: string,
    alias: string,
    commitSha: string,
    deploymentId: string,
    options?: { isAutoPreview?: boolean; basePath?: string; proxyRuleSetId?: string },
  ): Promise<AliasResponseDto> {
    // Phase 3H: Convert repository string to projectId
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }
    const project = await this.projectsService.getProjectByOwnerName(owner, name);

    // Check if alias exists
    const [existingAlias] = await db
      .select()
      .from(deploymentAliases)
      .where(and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, alias)))
      .limit(1);

    if (existingAlias) {
      // Update existing alias
      // Build update data - only include proxyRuleSetId if explicitly provided
      const updateData: Record<string, unknown> = {
        commitSha,
        deploymentId,
        updatedAt: new Date(),
      };

      // Only update proxyRuleSetId if explicitly provided in options
      // This allows CI/CD to update the rule set while preserving existing if not specified
      const proxyRuleSetIdChanged = options?.proxyRuleSetId !== undefined;
      if (proxyRuleSetIdChanged) {
        updateData.proxyRuleSetId = options.proxyRuleSetId;
      }

      const [updated] = await db
        .update(deploymentAliases)
        .set(updateData)
        .where(eq(deploymentAliases.id, existingAlias.id))
        .returning();

      // Regenerate nginx configs if proxyRuleSetId changed
      if (proxyRuleSetIdChanged) {
        try {
          await this.nginxRegenerationService.regenerateForAlias(project.id, alias);
        } catch (error) {
          // Rollback the proxyRuleSetId change
          await db
            .update(deploymentAliases)
            .set({ proxyRuleSetId: existingAlias.proxyRuleSetId })
            .where(eq(deploymentAliases.id, existingAlias.id));
          throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
        }
      }

      return this.toAliasResponse(updated);
    }

    // Create new alias
    const [newAlias] = await db
      .insert(deploymentAliases)
      .values({
        projectId: project.id, // Phase 3H: Use projectId
        repository, // DEPRECATED - kept for migration
        alias,
        commitSha,
        deploymentId,
        isAutoPreview: options?.isAutoPreview ?? false,
        basePath: options?.basePath,
        proxyRuleSetId: options?.proxyRuleSetId,
      })
      .returning();

    // Regenerate nginx configs if alias has proxy rules (explicit or inherited from project default)
    const hasProxyRules =
      options?.proxyRuleSetId !== undefined || project.defaultProxyRuleSetId !== null;
    if (hasProxyRules) {
      try {
        await this.nginxRegenerationService.regenerateForAlias(project.id, alias);
      } catch (error) {
        // Rollback by deleting the newly created alias
        await db.delete(deploymentAliases).where(eq(deploymentAliases.id, newAlias.id));
        throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
      }
    }

    return this.toAliasResponse(newAlias);
  }

  /**
   * Create alias for a deployment
   */
  async createAlias(
    deploymentId: string,
    dto: CreateAliasDto,
    userId: string,
    userRole: string,
  ): Promise<AliasResponseDto> {
    // Phase 3H.7: Join with projects to get repository info
    // Get deployment to verify access and get repository
    const [result] = await db
      .select({
        asset: assets,
        project: projects,
      })
      .from(assets)
      .leftJoin(projects, eq(assets.projectId, projects.id))
      .where(eq(assets.deploymentId, deploymentId))
      .limit(1);

    if (!result) {
      throw new NotFoundException(`Deployment not found: ${deploymentId}`);
    }

    const firstAsset = result.asset;
    const project = result.project;

    // Verify commit SHA matches
    if (firstAsset.commitSha !== dto.commitSha) {
      throw new BadRequestException(
        `Commit SHA ${dto.commitSha} does not match deployment commit SHA ${firstAsset.commitSha}`,
      );
    }

    // Phase 3H.6: Check project access with proper permission system
    if (!firstAsset.projectId) {
      throw new BadRequestException('Deployment has no associated project');
    }

    await this.checkProjectAccess(firstAsset.projectId, userId, userRole, 'contributor');

    // Phase 3H.7: Derive repository from project
    const repository = project ? `${project.owner}/${project.name}` : '';

    return this.createOrUpdateAlias(repository, dto.alias, dto.commitSha, deploymentId);
  }

  /**
   * Update alias to point to different commit SHA
   */
  async updateAlias(
    repository: string,
    alias: string,
    dto: UpdateAliasDto,
    userId: string,
    userRole: string,
  ): Promise<AliasResponseDto> {
    // Phase 3H: Parse repository and get project
    const [owner, name] = repository.split('/');
    const project = await this.projectsService.getProjectByOwnerName(owner, name);

    // Phase 3H.6: Check project access with proper permission system
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    // Find existing alias
    // Phase 3H: Use projectId instead of repository string
    const [existingAlias] = await db
      .select()
      .from(deploymentAliases)
      .where(and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, alias)))
      .limit(1);

    if (!existingAlias) {
      throw new NotFoundException(`Alias not found: ${alias}`);
    }

    // Build update data
    const updateData: Partial<typeof deploymentAliases.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Handle commitSha update if provided
    if (dto.commitSha) {
      // Find deployment with the new commit SHA
      // Phase 3H: Use projectId instead of repository string
      const [targetAsset] = await db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, dto.commitSha)))
        .limit(1);

      if (!targetAsset || !targetAsset.deploymentId) {
        throw new NotFoundException(
          `No deployment found for repository ${repository} with commit SHA ${dto.commitSha}`,
        );
      }

      updateData.commitSha = dto.commitSha;
      updateData.deploymentId = targetAsset.deploymentId;
    }

    // Handle proxyRuleSetId update if provided (including null to clear)
    const proxyRuleSetIdChanged = dto.proxyRuleSetId !== undefined;
    if (proxyRuleSetIdChanged) {
      updateData.proxyRuleSetId = dto.proxyRuleSetId;
    }

    // Update alias
    const [updated] = await db
      .update(deploymentAliases)
      .set(updateData)
      .where(eq(deploymentAliases.id, existingAlias.id))
      .returning();

    // Regenerate nginx configs if proxyRuleSetId changed
    if (proxyRuleSetIdChanged) {
      try {
        await this.nginxRegenerationService.regenerateForAlias(project.id, alias);
      } catch (error) {
        // Rollback the proxyRuleSetId change
        await db
          .update(deploymentAliases)
          .set({ proxyRuleSetId: existingAlias.proxyRuleSetId })
          .where(eq(deploymentAliases.id, existingAlias.id));
        throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
      }
    }

    return this.toAliasResponse(updated);
  }

  /**
   * Delete an alias
   */
  async deleteAlias(
    repository: string,
    alias: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    // Phase 3H: Parse repository and get project
    const [owner, name] = repository.split('/');
    const project = await this.projectsService.getProjectByOwnerName(owner, name);

    // Phase 3H.6: Check project access with proper permission system
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    // Phase 3H: Use projectId instead of repository string
    const result = await db
      .delete(deploymentAliases)
      .where(and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, alias)))
      .returning();

    if (result.length === 0) {
      throw new NotFoundException(`Alias not found: ${alias}`);
    }
  }

  /**
   * List aliases
   */
  async listAliases(
    query: ListAliasesQueryDto,
    userId: string,
    userRole: string,
  ): Promise<ListAliasesResponseDto> {
    const conditions: SQL<unknown>[] = [];

    if (query.repository) {
      // Phase 3H: Convert repository string to projectId
      const [owner, name] = query.repository.split('/');
      if (owner && name) {
        try {
          const project = await this.projectsService.getProjectByOwnerName(owner, name);

          // Phase 3H.6: Check project access for non-admin users
          if (userRole !== 'admin') {
            const role = await this.permissionsService.getUserProjectRole(userId, project.id);
            if (!role) {
              // User has no access to this project
              return { data: [] };
            }
          }

          conditions.push(eq(deploymentAliases.projectId, project.id));
        } catch (error) {
          // Project not found - return empty results
          return { data: [] };
        }
      }
    }

    // By default, exclude auto-preview aliases from the list
    if (!query.includeAutoPreview) {
      conditions.push(eq(deploymentAliases.isAutoPreview, false));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const aliases = await db
      .select()
      .from(deploymentAliases)
      .where(whereClause)
      .orderBy(desc(deploymentAliases.updatedAt));

    return {
      data: aliases.map((a) => this.toAliasResponse(a)),
    };
  }

  /**
   * Resolve alias to commit SHA
   */
  async resolveAlias(repository: string, alias: string): Promise<string | null> {
    // Phase 3H: Convert repository string to projectId
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      return null;
    }

    let project;
    try {
      project = await this.projectsService.getProjectByOwnerName(owner, name);
    } catch (error) {
      return null;
    }

    const [aliasRecord] = await db
      .select()
      .from(deploymentAliases)
      .where(and(eq(deploymentAliases.projectId, project.id), eq(deploymentAliases.alias, alias)))
      .limit(1);

    return aliasRecord?.commitSha || null;
  }

  /**
   * Get default alias for repository (production > main > master > latest)
   */
  async getDefaultAlias(repository: string): Promise<string | null> {
    // Phase 3H: Convert repository string to projectId
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      return null;
    }

    let project;
    try {
      project = await this.projectsService.getProjectByOwnerName(owner, name);
    } catch (error) {
      return null;
    }

    const priorityOrder = ['production', 'main', 'master', 'latest'];

    for (const alias of priorityOrder) {
      const sha = await this.resolveAlias(repository, alias);
      if (sha) return sha;
    }

    // If no standard aliases, get the most recent public deployment
    // Phase 3H: Use projectId and project.isPublic instead of assets.isPublic
    const [latestAsset] = await db
      .select()
      .from(assets)
      .where(eq(assets.projectId, project.id))
      .orderBy(desc(assets.createdAt))
      .limit(1);

    // Only return if project is public
    return project.isPublic ? latestAsset?.commitSha || null : null;
  }

  // Helper methods

  /**
   * Parse committedAt timestamp from FormData (ISO 8601 string)
   * Returns Date object or undefined if not provided/invalid
   */
  private parseCommittedAt(committedAtInput?: string): Date | undefined {
    if (!committedAtInput) {
      return undefined;
    }

    try {
      const date = new Date(committedAtInput);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse tags from FormData (JSON array string or comma-separated)
   * Returns JSON string for database storage or undefined if not provided
   */
  private parseTags(tagsInput?: string): string | undefined {
    if (!tagsInput) {
      return undefined;
    }

    let parsed: string[];
    try {
      // Try parsing as JSON array first
      const jsonParsed = JSON.parse(tagsInput);
      if (Array.isArray(jsonParsed)) {
        parsed = jsonParsed.map((t) => String(t).trim()).filter(Boolean);
      } else {
        // Single value, wrap in array
        parsed = [String(jsonParsed).trim()].filter(Boolean);
      }
    } catch {
      // Not JSON, treat as comma-separated string
      parsed = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // Return as JSON string for database storage
    return parsed.length > 0 ? JSON.stringify(parsed) : undefined;
  }

  private normalizePublicPath(originalPath: string): string {
    // Remove leading slashes and normalize path
    return originalPath.replace(/^\/+/, '').replace(/\\/g, '/');
  }

  private generateStorageKey(repository: string, commitSha: string, publicPath: string): string {
    // Format: owner/repo/commits/commitSha/path
    const cleanPath = publicPath.startsWith('/') ? publicPath.slice(1) : publicPath;
    return `${repository}/commits/${commitSha}/${cleanPath}`;
  }

  private toAliasResponse(alias: typeof deploymentAliases.$inferSelect): AliasResponseDto {
    return {
      id: alias.id,
      repository: alias.repository,
      alias: alias.alias,
      commitSha: alias.commitSha,
      deploymentId: alias.deploymentId,
      isAutoPreview: alias.isAutoPreview,
      basePath: alias.basePath ?? undefined,
      createdAt: alias.createdAt,
      updatedAt: alias.updatedAt,
    };
  }

  // Phase: Pre-signed URL Artifact Uploads

  /**
   * Generate storage key for a file
   * Exposed for use by controller when preparing presigned URLs
   */
  generateStorageKeyPublic(repository: string, commitSha: string, publicPath: string): string {
    return this.generateStorageKey(repository, commitSha, this.normalizePublicPath(publicPath));
  }

  /**
   * Create asset records from a file manifest (for presigned URL uploads)
   * This method creates database records without handling file content - files are
   * already uploaded directly to storage via presigned URLs.
   */
  async createAssetsFromManifest(
    params: {
      projectId: string;
      repository: string;
      commitSha: string;
      branch?: string;
      description?: string;
      tags?: string;
      proxyRuleSetId?: string;
      alias?: string;
      basePath?: string;
      files: Array<{
        path: string;
        size: number;
        contentType: string;
        storageKey: string;
      }>;
      userId?: string;
    },
    userRole?: string,
  ): Promise<{
    deploymentId: string;
    fileCount: number;
    totalSize: number;
    aliases: string[];
    failed: { file: string; error: string }[];
  }> {
    const deploymentId = uuidv4();
    const uploadedAssets: (typeof assets.$inferSelect)[] = [];
    const failed: { file: string; error: string }[] = [];
    let totalSize = 0;

    // Parse tags if provided
    const tags = this.parseTags(params.tags);

    for (const file of params.files) {
      try {
        const publicPath = this.normalizePublicPath(file.path);
        const fileName = file.path.split('/').pop() || file.path;

        // Check if asset already exists (upsert logic for re-runs)
        const [existingAsset] = await db
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.projectId, params.projectId),
              eq(assets.commitSha, params.commitSha),
              eq(assets.publicPath, publicPath),
            ),
          )
          .limit(1);

        let newAsset: Asset;
        if (existingAsset) {
          // Update existing asset
          const [updated] = await db
            .update(assets)
            .set({
              fileName,
              originalPath: file.path,
              storageKey: file.storageKey,
              mimeType: file.contentType,
              size: file.size,
              branch: params.branch,
              uploadedBy: params.userId,
              deploymentId,
              description: params.description,
              tags,
              updatedAt: new Date(),
            })
            .where(eq(assets.id, existingAsset.id))
            .returning();
          newAsset = updated;
        } else {
          // Insert new asset
          const [inserted] = await db
            .insert(assets)
            .values({
              fileName,
              originalPath: file.path,
              storageKey: file.storageKey,
              mimeType: file.contentType,
              size: file.size,
              projectId: params.projectId,
              branch: params.branch,
              commitSha: params.commitSha,
              uploadedBy: params.userId,
              deploymentId,
              publicPath,
              assetType: AssetType.COMMITS,
              description: params.description,
              tags,
            })
            .returning();
          newAsset = inserted;
        }

        uploadedAssets.push(newAsset);
        totalSize += file.size;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failed.push({ file: file.path, error: errorMessage });
        this.logger.error(`Failed to create asset record for ${file.path}:`, errorMessage);
      }
    }

    // Create or update aliases
    const aliases: string[] = [];

    // User-specified alias
    if (params.alias) {
      try {
        await this.createOrUpdateAlias(
          params.repository,
          params.alias,
          params.commitSha,
          deploymentId,
          {
            proxyRuleSetId: params.proxyRuleSetId,
          },
        );
        aliases.push(params.alias);
      } catch (error) {
        this.logger.warn(`Failed to create/update alias ${params.alias}:`, error.message);
      }
    }

    // Auto-create preview alias
    const effectiveBasePath = params.basePath || '/';
    const previewAliasName = generatePreviewAliasName(
      params.commitSha,
      params.repository,
      effectiveBasePath,
    );
    try {
      await this.createOrUpdateAlias(
        params.repository,
        previewAliasName,
        params.commitSha,
        deploymentId,
        {
          isAutoPreview: true,
          basePath: effectiveBasePath,
          proxyRuleSetId: params.proxyRuleSetId,
        },
      );
      aliases.push(previewAliasName);
    } catch (error) {
      this.logger.warn(`Failed to create preview alias: ${error.message}`);
    }

    // Report usage to Control Plane (fire-and-forget)
    this.usageReporter.reportUpload(totalSize).catch(() => {});

    return {
      deploymentId,
      fileCount: uploadedAssets.length,
      totalSize,
      aliases,
      failed,
    };
  }

  // Phase B5: Alias Visibility Methods

  /**
   * Update alias visibility setting
   */
  async updateAliasVisibility(
    projectId: string,
    aliasName: string,
    isPublic: boolean | null,
    userId: string,
    userRole: string,
  ): Promise<typeof deploymentAliases.$inferSelect> {
    // Check project access
    await this.checkProjectAccess(projectId, userId, userRole, 'admin');

    // Find existing alias
    const [existingAlias] = await db
      .select()
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)),
      )
      .limit(1);

    if (!existingAlias) {
      throw new NotFoundException(`Alias not found: ${aliasName}`);
    }

    // Update visibility
    const [updated] = await db
      .update(deploymentAliases)
      .set({
        isPublic,
        updatedAt: new Date(),
      })
      .where(eq(deploymentAliases.id, existingAlias.id))
      .returning();

    return updated;
  }

  /**
   * Get alias by project ID and alias name
   */
  async getAlias(
    projectId: string,
    aliasName: string,
    userId: string,
    userRole: string,
  ): Promise<typeof deploymentAliases.$inferSelect | null> {
    // Check project access
    await this.checkProjectAccess(projectId, userId, userRole, 'viewer');

    const [alias] = await db
      .select()
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)),
      )
      .limit(1);

    return alias || null;
  }
}
