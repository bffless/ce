import { Injectable, Inject, NotFoundException, ConflictException, Optional, Logger } from '@nestjs/common';
import { eq, and, asc, desc, sql, or, ilike, count, sum, max } from 'drizzle-orm';
import { db } from '../db/client';
import {
  projects,
  Project,
  NewProject,
  projectPermissions,
  projectGroupPermissions,
  userGroupMembers,
  assets,
  deploymentAliases,
  apiKeys,
} from '../db/schema';
import { MetadataCacheService } from '../storage/cache/metadata-cache.service';
import { STORAGE_ADAPTER, IStorageAdapter } from '../storage/storage.interface';
import { UsageReporterService } from '../platform/usage-reporter.service';

// TTL for project cache: 5 minutes
const PROJECT_CACHE_TTL = 300;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly usageReporter: UsageReporterService,
    @Optional() private readonly metadataCache?: MetadataCacheService,
  ) {}
  /**
   * Find existing project or create new one (idempotent)
   * Used during deployment creation
   */
  async findOrCreateProject(owner: string, name: string, createdBy: string): Promise<Project> {
    // Try to find existing project
    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Create new project
    const [newProject] = await db
      .insert(projects)
      .values({
        owner,
        name,
        displayName: name,
        description: null,
        isPublic: false, // Default to private
        settings: {},
        createdBy,
      })
      .returning();

    // Grant owner permission to creator
    await db.insert(projectPermissions).values({
      projectId: newProject.id,
      userId: createdBy,
      role: 'owner',
      grantedBy: createdBy,
    });

    return newProject;
  }

  /**
   * Get project by ID
   * Uses Redis cache when available to reduce DB roundtrips
   */
  async getProjectById(id: string): Promise<Project> {
    // Try cache first
    if (this.metadataCache) {
      const cacheKey = this.metadataCache.projectIdKey(id);
      const cached = await this.metadataCache.get<Project>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT: getProjectById(${id})`);
        return cached;
      }
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

    if (!project) {
      throw new NotFoundException(`Project not found: ${id}`);
    }

    // Cache the result
    if (this.metadataCache) {
      const cacheKey = this.metadataCache.projectIdKey(id);
      await this.metadataCache.set(cacheKey, project, PROJECT_CACHE_TTL);
      this.logger.debug(`Cache MISS: getProjectById(${id}) - cached`);
    }

    return project;
  }

  /**
   * Get project by owner and name
   * Uses Redis cache when available to reduce DB roundtrips
   */
  async getProjectByOwnerName(owner: string, name: string): Promise<Project> {
    // Try cache first
    if (this.metadataCache) {
      const cacheKey = this.metadataCache.projectKey(owner, name);
      const cached = await this.metadataCache.get<Project>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT: getProjectByOwnerName(${owner}/${name})`);
        return cached;
      }
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project not found: ${owner}/${name}`);
    }

    // Cache the result
    if (this.metadataCache) {
      const cacheKey = this.metadataCache.projectKey(owner, name);
      await this.metadataCache.set(cacheKey, project, PROJECT_CACHE_TTL);
      this.logger.debug(`Cache MISS: getProjectByOwnerName(${owner}/${name}) - cached`);
    }

    return project;
  }

  /**
   * List all projects created by a specific user
   */
  async listUserProjects(userId: string): Promise<Project[]> {
    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.createdBy, userId))
      .orderBy(projects.createdAt);

    return userProjects;
  }

  /**
   * Update project settings
   */
  async updateProject(
    id: string,
    updates: Partial<Omit<Project, 'id' | 'owner' | 'name' | 'createdBy' | 'createdAt'>>,
  ): Promise<Project> {
    // Check if project exists
    const [existingProject] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

    if (!existingProject) {
      throw new NotFoundException(`Project not found: ${id}`);
    }

    // Update the project
    const [updatedProject] = await db
      .update(projects)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    // Invalidate cache
    if (this.metadataCache) {
      await this.metadataCache.invalidateProject(
        existingProject.owner,
        existingProject.name,
        existingProject.id,
      );
    }

    return updatedProject;
  }

  /**
   * Delete project by ID
   * Cleans up all related data: aliases, assets, api keys, storage files, and caches.
   * Other tables (permissions, cache rules, retention rules, proxy rules, etc.) cascade automatically.
   */
  async deleteProject(id: string): Promise<void> {
    // Check if project exists
    const [existingProject] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

    if (!existingProject) {
      throw new NotFoundException(`Project not found: ${id}`);
    }

    // Calculate total storage being freed (for usage reporting)
    const [storageInfo] = await db
      .select({ totalSize: sum(assets.size) })
      .from(assets)
      .where(eq(assets.projectId, id));
    const totalBytes = Number(storageInfo?.totalSize) || 0;

    // Delete rows that don't have ON DELETE CASCADE
    await db.delete(deploymentAliases).where(eq(deploymentAliases.projectId, id));
    await db.delete(assets).where(eq(assets.projectId, id));
    await db.update(apiKeys).set({ projectId: null }).where(eq(apiKeys.projectId, id));

    // Delete the project (cascades to permissions, cache rules, retention rules,
    // proxy rule sets, path preferences, domain mappings, group permissions)
    await db.delete(projects).where(eq(projects.id, id));

    // Delete files from storage
    const storagePrefix = `${existingProject.owner}/${existingProject.name}/`;
    try {
      const result = await this.storageAdapter.deletePrefix(storagePrefix);
      this.logger.log(
        `Deleted ${result.deleted} storage files for project ${existingProject.owner}/${existingProject.name}`,
      );
      if (result.failed.length > 0) {
        this.logger.warn(`Failed to delete ${result.failed.length} storage files: ${result.failed.slice(0, 5).join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete storage files for ${storagePrefix}: ${error}`);
    }

    // Invalidate project cache and all asset caches for this project
    if (this.metadataCache) {
      await this.metadataCache.invalidateProject(
        existingProject.owner,
        existingProject.name,
        existingProject.id,
      );
      await this.metadataCache.invalidateProjectAssets(existingProject.id);
    }

    // Report freed storage to control plane
    if (totalBytes > 0) {
      this.usageReporter.reportDelete(totalBytes).catch(() => {});
    }
  }

  /**
   * Create a new project (used when explicitly creating a project, not via deployment)
   */
  async createProject(data: NewProject): Promise<Project> {
    // Check if project with same owner/name already exists
    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner, data.owner), eq(projects.name, data.name)))
      .limit(1);

    if (existing) {
      throw new ConflictException(`Project ${data.owner}/${data.name} already exists`);
    }

    // Create the project
    const [newProject] = await db
      .insert(projects)
      .values({
        ...data,
        isPublic: data.isPublic ?? false,
        settings: data.settings ?? {},
      })
      .returning();

    // Grant owner permission to creator
    await db.insert(projectPermissions).values({
      projectId: newProject.id,
      userId: data.createdBy,
      role: 'owner',
      grantedBy: data.createdBy,
    });

    return newProject;
  }

  /**
   * Check if a project exists by owner and name
   */
  async projectExists(owner: string, name: string): Promise<boolean> {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    return !!project;
  }

  /**
   * Get my repositories (sidebar) - owned + direct + group permissions
   * Returns minimal data sorted alphabetically by name
   * Limited to 100 repos max
   */
  async getMyRepositories(userId: string): Promise<{
    total: number;
    repositories: Array<{
      id: string;
      owner: string;
      name: string;
      permissionType: 'owner' | 'direct' | 'group';
      role: 'owner' | 'admin' | 'contributor' | 'viewer';
    }>;
  }> {
    // Query 1: Owned repositories
    const ownedRepos = await db
      .select({
        id: projects.id,
        owner: projects.owner,
        name: projects.name,
        permissionType: sql<string>`'owner'`,
        role: sql<string>`'owner'`,
      })
      .from(projects)
      .where(eq(projects.createdBy, userId))
      .orderBy(asc(projects.name))
      .limit(100);

    // Query 2: Direct permissions
    const directRepos = await db
      .select({
        id: projects.id,
        owner: projects.owner,
        name: projects.name,
        permissionType: sql<string>`'direct'`,
        role: projectPermissions.role,
      })
      .from(projects)
      .innerJoin(projectPermissions, eq(projects.id, projectPermissions.projectId))
      .where(eq(projectPermissions.userId, userId))
      .orderBy(asc(projects.name))
      .limit(100);

    // Query 3: Group permissions
    const groupRepos = await db
      .select({
        id: projects.id,
        owner: projects.owner,
        name: projects.name,
        permissionType: sql<string>`'group'`,
        role: projectGroupPermissions.role,
      })
      .from(projects)
      .innerJoin(projectGroupPermissions, eq(projects.id, projectGroupPermissions.projectId))
      .innerJoin(userGroupMembers, eq(projectGroupPermissions.groupId, userGroupMembers.groupId))
      .where(eq(userGroupMembers.userId, userId))
      .orderBy(asc(projects.name))
      .limit(100);

    // Combine and deduplicate by project ID
    const seenIds = new Set<string>();
    const repositories: Array<{
      id: string;
      owner: string;
      name: string;
      permissionType: 'owner' | 'direct' | 'group';
      role: 'owner' | 'admin' | 'contributor' | 'viewer';
    }> = [];

    // Priority: owned > direct > group
    for (const repo of [...ownedRepos, ...directRepos, ...groupRepos]) {
      if (!seenIds.has(repo.id)) {
        seenIds.add(repo.id);
        repositories.push({
          id: repo.id,
          owner: repo.owner,
          name: repo.name,
          permissionType: repo.permissionType as 'owner' | 'direct' | 'group',
          role: repo.role as 'owner' | 'admin' | 'contributor' | 'viewer',
        });
      }
    }

    // Sort alphabetically by name
    repositories.sort((a, b) => a.name.localeCompare(b.name));

    return {
      total: repositories.length,
      repositories: repositories.slice(0, 100), // Enforce 100 limit
    };
  }

  /**
   * Get repository feed with search and pagination
   * Returns all accessible repos (owned + direct + group + public) with stats
   */
  async getRepositoryFeed(
    userId: string | null,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      sortBy?: 'updatedAt' | 'createdAt' | 'name';
      order?: 'asc' | 'desc';
    },
  ): Promise<{
    page: number;
    limit: number;
    total: number;
    repositories: Array<{
      id: string;
      owner: string;
      name: string;
      displayName: string | null;
      description: string | null;
      isPublic: boolean;
      permissionType: 'owner' | 'direct' | 'group' | 'public';
      role: 'owner' | 'admin' | 'contributor' | 'viewer' | null;
      stats: {
        deploymentCount: number;
        storageBytes: number;
        storageMB: number;
        lastDeployedAt: string | null;
      };
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy || 'updatedAt';
    const order = query.order || 'desc';

    // Build a CTE (Common Table Expression) for all accessible repos
    // We'll use raw SQL for this complex query due to Drizzle limitations with UNIONs

    const searchCondition = query.search
      ? sql`AND (p.owner ILIKE ${`%${query.search}%`} OR p.name ILIKE ${`%${query.search}%`} OR p.description ILIKE ${`%${query.search}%`})`
      : sql``;

    // Determine sort column
    const sortColumn =
      sortBy === 'name'
        ? sql`p.name`
        : sortBy === 'createdAt'
          ? sql`p.created_at`
          : sql`p.updated_at`;
    const sortDirection = order === 'asc' ? sql`ASC` : sql`DESC`;

    let accessibleReposQuery;

    if (userId) {
      // Authenticated user - include owned, direct, group, and public repos
      accessibleReposQuery = sql`
        WITH all_repos AS (
          -- Owned repositories
          SELECT p.id, p.owner, p.name, p.display_name, p.description, p.is_public,
                 'owner' as permission_type, 'owner' as role, 1 as priority,
                 p.created_at, p.updated_at
          FROM projects p
          WHERE p.created_by = ${userId}

          UNION

          -- Direct permissions
          SELECT p.id, p.owner, p.name, p.display_name, p.description, p.is_public,
                 'direct' as permission_type, pp.role::text, 2 as priority,
                 p.created_at, p.updated_at
          FROM projects p
          INNER JOIN project_permissions pp ON p.id = pp.project_id
          WHERE pp.user_id = ${userId}

          UNION

          -- Group permissions
          SELECT p.id, p.owner, p.name, p.display_name, p.description, p.is_public,
                 'group' as permission_type, pgp.role::text, 3 as priority,
                 p.created_at, p.updated_at
          FROM projects p
          INNER JOIN project_group_permissions pgp ON p.id = pgp.project_id
          INNER JOIN user_group_members ugm ON pgp.group_id = ugm.group_id
          WHERE ugm.user_id = ${userId}

          UNION

          -- Public repositories (not already included)
          SELECT p.id, p.owner, p.name, p.display_name, p.description, p.is_public,
                 'public' as permission_type, NULL as role, 4 as priority,
                 p.created_at, p.updated_at
          FROM projects p
          WHERE p.is_public = true
            AND p.id NOT IN (
              SELECT project_id FROM project_permissions WHERE user_id = ${userId}
              UNION
              SELECT pgp.project_id FROM project_group_permissions pgp
              INNER JOIN user_group_members ugm ON pgp.group_id = ugm.group_id
              WHERE ugm.user_id = ${userId}
              UNION
              SELECT id FROM projects WHERE created_by = ${userId}
            )
        ),
        deduplicated AS (
          SELECT DISTINCT ON (id)
            id, owner, name, display_name, description, is_public,
            permission_type, role, priority, created_at, updated_at
          FROM all_repos
          ORDER BY id, priority ASC
        )
        SELECT
          p.*,
          COALESCE(COUNT(DISTINCT a.deployment_id), 0)::int as deployment_count,
          COALESCE(SUM(a.size), 0)::bigint as storage_bytes,
          MAX(a.created_at) as last_deployed_at
        FROM deduplicated p
        LEFT JOIN assets a ON a.project_id = p.id
        WHERE 1=1 ${searchCondition}
        GROUP BY p.id, p.owner, p.name, p.display_name, p.description,
                 p.is_public, p.permission_type, p.role, p.priority,
                 p.created_at, p.updated_at
        ORDER BY ${sortColumn} ${sortDirection}, p.priority ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      // Anonymous user - only public repos
      accessibleReposQuery = sql`
        SELECT
          p.id, p.owner, p.name, p.display_name, p.description, p.is_public,
          'public' as permission_type, NULL as role, 4 as priority,
          p.created_at, p.updated_at,
          COALESCE(COUNT(DISTINCT a.deployment_id), 0)::int as deployment_count,
          COALESCE(SUM(a.size), 0)::bigint as storage_bytes,
          MAX(a.created_at) as last_deployed_at
        FROM projects p
        LEFT JOIN assets a ON a.project_id = p.id
        WHERE p.is_public = true ${searchCondition}
        GROUP BY p.id, p.owner, p.name, p.display_name, p.description,
                 p.is_public, p.created_at, p.updated_at
        ORDER BY ${sortColumn} ${sortDirection}
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const results = await db.execute(accessibleReposQuery);

    // Get total count (for pagination)
    let totalCountQuery;
    if (userId) {
      totalCountQuery = sql`
        WITH all_repos AS (
          SELECT p.id FROM projects p WHERE p.created_by = ${userId}
          UNION
          SELECT p.id FROM projects p
          INNER JOIN project_permissions pp ON p.id = pp.project_id
          WHERE pp.user_id = ${userId}
          UNION
          SELECT p.id FROM projects p
          INNER JOIN project_group_permissions pgp ON p.id = pgp.project_id
          INNER JOIN user_group_members ugm ON pgp.group_id = ugm.group_id
          WHERE ugm.user_id = ${userId}
          UNION
          SELECT p.id FROM projects p
          WHERE p.is_public = true
            AND p.id NOT IN (
              SELECT project_id FROM project_permissions WHERE user_id = ${userId}
              UNION
              SELECT pgp.project_id FROM project_group_permissions pgp
              INNER JOIN user_group_members ugm ON pgp.group_id = ugm.group_id
              WHERE ugm.user_id = ${userId}
              UNION
              SELECT id FROM projects WHERE created_by = ${userId}
            )
        )
        SELECT COUNT(DISTINCT id)::int as total FROM all_repos
      `;
    } else {
      totalCountQuery = sql`
        SELECT COUNT(*)::int as total FROM projects WHERE is_public = true
      `;
    }

    const totalResults = await db.execute(totalCountQuery);
    const total = (totalResults[0] as any)?.total || 0;

    // Transform results
    const repositories = (Array.isArray(results) ? results : []).map((row: any) => ({
      id: row.id,
      owner: row.owner,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      isPublic: row.is_public,
      permissionType: row.permission_type as 'owner' | 'direct' | 'group' | 'public',
      role: row.role as 'owner' | 'admin' | 'contributor' | 'viewer' | null,
      stats: {
        deploymentCount: Number(row.deployment_count) || 0,
        storageBytes: Number(row.storage_bytes) || 0,
        storageMB: Math.round(((Number(row.storage_bytes) || 0) / 1024 / 1024) * 10) / 10,
        lastDeployedAt: row.last_deployed_at ? new Date(row.last_deployed_at).toISOString() : null,
      },
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));

    return {
      page,
      limit,
      total,
      repositories,
    };
  }
}
