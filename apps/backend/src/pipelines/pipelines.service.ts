import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client';
import { pipelines, pipelineSteps, Pipeline, NewPipeline } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { CreatePipelineDto, UpdatePipelineDto } from './dto';

@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get all pipelines for a project
   */
  async getByProjectId(projectId: string): Promise<Pipeline[]> {
    return db
      .select()
      .from(pipelines)
      .where(eq(pipelines.projectId, projectId))
      .orderBy(asc(pipelines.order), asc(pipelines.createdAt));
  }

  /**
   * Get a pipeline by ID
   */
  async getById(id: string): Promise<Pipeline | null> {
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, id)).limit(1);
    return pipeline || null;
  }

  /**
   * Get a pipeline by ID with its steps
   */
  async getByIdWithSteps(id: string): Promise<{ pipeline: Pipeline; steps: typeof pipelineSteps.$inferSelect[] } | null> {
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, id)).limit(1);

    if (!pipeline) {
      return null;
    }

    const steps = await db
      .select()
      .from(pipelineSteps)
      .where(eq(pipelineSteps.pipelineId, id))
      .orderBy(asc(pipelineSteps.order));

    return { pipeline, steps };
  }

  /**
   * Create a new pipeline
   */
  async create(
    dto: CreatePipelineDto,
    userId: string,
    userRole: string,
  ): Promise<Pipeline> {
    // Check project access
    await this.checkProjectAccess(dto.projectId, userId, userRole, 'contributor');

    // Check for duplicate path pattern
    const existing = await this.findByPathPattern(dto.projectId, dto.pathPattern);
    if (existing) {
      throw new ConflictException(`A pipeline with path pattern "${dto.pathPattern}" already exists`);
    }

    // Auto-assign order if not provided
    const order = dto.order ?? (await this.getNextOrder(dto.projectId));

    const [pipeline] = await db
      .insert(pipelines)
      .values({
        projectId: dto.projectId,
        name: dto.name,
        description: dto.description,
        pathPattern: dto.pathPattern,
        httpMethods: dto.httpMethods || ['POST'],
        validators: dto.validators || [],
        isEnabled: dto.isEnabled ?? true,
        order,
      } as NewPipeline)
      .returning();

    this.logger.log(`Created pipeline '${dto.name}' (${pipeline.id}) for project ${dto.projectId}`);

    return pipeline;
  }

  /**
   * Update a pipeline
   */
  async update(
    id: string,
    dto: UpdatePipelineDto,
    userId: string,
    userRole: string,
  ): Promise<Pipeline> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    // Check for duplicate path pattern if changing
    if (dto.pathPattern && dto.pathPattern !== existing.pathPattern) {
      const duplicate = await this.findByPathPattern(existing.projectId, dto.pathPattern);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A pipeline with path pattern "${dto.pathPattern}" already exists`);
      }
    }

    const updateData: Partial<typeof pipelines.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.pathPattern !== undefined) updateData.pathPattern = dto.pathPattern;
    if (dto.httpMethods !== undefined) updateData.httpMethods = dto.httpMethods;
    if (dto.validators !== undefined) updateData.validators = dto.validators;
    if (dto.isEnabled !== undefined) updateData.isEnabled = dto.isEnabled;
    if (dto.order !== undefined) updateData.order = dto.order;

    const [updated] = await db
      .update(pipelines)
      .set(updateData)
      .where(eq(pipelines.id, id))
      .returning();

    this.logger.log(`Updated pipeline ${id}`);

    return updated;
  }

  /**
   * Delete a pipeline
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    await db.delete(pipelines).where(eq(pipelines.id, id));

    this.logger.log(`Deleted pipeline ${id}`);
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

  private async findByPathPattern(projectId: string, pathPattern: string): Promise<Pipeline | null> {
    const [pipeline] = await db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.projectId, projectId), eq(pipelines.pathPattern, pathPattern)))
      .limit(1);

    return pipeline || null;
  }

  private async getNextOrder(projectId: string): Promise<number> {
    const result = await db
      .select({ order: pipelines.order })
      .from(pipelines)
      .where(eq(pipelines.projectId, projectId))
      .orderBy(asc(pipelines.order));

    if (result.length === 0) return 0;
    return Math.max(...result.map((r) => r.order)) + 1;
  }
}
