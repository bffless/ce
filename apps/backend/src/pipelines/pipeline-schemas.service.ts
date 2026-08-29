import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { eq, and, count, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import {
  pipelineSchemas,
  pipelineData,
  PipelineSchema,
  NewPipelineSchema,
  SchemaKind,
  SchemaField,
  PipelineSchemaSource,
} from '../db/schema';
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
  async getByProjectId(
    projectId: string,
    apiKeyProjectId?: string | null,
  ): Promise<SchemaWithCount[]> {
    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, projectId);
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
    const [schema] = await db
      .select()
      .from(pipelineSchemas)
      .where(eq(pipelineSchemas.id, id))
      .limit(1);
    return schema || null;
  }

  /**
   * Get a schema by ID with record count
   */
  async getByIdWithCount(
    id: string,
    apiKeyProjectId?: string | null,
  ): Promise<SchemaWithCount | null> {
    const schema = await this.getById(id);
    if (!schema) return null;

    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, schema.projectId);

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
    apiKeyProjectId?: string | null,
    // Internal-only (never read from the request DTO): the rules-as-code sync
    // stamps which rule set created the schema so a later sync of a
    // DIFFERENT set can't adopt fields onto it (bffless/ce#721).
    source?: PipelineSchemaSource,
  ): Promise<PipelineSchema> {
    await this.permissionsService.requireProjectAccess(
      dto.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

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
        // Declared intent, never inferred — absent means "not declared", which
        // is what every pre-existing schema carries (bffless/ce#633).
        kind: dto.kind ?? null,
        source: source ?? null,
      } as NewPipelineSchema)
      .returning();

    this.logger.log(`Created schema '${dto.name}' (${schema.id}) for project ${dto.projectId}`);

    return schema;
  }

  /**
   * Fill in a schema's `kind` — only ever from null, never a rewrite.
   *
   * Separate from {@link update} on purpose: this is a narrow, additive
   * declaration used by the rules-as-code sync so a schema that predates the
   * column can adopt one (bffless/ce#633). It is guarded in SQL as well as by
   * the caller, so a concurrent sync can't clobber a kind set in between; and
   * it deliberately does NOT bump `version`, which tracks field changes that
   * data records are associated with.
   */
  async adoptKind(id: string, kind: SchemaKind): Promise<void> {
    await db
      .update(pipelineSchemas)
      .set({ kind, updatedAt: new Date() })
      .where(and(eq(pipelineSchemas.id, id), isNull(pipelineSchemas.kind)));
  }

  /**
   * Append fields onto a schema — the rules-as-code sync's opt-in field
   * adoption (bffless/ce#721). The caller has already established that
   * `fields` is the live list plus new OPTIONAL fields only (planFieldAdoption)
   * and that the syncing rule set owns the schema; this method is the guarded
   * write.
   *
   * Optimistic: the UPDATE is conditioned on `version` still being
   * `expectedVersion`, so two concurrent syncs can't clobber each other's
   * read-modify-write of the field list. Returns the updated row, or `null`
   * when the version moved underneath us (the caller reloads and re-plans).
   * Bumps `version` like {@link update} does for a field change, and stamps
   * `source` so ownership is recorded from the first adoption onwards.
   */
  async adoptFields(
    id: string,
    expectedVersion: number,
    fields: SchemaField[],
    source: PipelineSchemaSource,
  ): Promise<PipelineSchema | null> {
    const [updated] = await db
      .update(pipelineSchemas)
      .set({
        fields: fields.map((f) => ({ ...f, required: f.required ?? false })),
        version: expectedVersion + 1,
        source,
        updatedAt: new Date(),
      })
      .where(and(eq(pipelineSchemas.id, id), eq(pipelineSchemas.version, expectedVersion)))
      .returning();

    if (updated) {
      this.logger.log(
        `Adopted fields onto schema ${id} for rule set "${source.ruleSetName}" ` +
          `(now ${fields.length} fields, version ${expectedVersion} → ${updated.version})`,
      );
    }

    return updated ?? null;
  }

  /**
   * Update a schema
   */
  async update(
    id: string,
    dto: UpdatePipelineSchemaDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<PipelineSchema> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Schema ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      existing.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

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
    if (dto.version !== undefined) {
      updateData.version = dto.version;
    } else if (dto.fields !== undefined) {
      // Auto-increment version when fields change (unless version is explicitly set)
      updateData.version = existing.version + 1;
    }
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
  async delete(
    id: string,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException(`Schema ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      existing.projectId,
      userId,
      userRole,
      'admin',
      apiKeyProjectId,
    );

    await db.delete(pipelineSchemas).where(eq(pipelineSchemas.id, id));

    this.logger.log(`Deleted schema ${id}`);
  }

  // ==================== Helper Methods ====================

  private async findByName(projectId: string, name: string): Promise<PipelineSchema | null> {
    const [schema] = await db
      .select()
      .from(pipelineSchemas)
      .where(and(eq(pipelineSchemas.projectId, projectId), eq(pipelineSchemas.name, name)))
      .limit(1);

    return schema || null;
  }
}
