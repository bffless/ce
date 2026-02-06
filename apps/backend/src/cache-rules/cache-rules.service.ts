import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { eq, asc, and } from 'drizzle-orm';
import { db } from '../db/client';
import { cacheRules, projects, CacheRule, NewCacheRule } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { CreateCacheRuleDto, UpdateCacheRuleDto, ReorderCacheRulesDto } from './dto';
import { CacheConfigService } from './cache-config.service';

@Injectable()
export class CacheRulesService {
  private readonly logger = new Logger(CacheRulesService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    @Inject(forwardRef(() => CacheConfigService))
    private readonly cacheConfigService: CacheConfigService,
  ) {}

  /**
   * Get all cache rules for a project, ordered by priority
   */
  async getRulesByProjectId(projectId: string): Promise<CacheRule[]> {
    return db
      .select()
      .from(cacheRules)
      .where(eq(cacheRules.projectId, projectId))
      .orderBy(asc(cacheRules.priority));
  }

  /**
   * Get enabled cache rules for a project, ordered by priority
   * Used by cache evaluation service
   */
  async getEnabledRulesByProjectId(projectId: string): Promise<CacheRule[]> {
    return db
      .select()
      .from(cacheRules)
      .where(and(eq(cacheRules.projectId, projectId), eq(cacheRules.isEnabled, true)))
      .orderBy(asc(cacheRules.priority));
  }

  /**
   * Get a cache rule by ID
   */
  async getRuleById(id: string): Promise<CacheRule | null> {
    const [rule] = await db.select().from(cacheRules).where(eq(cacheRules.id, id)).limit(1);
    return rule || null;
  }

  /**
   * Create a new cache rule for a project
   */
  async create(
    projectId: string,
    dto: CreateCacheRuleDto,
    userId: string,
    userRole: string,
  ): Promise<CacheRule> {
    // Verify project exists
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    // Check project access (need contributor or higher)
    await this.checkProjectAccess(projectId, userId, userRole, 'contributor');

    // Check for duplicate path pattern within the project
    const existingRule = await this.findRuleByPattern(projectId, dto.pathPattern);
    if (existingRule) {
      throw new ConflictException(`A rule with path pattern "${dto.pathPattern}" already exists`);
    }

    // Auto-assign priority if not provided
    const priority = dto.priority ?? (await this.getNextPriority(projectId));

    const [rule] = await db
      .insert(cacheRules)
      .values({
        projectId,
        pathPattern: dto.pathPattern,
        browserMaxAge: dto.browserMaxAge ?? 300,
        cdnMaxAge: dto.cdnMaxAge ?? null,
        staleWhileRevalidate: dto.staleWhileRevalidate ?? null,
        immutable: dto.immutable ?? false,
        cacheability: dto.cacheability ?? null,
        priority,
        isEnabled: dto.isEnabled ?? true,
        name: dto.name ?? null,
        description: dto.description ?? null,
      } satisfies NewCacheRule)
      .returning();

    // Invalidate cached rules for this project
    this.cacheConfigService.invalidateProjectCache(projectId);

    this.logger.log(
      `Created cache rule: ${dto.pathPattern} (browserMaxAge: ${rule.browserMaxAge}, project: ${projectId})`,
    );

    return rule;
  }

  /**
   * Update a cache rule
   */
  async update(
    id: string,
    dto: UpdateCacheRuleDto,
    userId: string,
    userRole: string,
  ): Promise<CacheRule> {
    const existing = await this.getRuleById(id);
    if (!existing) {
      throw new NotFoundException(`Cache rule ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    // Check for duplicate path pattern if changing
    if (dto.pathPattern && dto.pathPattern !== existing.pathPattern) {
      const duplicate = await this.findRuleByPattern(existing.projectId, dto.pathPattern);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A rule with path pattern "${dto.pathPattern}" already exists`);
      }
    }

    // Prepare update data
    const updateData: Partial<NewCacheRule> = {
      updatedAt: new Date(),
    };

    // Use 'in' operator to check if field was sent (including null values)
    if ('pathPattern' in dto) updateData.pathPattern = dto.pathPattern;
    if ('browserMaxAge' in dto) updateData.browserMaxAge = dto.browserMaxAge;
    if ('cdnMaxAge' in dto) updateData.cdnMaxAge = dto.cdnMaxAge;
    if ('staleWhileRevalidate' in dto) updateData.staleWhileRevalidate = dto.staleWhileRevalidate;
    if ('immutable' in dto) updateData.immutable = dto.immutable;
    if ('cacheability' in dto) updateData.cacheability = dto.cacheability;
    if ('priority' in dto) updateData.priority = dto.priority;
    if ('isEnabled' in dto) updateData.isEnabled = dto.isEnabled;
    if ('name' in dto) updateData.name = dto.name;
    if ('description' in dto) updateData.description = dto.description;

    const [updated] = await db
      .update(cacheRules)
      .set(updateData)
      .where(eq(cacheRules.id, id))
      .returning();

    // Invalidate cached rules for this project
    this.cacheConfigService.invalidateProjectCache(existing.projectId);

    this.logger.log(`Updated cache rule ${id}`);

    return updated;
  }

  /**
   * Delete a cache rule
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.getRuleById(id);
    if (!existing) {
      throw new NotFoundException(`Cache rule ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    const projectId = existing.projectId;

    await db.delete(cacheRules).where(eq(cacheRules.id, id));

    // Invalidate cached rules for this project
    this.cacheConfigService.invalidateProjectCache(projectId);

    this.logger.log(`Deleted cache rule ${id}`);
  }

  /**
   * Reorder cache rules within a project
   */
  async reorder(
    projectId: string,
    dto: ReorderCacheRulesDto,
    userId: string,
    userRole: string,
  ): Promise<CacheRule[]> {
    // Verify project exists
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    // Check project access
    await this.checkProjectAccess(projectId, userId, userRole, 'contributor');

    // Verify all rules belong to the project
    const existingRules = await db
      .select()
      .from(cacheRules)
      .where(eq(cacheRules.projectId, projectId));

    const existingIds = new Set(existingRules.map((r) => r.id));
    for (const id of dto.ruleIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Rule ${id} does not belong to this project`);
      }
    }

    // Update priority for each rule (index becomes priority)
    for (let i = 0; i < dto.ruleIds.length; i++) {
      await db
        .update(cacheRules)
        .set({ priority: i, updatedAt: new Date() })
        .where(eq(cacheRules.id, dto.ruleIds[i]));
    }

    // Invalidate cached rules for this project
    this.cacheConfigService.invalidateProjectCache(projectId);

    // Return updated rules in new order
    return this.getRulesByProjectId(projectId);
  }

  // ==================== Helper Methods ====================

  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
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

  private async findRuleByPattern(projectId: string, pattern: string): Promise<CacheRule | null> {
    const [rule] = await db
      .select()
      .from(cacheRules)
      .where(and(eq(cacheRules.projectId, projectId), eq(cacheRules.pathPattern, pattern)))
      .limit(1);

    return rule || null;
  }

  private async getNextPriority(projectId: string): Promise<number> {
    const rules = await db
      .select({ priority: cacheRules.priority })
      .from(cacheRules)
      .where(eq(cacheRules.projectId, projectId))
      .orderBy(asc(cacheRules.priority));

    if (rules.length === 0) return 0;
    return Math.max(...rules.map((r) => r.priority)) + 10;
  }
}
