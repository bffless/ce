import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { proxyRuleSets, proxyRules, projects } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import {
  CreateProxyRuleSetDto,
  UpdateProxyRuleSetDto,
  ProxyRuleSetResponseDto,
  ProxyRuleSetWithRulesResponseDto,
} from './dto';
import { ProxyRulesService } from './proxy-rules.service';

@Injectable()
export class ProxyRuleSetsService {
  private readonly logger = new Logger(ProxyRuleSetsService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly proxyRulesService: ProxyRulesService,
  ) {}

  /**
   * List all rule sets for a project
   */
  async listByProject(projectId: string): Promise<ProxyRuleSetResponseDto[]> {
    const ruleSets = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.projectId, projectId));

    return ruleSets;
  }

  /**
   * Get a rule set by ID with its rules
   */
  async getById(id: string): Promise<ProxyRuleSetWithRulesResponseDto | null> {
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, id))
      .limit(1);

    if (!ruleSet) return null;

    const rules = await this.proxyRulesService.getRulesByRuleSetId(id);

    return {
      ...ruleSet,
      rules: rules as ProxyRuleSetWithRulesResponseDto['rules'],
    };
  }

  /**
   * Create a new rule set
   */
  async create(
    projectId: string,
    dto: CreateProxyRuleSetDto,
    userId: string,
    userRole: string,
  ): Promise<ProxyRuleSetResponseDto> {
    // Verify project exists
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    // Check project access (need contributor or higher)
    await this.checkProjectAccess(projectId, userId, userRole, 'contributor');

    // Check for duplicate name within project
    const existing = await this.findByName(projectId, dto.name);
    if (existing) {
      throw new ConflictException(`A rule set with name "${dto.name}" already exists in this project`);
    }

    const [ruleSet] = await db
      .insert(proxyRuleSets)
      .values({
        projectId,
        name: dto.name,
        description: dto.description,
        environment: dto.environment,
      })
      .returning();

    this.logger.log(`Created proxy rule set: ${dto.name} for project ${projectId}`);

    return ruleSet;
  }

  /**
   * Update a rule set
   */
  async update(
    id: string,
    dto: UpdateProxyRuleSetDto,
    userId: string,
    userRole: string,
  ): Promise<ProxyRuleSetResponseDto> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    // Check for duplicate name if changing
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.findByName(existing.projectId, dto.name);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A rule set with name "${dto.name}" already exists in this project`);
      }
    }

    const updateData: Partial<typeof proxyRuleSets.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.environment !== undefined) updateData.environment = dto.environment;

    const [updated] = await db
      .update(proxyRuleSets)
      .set(updateData)
      .where(eq(proxyRuleSets.id, id))
      .returning();

    this.logger.log(`Updated proxy rule set ${id}`);

    return updated;
  }

  /**
   * Delete a rule set (cascades to rules)
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    // Check if this rule set is being used as a default
    const [projectUsingDefault] = await db
      .select()
      .from(projects)
      .where(eq(projects.defaultProxyRuleSetId, id))
      .limit(1);

    if (projectUsingDefault) {
      throw new ConflictException(
        'Cannot delete rule set that is set as the project default. ' +
          'Remove it as the default first.',
      );
    }

    // Rules are deleted by cascade (onDelete: 'cascade')
    await db.delete(proxyRuleSets).where(eq(proxyRuleSets.id, id));

    this.logger.log(`Deleted proxy rule set ${id}`);
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

  private async findById(id: string) {
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, id))
      .limit(1);

    return ruleSet || null;
  }

  private async findByName(projectId: string, name: string) {
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(and(eq(proxyRuleSets.projectId, projectId), eq(proxyRuleSets.name, name)))
      .limit(1);

    return ruleSet || null;
  }
}
