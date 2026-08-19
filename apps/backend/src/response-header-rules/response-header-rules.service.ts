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
import {
  responseHeaderRules,
  projects,
  ResponseHeaderRule,
  NewResponseHeaderRule,
} from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import {
  CreateResponseHeaderRuleDto,
  UpdateResponseHeaderRuleDto,
  ReorderResponseHeaderRulesDto,
} from './dto';
import { ResponseHeaderConfigService } from './response-header-config.service';

@Injectable()
export class ResponseHeaderRulesService {
  private readonly logger = new Logger(ResponseHeaderRulesService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    @Inject(forwardRef(() => ResponseHeaderConfigService))
    private readonly responseHeaderConfigService: ResponseHeaderConfigService,
  ) {}

  async getRulesByProjectId(projectId: string): Promise<ResponseHeaderRule[]> {
    return db
      .select()
      .from(responseHeaderRules)
      .where(eq(responseHeaderRules.projectId, projectId))
      .orderBy(asc(responseHeaderRules.priority));
  }

  async getEnabledRulesByProjectId(projectId: string): Promise<ResponseHeaderRule[]> {
    return db
      .select()
      .from(responseHeaderRules)
      .where(
        and(eq(responseHeaderRules.projectId, projectId), eq(responseHeaderRules.isEnabled, true)),
      )
      .orderBy(asc(responseHeaderRules.priority));
  }

  async getRuleById(id: string): Promise<ResponseHeaderRule | null> {
    const [rule] = await db
      .select()
      .from(responseHeaderRules)
      .where(eq(responseHeaderRules.id, id))
      .limit(1);
    return rule || null;
  }

  async create(
    projectId: string,
    dto: CreateResponseHeaderRuleDto,
    userId: string,
    userRole: string,
  ): Promise<ResponseHeaderRule> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    await this.checkProjectAccess(projectId, userId, userRole, 'contributor');

    const existingRule = await this.findRuleByPattern(projectId, dto.pathPattern);
    if (existingRule) {
      throw new ConflictException(`A rule with path pattern "${dto.pathPattern}" already exists`);
    }

    const priority = dto.priority ?? (await this.getNextPriority(projectId));

    const [rule] = await db
      .insert(responseHeaderRules)
      .values({
        projectId,
        pathPattern: dto.pathPattern,
        framePolicy: dto.framePolicy ?? 'sameorigin',
        allowedOrigins: dto.allowedOrigins ?? [],
        customHeaders: dto.customHeaders ?? null,
        priority,
        isEnabled: dto.isEnabled ?? true,
        name: dto.name ?? null,
        description: dto.description ?? null,
      } satisfies NewResponseHeaderRule)
      .returning();

    this.responseHeaderConfigService.invalidateProjectCache(projectId);

    this.logger.log(
      `Created response header rule: ${dto.pathPattern} (framePolicy: ${rule.framePolicy}, project: ${projectId})`,
    );

    return rule;
  }

  async update(
    id: string,
    dto: UpdateResponseHeaderRuleDto,
    userId: string,
    userRole: string,
  ): Promise<ResponseHeaderRule> {
    const existing = await this.getRuleById(id);
    if (!existing) {
      throw new NotFoundException(`Response header rule ${id} not found`);
    }

    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    if (dto.pathPattern && dto.pathPattern !== existing.pathPattern) {
      const duplicate = await this.findRuleByPattern(existing.projectId, dto.pathPattern);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A rule with path pattern "${dto.pathPattern}" already exists`);
      }
    }

    const updateData: Partial<NewResponseHeaderRule> = {
      updatedAt: new Date(),
    };

    if ('pathPattern' in dto) updateData.pathPattern = dto.pathPattern;
    if ('framePolicy' in dto) updateData.framePolicy = dto.framePolicy;
    if ('allowedOrigins' in dto) updateData.allowedOrigins = dto.allowedOrigins;
    if ('customHeaders' in dto) updateData.customHeaders = dto.customHeaders;
    if ('priority' in dto) updateData.priority = dto.priority;
    if ('isEnabled' in dto) updateData.isEnabled = dto.isEnabled;
    if ('name' in dto) updateData.name = dto.name;
    if ('description' in dto) updateData.description = dto.description;

    const [updated] = await db
      .update(responseHeaderRules)
      .set(updateData)
      .where(eq(responseHeaderRules.id, id))
      .returning();

    this.responseHeaderConfigService.invalidateProjectCache(existing.projectId);

    this.logger.log(`Updated response header rule ${id}`);

    return updated;
  }

  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.getRuleById(id);
    if (!existing) {
      throw new NotFoundException(`Response header rule ${id} not found`);
    }

    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    const projectId = existing.projectId;

    await db.delete(responseHeaderRules).where(eq(responseHeaderRules.id, id));

    this.responseHeaderConfigService.invalidateProjectCache(projectId);

    this.logger.log(`Deleted response header rule ${id}`);
  }

  async reorder(
    projectId: string,
    dto: ReorderResponseHeaderRulesDto,
    userId: string,
    userRole: string,
  ): Promise<ResponseHeaderRule[]> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    await this.checkProjectAccess(projectId, userId, userRole, 'contributor');

    const existingRules = await db
      .select()
      .from(responseHeaderRules)
      .where(eq(responseHeaderRules.projectId, projectId));

    const existingIds = new Set(existingRules.map((r) => r.id));
    for (const id of dto.ruleIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Rule ${id} does not belong to this project`);
      }
    }

    for (let i = 0; i < dto.ruleIds.length; i++) {
      await db
        .update(responseHeaderRules)
        .set({ priority: i, updatedAt: new Date() })
        .where(eq(responseHeaderRules.id, dto.ruleIds[i]));
    }

    this.responseHeaderConfigService.invalidateProjectCache(projectId);

    return this.getRulesByProjectId(projectId);
  }

  // ==================== Helper Methods ====================

  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
    requiredRole: 'viewer' | 'contributor' | 'admin' | 'owner' = 'contributor',
  ): Promise<void> {
    if (userRole === 'admin') return;

    const role = await this.permissionsService.getUserProjectRole(userId, projectId);
    if (!role) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const roleHierarchy = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
    const userLevel = roleHierarchy[role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(`This action requires ${requiredRole} role or higher`);
    }
  }

  private async findRuleByPattern(
    projectId: string,
    pattern: string,
  ): Promise<ResponseHeaderRule | null> {
    const [rule] = await db
      .select()
      .from(responseHeaderRules)
      .where(
        and(
          eq(responseHeaderRules.projectId, projectId),
          eq(responseHeaderRules.pathPattern, pattern),
        ),
      )
      .limit(1);
    return rule || null;
  }

  private async getNextPriority(projectId: string): Promise<number> {
    const rules = await db
      .select({ priority: responseHeaderRules.priority })
      .from(responseHeaderRules)
      .where(eq(responseHeaderRules.projectId, projectId))
      .orderBy(asc(responseHeaderRules.priority));

    if (rules.length === 0) return 0;
    return Math.max(...rules.map((r) => r.priority)) + 10;
  }
}
