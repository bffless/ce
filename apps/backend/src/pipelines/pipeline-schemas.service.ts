import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { eq, and, count } from 'drizzle-orm';
import { db } from '../db/client';
import { pipelineSchemas, pipelineData, PipelineSchema, NewPipelineSchema } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { CreatePipelineSchemaDto, UpdatePipelineSchemaDto } from './dto';

export interface SchemaWithCount extends PipelineSchema {
  recordCount: number;
}

@Injectable()
export class PipelineSchemasService {
  private readonly logger = new Logger(PipelineSchemasService.name);

  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get all schemas for a project with record counts
   */
  async getByProjectId(projectId: string): Promise<SchemaWithCount[]> {
    const schemas = await db
      .select()
      .from(pipelineSchemas)
      .where(eq(pipelineSchemas.projectId, projectId));

    // Get record counts for each schema
    const result: SchemaWithCount[] = [];
    for (const schema of schemas) {
      const [countResult] = await db
        .select({ count: count() })
        .from(pipelineData)
        .where(eq(pipelineData.schemaId, schema.id));

      result.push({
        ...schema,
        recordCount: countResult?.count ?? 0,
      });
    }

    return result;
  }

  /**
   * Get a schema by ID
   */
  async getById(id: string): Promise<PipelineSchema | null> {
    const [schema] = await db.select().from(pipelineSchemas).where(eq(pipelineSchemas.id, id)).limit(1);
    return schema || null;
  }

  /**
   * Get a schema by ID with record count
   */
  async getByIdWithCount(id: string): Promise<SchemaWithCount | null> {
    const schema = await this.getById(id);
    if (!schema) return null;

    const [countResult] = await db
      .select({ count: count() })
      .from(pipelineData)
      .where(eq(pipelineData.schemaId, id));

    return {
      ...schema,
      recordCount: countResult?.count ?? 0,
    };
  }

  /**
   * Create a new schema
   */
  async create(
    dto: CreatePipelineSchemaDto,
    userId: string,
    userRole: string,
  ): Promise<PipelineSchema> {
    // Check project access
    await this.checkProjectAccess(dto.projectId, userId, userRole, 'contributor');

    // Check for duplicate name
    const existing = await this.findByName(dto.projectId, dto.name);
    if (existing) {
      throw new ConflictException(`A schema with name "${dto.name}" already exists`);
    }

    const [schema] = await db
      .insert(pipelineSchemas)
      .values({
        projectId: dto.projectId,
        name: dto.name,
        fields: dto.fields.map((f) => ({
          ...f,
          required: f.required ?? false,
        })),
      } as NewPipelineSchema)
      .returning();

    this.logger.log(`Created schema '${dto.name}' (${schema.id}) for project ${dto.projectId}`);

    return schema;
  }

  /**
   * Update a schema
   */
  async update(
    id: string,
    dto: UpdatePipelineSchemaDto,
    userId: string,
    userRole: string,
  ): Promise<PipelineSchema> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Schema ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'contributor');

    // Check for duplicate name if changing
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.findByName(existing.projectId, dto.name);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A schema with name "${dto.name}" already exists`);
      }
    }

    const updateData: Partial<typeof pipelineSchemas.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.fields !== undefined) {
      updateData.fields = dto.fields.map((f) => ({
        ...f,
        required: f.required ?? false,
      }));
    }

    const [updated] = await db
      .update(pipelineSchemas)
      .set(updateData)
      .where(eq(pipelineSchemas.id, id))
      .returning();

    this.logger.log(`Updated schema ${id}`);

    return updated;
  }

  /**
   * Delete a schema (cascades to data records)
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Schema ${id} not found`);
    }

    // Check project access
    await this.checkProjectAccess(existing.projectId, userId, userRole, 'admin');

    await db.delete(pipelineSchemas).where(eq(pipelineSchemas.id, id));

    this.logger.log(`Deleted schema ${id}`);
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

  private async findByName(projectId: string, name: string): Promise<PipelineSchema | null> {
    const [schema] = await db
      .select()
      .from(pipelineSchemas)
      .where(and(eq(pipelineSchemas.projectId, projectId), eq(pipelineSchemas.name, name)))
      .limit(1);

    return schema || null;
  }
}
