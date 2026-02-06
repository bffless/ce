import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { eq, and, desc, asc, sql, count } from 'drizzle-orm';
import { db } from '../db/client';
import { assets, deploymentAliases, proxyRuleSets } from '../db/schema';
import {
  GetFileTreeResponseDto,
  GetRepositoryRefsResponseDto,
  RepositoryRefsQueryDto,
  FileInfoDto,
  AliasRefDto,
  BranchRefDto,
  CommitRefDto,
  GetDeploymentsQueryDto,
  GetDeploymentsResponseDto,
  DeploymentItemDto,
  GetRepositoryStatsResponseDto,
  GetAliasesResponseDto,
  CreateAliasRequestDto,
  UpdateAliasRequestDto,
  AliasCreatedResponseDto,
  GetCommitDetailsResponseDto,
  CommitInfoDto,
  DeploymentInfoDto,
  CommitAliasDto,
} from './repo-browser.dto';
import { DeploymentsService } from '../deployments/deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class RepoBrowserService {
  constructor(
    private readonly deploymentsService: DeploymentsService,
    private readonly projectsService: ProjectsService,
    private readonly permissionsService: PermissionsService,
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
   * Get file tree for a deployment by commit SHA or alias
   * Endpoint: GET /api/repo/:owner/:repo/:ref/files
   */
  async getFileTree(
    owner: string,
    repo: string,
    ref: string,
    userId: string | null,
  ): Promise<GetFileTreeResponseDto> {
    const repository = `${owner}/${repo}`;

    // Phase 3H: Get project first for projectId-based queries
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Determine if ref is SHA or alias (same logic as public.controller.ts)
    const isSha = /^[a-f0-9]{7,40}$/i.test(ref);
    let commitSha: string;

    if (isSha) {
      commitSha = ref;
    } else {
      // Resolve alias to SHA
      const resolvedSha = await this.deploymentsService.resolveAlias(repository, ref);
      if (!resolvedSha) {
        throw new NotFoundException(`Alias not found: ${ref}`);
      }
      commitSha = resolvedSha;
    }

    // Phase 3H: Find all assets using projectId instead of repository string
    const deploymentAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, commitSha)))
      .orderBy(assets.publicPath);

    if (deploymentAssets.length === 0) {
      throw new NotFoundException(
        `No deployment found for repository ${repository} at commit ${commitSha}`,
      );
    }

    // Check if project is public or user is authenticated
    // PHASE 3E: Switched from asset-level to project-level access control
    // Return 401 for private projects when no user - enables frontend session refresh
    // Note: Frontend will attempt refresh on 401, which is correct for expired sessions.
    // For users with no session at all, the refresh attempt will fail harmlessly.
    if (!project.isPublic && !userId) {
      throw new UnauthorizedException('Authentication required to access this resource');
    }

    const firstAsset = deploymentAssets[0];

    // Map to response format
    const files: FileInfoDto[] = deploymentAssets.map((asset) => ({
      path: asset.publicPath || asset.fileName,
      fileName: asset.fileName,
      size: asset.size,
      mimeType: asset.mimeType,
      // Phase 3H.7: isPublic field removed - visibility now controlled at project level
      isPublic: false, // Default value for backward compatibility
      createdAt: asset.createdAt.toISOString(),
    }));

    return {
      commitSha,
      repository,
      branch: firstAsset.branch || undefined,
      files,
    };
  }

  /**
   * Get repository refs (aliases, branches, recent commits)
   * Endpoint: GET /api/repo/:owner/:repo/refs
   * Supports cursor-based pagination for commits
   */
  async getRepositoryRefs(
    owner: string,
    repo: string,
    query: RepositoryRefsQueryDto = {},
  ): Promise<GetRepositoryRefsResponseDto> {
    const { cursor, limit = 50 } = query;

    // Phase 3H: Get project first for projectId-based queries
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Note: This endpoint returns metadata (aliases, branches, commits)
    // Privacy is enforced when actually requesting files via getFileTree()

    // Phase 3H: Get all aliases using projectId
    const aliasesData = await db
      .select()
      .from(deploymentAliases)
      .where(eq(deploymentAliases.projectId, project.id))
      .orderBy(desc(deploymentAliases.updatedAt));

    const aliases: AliasRefDto[] = aliasesData.map((alias) => ({
      name: alias.alias,
      commitSha: alias.commitSha,
      updatedAt: alias.updatedAt.toISOString(),
      isAutoPreview: alias.isAutoPreview,
    }));

    // Get distinct branches with latest commit info
    // We need to group by branch and get the latest deployment for each
    // Note: We use a correlated subquery for latestCommit instead of MAX(commitSha)
    // because MAX() on strings does alphabetical ordering ('e' > 'd'), not temporal ordering.
    // The subquery finds the commit_sha from the asset with the most recent created_at
    // timestamp for each branch, ensuring we get the actually latest deployed commit.
    // Phase 3H: Use projectId instead of repository string
    // Use COALESCE to prefer committedAt (actual git commit time) over createdAt (deployment time)
    // This ensures correct ordering even when older commits are deployed later
    const branchesQuery = await db
      .select({
        branch: assets.branch,
        latestCommit: sql<string>`(
          SELECT a2.commit_sha
          FROM assets a2
          WHERE a2.project_id = ${project.id}
            AND a2.branch = assets.branch
            AND a2.branch IS NOT NULL
          ORDER BY COALESCE(a2.committed_at, a2.created_at) DESC
          LIMIT 1
        )`,
        latestDeployedAt: sql<Date>`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`,
        fileCount: sql<number>`COUNT(DISTINCT ${assets.deploymentId})`,
      })
      .from(assets)
      .where(and(eq(assets.projectId, project.id), sql`${assets.branch} IS NOT NULL`))
      .groupBy(assets.branch)
      .orderBy(desc(sql`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`));

    // For each branch, get the actual file count from the latest deployment
    const branches: BranchRefDto[] = await Promise.all(
      branchesQuery.map(async (branchData) => {
        if (!branchData.branch) {
          return null;
        }

        // Get file count for the latest commit on this branch
        const [fileCountResult] = await db
          .select({
            count: sql<number>`COUNT(*)`,
          })
          .from(assets)
          .where(
            and(
              eq(assets.projectId, project.id),
              eq(assets.branch, branchData.branch),
              eq(assets.commitSha, branchData.latestCommit),
            ),
          );

        return {
          name: branchData.branch,
          latestCommit: branchData.latestCommit,
          latestDeployedAt: new Date(branchData.latestDeployedAt).toISOString(),
          fileCount: Number(fileCountResult?.count || 0),
        };
      }),
    ).then((results) => results.filter((b): b is BranchRefDto => b !== null));

    // Get total count of unique commits for pagination
    const [totalCountResult] = await db
      .select({
        count: sql<number>`COUNT(DISTINCT ${assets.commitSha})`,
      })
      .from(assets)
      .where(and(eq(assets.projectId, project.id), sql`${assets.commitSha} IS NOT NULL`));
    const total = Number(totalCountResult?.count || 0);

    // Build conditions for cursor-based pagination
    // If cursor is provided, we need to find commits older than the cursor commit
    let cursorCondition: ReturnType<typeof sql> | null = null;
    if (cursor) {
      // Get the committedAt/createdAt timestamp for the cursor commit
      const cursorCommitQuery = await db
        .select({
          deployedAt: sql<Date>`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`,
        })
        .from(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, cursor)))
        .groupBy(assets.commitSha);

      if (cursorCommitQuery.length > 0) {
        const cursorDeployedAt = cursorCommitQuery[0].deployedAt;
        cursorCondition = sql`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt})) < ${cursorDeployedAt}`;
      }
    }

    // Get recent commits with pagination (fetch limit + 1 to check if there are more)
    // Note: We group only by commitSha to avoid duplicates when multiple deployments
    // exist for the same commit (e.g., coverage reports, test artifacts, etc.)
    const recentCommitsQuery = await db
      .select({
        sha: assets.commitSha,
        branch: sql<string>`(
          SELECT a2.branch
          FROM assets a2
          WHERE a2.project_id = ${project.id}
            AND a2.commit_sha = assets.commit_sha
          ORDER BY COALESCE(a2.committed_at, a2.created_at) DESC
          LIMIT 1
        )`,
        description: sql<string>`(
          SELECT a2.description
          FROM assets a2
          WHERE a2.project_id = ${project.id}
            AND a2.commit_sha = assets.commit_sha
          ORDER BY COALESCE(a2.committed_at, a2.created_at) DESC
          LIMIT 1
        )`,
        deployedAt: sql<Date>`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`,
      })
      .from(assets)
      .where(and(eq(assets.projectId, project.id), sql`${assets.commitSha} IS NOT NULL`))
      .groupBy(assets.commitSha)
      .having(cursorCondition ? cursorCondition : sql`1=1`)
      .orderBy(desc(sql`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`))
      .limit(limit + 1); // Fetch one extra to detect hasMore

    // Check if there are more commits
    const hasMore = recentCommitsQuery.length > limit;
    const commitsToReturn = hasMore ? recentCommitsQuery.slice(0, limit) : recentCommitsQuery;
    const lastCommit = commitsToReturn[commitsToReturn.length - 1];
    const nextCursor = hasMore && lastCommit?.sha ? lastCommit.sha : undefined;

    const recentCommits: CommitRefDto[] = commitsToReturn
      .filter((commit) => commit.sha !== null)
      .map((commit) => ({
        sha: commit.sha!,
        shortSha: commit.sha!.substring(0, 7),
        branch: commit.branch || undefined,
        description: commit.description || undefined,
        deployedAt: new Date(commit.deployedAt).toISOString(),
      }));

    return {
      aliases,
      branches,
      recentCommits,
      pagination: {
        hasMore,
        nextCursor,
        total,
      },
    };
  }

  /**
   * Get deployments list with pagination and filtering
   * Endpoint: GET /api/repo/:owner/:repo/deployments
   */
  async getDeployments(
    owner: string,
    repo: string,
    query: GetDeploymentsQueryDto,
    userId: string | null,
  ): Promise<GetDeploymentsResponseDto> {
    const repository = `${owner}/${repo}`;

    // PHASE 3E: Check project-level access instead of asset-level
    // If project is private and no user, throw not found
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Apply defaults and validation
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const sortBy = query.sortBy || 'date';
    const order = query.order || 'desc';
    const offset = (page - 1) * limit;

    // Build base query conditions
    const conditions = [eq(assets.projectId, project.id)];

    if (query.branch) {
      conditions.push(eq(assets.branch, query.branch));
    }
    // Return 401 for private projects when no user - enables frontend session refresh
    // Note: Frontend will attempt refresh on 401, which is correct for expired sessions.
    // For users with no session at all, the refresh attempt will fail harmlessly.
    if (!project.isPublic && !userId) {
      throw new UnauthorizedException('Authentication required to access this resource');
    }
    // No need to filter assets by isPublic - all assets in project have same visibility

    // Get unique deployments grouped by deploymentId
    // We need to get distinct deployments, not individual files
    const deploymentsQuery = db
      .select({
        deploymentId: assets.deploymentId,
        commitSha: assets.commitSha,
        branch: assets.branch,
        description: assets.description,
        deployedAt: sql<Date>`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`,
        fileCount: sql<number>`COUNT(*)`,
        totalSize: sql<number>`SUM(${assets.size})`,
        // PHASE 3E: Removed BOOL_OR(assets.isPublic) - will use project.isPublic below
      })
      .from(assets)
      .where(and(...conditions))
      .groupBy(assets.deploymentId, assets.commitSha, assets.branch, assets.description);

    // Apply sorting
    let orderByClause;
    if (sortBy === 'branch') {
      orderByClause = order === 'asc' ? asc(assets.branch) : desc(assets.branch);
    } else {
      // Default to date sorting (use committedAt if available, fallback to createdAt)
      orderByClause =
        order === 'asc'
          ? asc(sql`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`)
          : desc(sql`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`);
    }

    // Get total count
    const countResult = await db.select({ count: count() }).from(
      db
        .select({ deploymentId: assets.deploymentId })
        .from(assets)
        .where(and(...conditions))
        .groupBy(assets.deploymentId)
        .as('deployments_count'),
    );

    const total = Number(countResult[0]?.count || 0);

    // Get paginated deployments
    const deploymentResults = await deploymentsQuery
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const deployments: DeploymentItemDto[] = deploymentResults
      .filter((d) => d.deploymentId && d.commitSha)
      .map((d) => ({
        id: d.deploymentId!,
        commitSha: d.commitSha!,
        shortSha: d.commitSha!.substring(0, 7),
        branch: d.branch || undefined,
        description: d.description || undefined,
        deployedAt: new Date(d.deployedAt).toISOString(),
        fileCount: Number(d.fileCount),
        totalSize: Number(d.totalSize),
        isPublic: project.isPublic, // PHASE 3E: Use project-level visibility
      }));

    return {
      repository,
      page,
      limit,
      total,
      deployments,
    };
  }

  /**
   * Get repository statistics
   * Endpoint: GET /api/repo/:owner/:repo/stats
   */
  async getRepositoryStats(
    owner: string,
    repo: string,
    userId: string | null,
  ): Promise<GetRepositoryStatsResponseDto> {
    const repository = `${owner}/${repo}`;

    // PHASE 3E: Check project-level access instead of asset-level
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    // Return 401 for private projects when no user - enables frontend session refresh
    // Note: Frontend will attempt refresh on 401, which is correct for expired sessions.
    // For users with no session at all, the refresh attempt will fail harmlessly.
    if (!project.isPublic && !userId) {
      throw new UnauthorizedException('Authentication required to access this resource');
    }

    // Base condition for repository
    const conditions = [eq(assets.projectId, project.id)];
    // No need to filter by isPublic - all assets in project have same visibility

    // Get deployment statistics
    const statsQuery = await db
      .select({
        totalDeployments: sql<number>`COUNT(DISTINCT ${assets.deploymentId})`,
        totalStorageBytes: sql<number>`SUM(${assets.size})`,
        lastDeployedAt: sql<Date>`MAX(COALESCE(${assets.committedAt}, ${assets.createdAt}))`,
        branchCount: sql<number>`COUNT(DISTINCT ${assets.branch})`,
        // PHASE 3E: Removed BOOL_OR(assets.isPublic) - will use project.isPublic below
      })
      .from(assets)
      .where(and(...conditions));

    const stats = statsQuery[0];

    // Get alias count
    const aliasCountResult = await db
      .select({ count: count() })
      .from(deploymentAliases)
      .where(eq(deploymentAliases.projectId, project.id));

    const aliasCount = Number(aliasCountResult[0]?.count || 0);

    return {
      repository,
      totalDeployments: Number(stats?.totalDeployments || 0),
      totalStorageBytes: Number(stats?.totalStorageBytes || 0),
      totalStorageMB: Number((Number(stats?.totalStorageBytes || 0) / (1024 * 1024)).toFixed(2)),
      lastDeployedAt: stats?.lastDeployedAt
        ? new Date(stats.lastDeployedAt).toISOString()
        : undefined,
      branchCount: Number(stats?.branchCount || 0),
      aliasCount,
      isPublic: project.isPublic, // PHASE 3E: Use project-level visibility
    };
  }

  /**
   * Get aliases for a repository (Phase 2J)
   * Endpoint: GET /api/repo/:owner/:repo/aliases
   * @param includeAutoPreview - If false (default), filters out auto-generated preview aliases
   */
  async getAliases(
    owner: string,
    repo: string,
    includeAutoPreview: boolean = false,
  ): Promise<GetAliasesResponseDto> {
    const repository = `${owner}/${repo}`;

    // Phase 3H: Get project first for projectId-based queries
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // @TODO: need to add user priviledge logic if repo is not public
    // however public isnt an option yet at the repo level
    // Get aliases for this repository, optionally filtering out auto-preview aliases
    const conditions = [eq(deploymentAliases.projectId, project.id)];

    // Filter out auto-preview aliases unless explicitly requested
    if (!includeAutoPreview) {
      conditions.push(eq(deploymentAliases.isAutoPreview, false));
    }

    const aliasesData = await db
      .select()
      .from(deploymentAliases)
      .where(and(...conditions))
      .orderBy(desc(deploymentAliases.updatedAt));

    // Get branch information for each alias by joining with assets
    const aliasesWithDetails = await Promise.all(
      aliasesData.map(async (alias) => {
        const [asset] = await db
          .select()
          .from(assets)
          .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, alias.commitSha)))
          .limit(1);

        return {
          id: alias.id,
          name: alias.alias,
          commitSha: alias.commitSha,
          shortSha: alias.commitSha.substring(0, 7),
          branch: asset?.branch || undefined,
          deploymentId: alias.deploymentId,
          createdAt: alias.createdAt.toISOString(),
          updatedAt: alias.updatedAt.toISOString(),
          isAutoPreview: alias.isAutoPreview,
          basePath: alias.basePath ?? undefined,
          proxyRuleSetId: alias.proxyRuleSetId ?? null,
        };
      }),
    );

    return {
      repository,
      aliases: aliasesWithDetails,
    };
  }

  /**
   * Create alias for a repository (Phase 2J)
   * Endpoint: POST /api/repo/:owner/:repo/aliases
   */
  async createRepositoryAlias(
    owner: string,
    repo: string,
    dto: CreateAliasRequestDto,
    userId: string,
    userRole: string,
  ): Promise<AliasCreatedResponseDto> {
    const repository = `${owner}/${repo}`;

    // Phase 3H.6: Get project first for projectId-based queries
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Phase 3H.6: Check project access (requires contributor role to create alias)
    await this.checkProjectAccess(project.id, userId, userRole, 'contributor');

    // Find deployment with the specified commit SHA
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

    // Use deployments service to create or update the alias
    const aliasResponse = await this.deploymentsService.createOrUpdateAlias(
      repository,
      dto.name,
      dto.commitSha,
      targetAsset.deploymentId,
      { proxyRuleSetId: dto.proxyRuleSetId },
    );

    return {
      id: aliasResponse.id,
      repository: aliasResponse.repository,
      name: aliasResponse.alias,
      commitSha: aliasResponse.commitSha,
      deploymentId: aliasResponse.deploymentId,
      createdAt: aliasResponse.createdAt.toISOString(),
      updatedAt: aliasResponse.updatedAt.toISOString(),
    };
  }

  /**
   * Update alias to point to different commit SHA (Phase 2J)
   * Endpoint: PATCH /api/repo/:owner/:repo/aliases/:aliasName
   */
  async updateRepositoryAlias(
    owner: string,
    repo: string,
    aliasName: string,
    dto: UpdateAliasRequestDto,
    userId: string,
    userRole: string,
  ): Promise<AliasCreatedResponseDto> {
    const repository = `${owner}/${repo}`;

    // Delegate to deployments service (authorization done in deploymentsService)
    const aliasResponse = await this.deploymentsService.updateAlias(
      repository,
      aliasName,
      { commitSha: dto.commitSha, proxyRuleSetId: dto.proxyRuleSetId },
      userId,
      userRole,
    );

    return {
      id: aliasResponse.id,
      repository: aliasResponse.repository,
      name: aliasResponse.alias,
      commitSha: aliasResponse.commitSha,
      deploymentId: aliasResponse.deploymentId,
      createdAt: aliasResponse.createdAt.toISOString(),
      updatedAt: aliasResponse.updatedAt.toISOString(),
    };
  }

  /**
   * Delete alias (Phase 2J)
   * Endpoint: DELETE /api/repo/:owner/:repo/aliases/:aliasName
   */
  async deleteRepositoryAlias(
    owner: string,
    repo: string,
    aliasName: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    const repository = `${owner}/${repo}`;

    // Delegate to deployments service (authorization done in deploymentsService)
    await this.deploymentsService.deleteAlias(repository, aliasName, userId, userRole);
  }

  /**
   * Get commit and deployment details
   * Endpoint: GET /api/repo/:owner/:repo/:commitSha/details
   */
  async getCommitDetails(
    owner: string,
    repo: string,
    ref: string,
    userId: string | null,
  ): Promise<GetCommitDetailsResponseDto> {
    const repository = `${owner}/${repo}`;

    // PHASE 3E: Get project first for access control and projectId-based queries
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Determine if ref is SHA or alias (same logic as getFileTree)
    const isSha = /^[a-f0-9]{7,40}$/i.test(ref);
    let commitSha: string;

    if (isSha) {
      commitSha = ref;
    } else {
      // Resolve alias to SHA
      const resolvedSha = await this.deploymentsService.resolveAlias(repository, ref);
      if (!resolvedSha) {
        throw new NotFoundException(`Alias not found: ${ref}`);
      }
      commitSha = resolvedSha;
    }

    // Find all assets for this repository and commit SHA
    const deploymentAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, project.id), eq(assets.commitSha, commitSha)))
      .orderBy(assets.publicPath);

    if (deploymentAssets.length === 0) {
      throw new NotFoundException(
        `No deployment found for repository ${repository} at commit ${commitSha}`,
      );
    }

    // PHASE 3E: Check project-level access instead of asset-level
    // Return 401 for private projects when no user - enables frontend session refresh
    // Note: Frontend will attempt refresh on 401, which is correct for expired sessions.
    // For users with no session at all, the refresh attempt will fail harmlessly.
    if (!project.isPublic && !userId) {
      throw new UnauthorizedException('Authentication required to access this resource');
    }

    const firstAsset = deploymentAssets[0];

    // Get aliases pointing to this commit (with proxy rule set names)
    const aliasRecords = await db
      .select({
        alias: deploymentAliases.alias,
        createdAt: deploymentAliases.createdAt,
        isAutoPreview: deploymentAliases.isAutoPreview,
        basePath: deploymentAliases.basePath,
        proxyRuleSetId: deploymentAliases.proxyRuleSetId,
        proxyRuleSetName: proxyRuleSets.name,
      })
      .from(deploymentAliases)
      .leftJoin(proxyRuleSets, eq(deploymentAliases.proxyRuleSetId, proxyRuleSets.id))
      .where(
        and(
          eq(deploymentAliases.projectId, project.id),
          eq(deploymentAliases.commitSha, commitSha),
        ),
      )
      .orderBy(deploymentAliases.alias);

    // Group assets by deploymentId to get all deployments for this commit
    const deploymentMap = new Map<string, typeof deploymentAssets>();
    for (const asset of deploymentAssets) {
      const depId = asset.deploymentId || 'unknown';
      if (!deploymentMap.has(depId)) {
        deploymentMap.set(depId, []);
      }
      deploymentMap.get(depId)!.push(asset);
    }

    // Build deployment info for each deployment
    const deployments: DeploymentInfoDto[] = Array.from(deploymentMap.entries())
      .map(([deploymentId, assets]) => {
        const firstAsset = assets[0];
        // Use committedAt (actual git commit time) if available, fallback to createdAt (deployment time)
        const deployedAt = firstAsset.committedAt ?? firstAsset.createdAt;
        return {
          id: deploymentId,
          fileCount: assets.length,
          totalSize: assets.reduce((sum, asset) => sum + asset.size, 0),
          deployedAt: deployedAt.toISOString(),
          description: firstAsset.description || undefined,
          workflowName: firstAsset.workflowName || undefined,
        };
      })
      // Sort by deployment date (newest first)
      .sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime());

    // Find README file (case-insensitive) from any deployment
    const readmeAsset = deploymentAssets.find(
      (asset) =>
        asset.publicPath?.toLowerCase().startsWith('readme') ||
        asset.fileName.toLowerCase().startsWith('readme'),
    );

    // Build response
    const commit: CommitInfoDto = {
      sha: commitSha,
      shortSha: commitSha.substring(0, 7),
      message: undefined, // Git commit message not stored in current schema
      author: undefined, // Not stored in current schema
      authorName: undefined, // Not stored in current schema
      committedAt: undefined, // Not stored in current schema
      branch: firstAsset.branch || 'unknown',
    };

    const aliases: CommitAliasDto[] = aliasRecords.map((alias) => ({
      name: alias.alias,
      createdAt: alias.createdAt.toISOString(),
      isAutoPreview: alias.isAutoPreview,
      basePath: alias.basePath ?? undefined,
      proxyRuleSetId: alias.proxyRuleSetId ?? null,
      proxyRuleSetName: alias.proxyRuleSetName ?? null,
    }));

    return {
      commit,
      deployments,
      aliases,
      readmePath: readmeAsset ? readmeAsset.publicPath || readmeAsset.fileName : undefined,
    };
  }
}
