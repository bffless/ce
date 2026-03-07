import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client';
import { pipelines, pipelineSteps, PipelineStep, NewPipelineStep } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { CreatePipelineStepDto, UpdatePipelineStepDto, ReorderStepsDto } from './dto';

@Injectable()
export class PipelineStepsService {
  private readonly logger = new Logger(PipelineStepsService.name);

  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get all steps for a pipeline
   */
  async getByPipelineId(pipelineId: string): Promise<PipelineStep[]> {
    return db
      .select()
      .from(pipelineSteps)
      .where(eq(pipelineSteps.pipelineId, pipelineId))
      .orderBy(asc(pipelineSteps.order));
  }

  /**
   * Get a step by ID
   */
  async getById(id: string): Promise<PipelineStep | null> {
    const [step] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, id)).limit(1);
    return step || null;
  }

  /**
   * Create a new step in a pipeline
   */
  async create(
    pipelineId: string,
    dto: CreatePipelineStepDto,
    userId: string,
    userRole: string,
  ): Promise<PipelineStep> {
    // Get pipeline and check access
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    await this.checkProjectAccess(pipeline.projectId, userId, userRole, 'contributor');

    // Auto-assign order if not provided
    const order = dto.order ?? (await this.getNextOrder(pipelineId));

    const [step] = await db
      .insert(pipelineSteps)
      .values({
        pipelineId,
        name: dto.name,
        handlerType: dto.handlerType,
        config: dto.config,
        order,
        isEnabled: dto.isEnabled ?? true,
      } as NewPipelineStep)
      .returning();

    this.logger.log(`Created step '${dto.name || step.id}' in pipeline ${pipelineId}`);

    return step;
  }

  /**
   * Update a step
   */
  async update(
    id: string,
    dto: UpdatePipelineStepDto,
    userId: string,
    userRole: string,
  ): Promise<PipelineStep> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Step ${id} not found`);
    }

    // Get pipeline for access check
    const [pipeline] = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.id, existing.pipelineId))
      .limit(1);

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${existing.pipelineId} not found`);
    }

    await this.checkProjectAccess(pipeline.projectId, userId, userRole, 'contributor');

    const updateData: Partial<typeof pipelineSteps.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.handlerType !== undefined) updateData.handlerType = dto.handlerType;
    if (dto.config !== undefined) updateData.config = dto.config;
    if (dto.order !== undefined) updateData.order = dto.order;
    if (dto.isEnabled !== undefined) updateData.isEnabled = dto.isEnabled;

    const [updated] = await db
      .update(pipelineSteps)
      .set(updateData)
      .where(eq(pipelineSteps.id, id))
      .returning();

    this.logger.log(`Updated step ${id}`);

    return updated;
  }

  /**
   * Delete a step
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Step ${id} not found`);
    }

    // Get pipeline for access check
    const [pipeline] = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.id, existing.pipelineId))
      .limit(1);

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${existing.pipelineId} not found`);
    }

    await this.checkProjectAccess(pipeline.projectId, userId, userRole, 'contributor');

    await db.delete(pipelineSteps).where(eq(pipelineSteps.id, id));

    this.logger.log(`Deleted step ${id}`);
  }

  /**
   * Reorder steps within a pipeline
   */
  async reorder(
    pipelineId: string,
    dto: ReorderStepsDto,
    userId: string,
    userRole: string,
  ): Promise<PipelineStep[]> {
    // Get pipeline for access check
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    await this.checkProjectAccess(pipeline.projectId, userId, userRole, 'contributor');

    // Verify all step IDs belong to this pipeline
    const existingSteps = await db
      .select()
      .from(pipelineSteps)
      .where(eq(pipelineSteps.pipelineId, pipelineId));

    const existingIds = new Set(existingSteps.map((s) => s.id));
    for (const id of dto.stepIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Step ${id} does not belong to this pipeline`);
      }
    }

    // Update order for each step
    for (let i = 0; i < dto.stepIds.length; i++) {
      await db
        .update(pipelineSteps)
        .set({ order: i, updatedAt: new Date() })
        .where(eq(pipelineSteps.id, dto.stepIds[i]));
    }

    // Return updated steps
    return db
      .select()
      .from(pipelineSteps)
      .where(eq(pipelineSteps.pipelineId, pipelineId))
      .orderBy(asc(pipelineSteps.order));
  }

  // ==================== Helper Methods ====================

  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
    requiredRole: 'viewer' | 'contributor' | 'admin' | 'owner' = 'contributor',
  ): Promise<void> {
    if (userRole === 'admin') {
      return;
    }

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

  private async getNextOrder(pipelineId: string): Promise<number> {
    const result = await db
      .select({ order: pipelineSteps.order })
      .from(pipelineSteps)
      .where(eq(pipelineSteps.pipelineId, pipelineId))
      .orderBy(asc(pipelineSteps.order));

    if (result.length === 0) return 0;
    return Math.max(...result.map((r) => r.order)) + 1;
  }
}
