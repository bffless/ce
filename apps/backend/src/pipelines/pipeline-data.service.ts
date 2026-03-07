import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { pipelineSchemas, pipelineData, PipelineData, NewPipelineData } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';

export interface PaginatedDataResult {
  records: PipelineData[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class PipelineDataService {
  private readonly logger = new Logger(PipelineDataService.name);

  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get paginated data records for a schema
   */
  async getBySchemaId(
    schemaId: string,
    page = 1,
    pageSize = 20,
    userId: string,
    userRole: string,
  ): Promise<PaginatedDataResult> {
    // Get schema for project ID and access check
    const [schema] = await db
      .select()
      .from(pipelineSchemas)
      .where(eq(pipelineSchemas.id, schemaId))
      .limit(1);

    if (!schema) {
      throw new NotFoundException(`Schema ${schemaId} not found`);
    }

    await this.checkProjectAccess(schema.projectId, userId, userRole, 'viewer');

    // Get total count
    const [countResult] = await db
      .select({ count: count() })
      .from(pipelineData)
      .where(eq(pipelineData.schemaId, schemaId));

    const total = countResult?.count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    // Get records with pagination
    const offset = (page - 1) * pageSize;
    const records = await db
      .select()
      .from(pipelineData)
      .where(eq(pipelineData.schemaId, schemaId))
      .orderBy(desc(pipelineData.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      records,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * Get a single data record by ID
   */
  async getById(id: string): Promise<PipelineData | null> {
    const [record] = await db.select().from(pipelineData).where(eq(pipelineData.id, id)).limit(1);
    return record || null;
  }

  /**
   * Create a new data record
   * Used internally by data_create handler
   */
  async create(
    schemaId: string,
    projectId: string,
    data: Record<string, unknown>,
    createdBy?: string,
  ): Promise<PipelineData> {
    const [record] = await db
      .insert(pipelineData)
      .values({
        schemaId,
        projectId,
        data,
        createdBy,
      } as NewPipelineData)
      .returning();

    this.logger.log(`Created data record ${record.id} in schema ${schemaId}`);

    return record;
  }

  /**
   * Create a new data record with access check
   * Used by the API for manual record creation
   */
  async createWithAccess(
    schemaId: string,
    data: Record<string, unknown>,
    userId: string,
    userRole: string,
  ): Promise<PipelineData> {
    // Get schema for project ID and access check
    const [schema] = await db
      .select()
      .from(pipelineSchemas)
      .where(eq(pipelineSchemas.id, schemaId))
      .limit(1);

    if (!schema) {
      throw new NotFoundException(`Schema ${schemaId} not found`);
    }

    await this.checkProjectAccess(schema.projectId, userId, userRole, 'contributor');

    return this.create(schemaId, schema.projectId, data, userId);
  }

  /**
   * Update an existing data record
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId: string,
    userRole: string,
  ): Promise<PipelineData> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    await this.checkProjectAccess(record.projectId, userId, userRole, 'contributor');

    const [updated] = await db
      .update(pipelineData)
      .set({
        data,
        updatedAt: new Date(),
      })
      .where(eq(pipelineData.id, id))
      .returning();

    this.logger.log(`Updated data record ${id}`);

    return updated;
  }

  /**
   * Get a single record by ID with access check
   */
  async getByIdWithAccess(
    id: string,
    userId: string,
    userRole: string,
  ): Promise<PipelineData> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    await this.checkProjectAccess(record.projectId, userId, userRole, 'viewer');

    return record;
  }

  /**
   * Delete a data record
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    await this.checkProjectAccess(record.projectId, userId, userRole, 'contributor');

    await db.delete(pipelineData).where(eq(pipelineData.id, id));

    this.logger.log(`Deleted data record ${id}`);
  }

  /**
   * Delete multiple data records
   */
  async deleteMany(ids: string[], userId: string, userRole: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    // Get first record to check project access
    const [record] = await db
      .select()
      .from(pipelineData)
      .where(eq(pipelineData.id, ids[0]))
      .limit(1);

    if (!record) {
      throw new NotFoundException(`Record ${ids[0]} not found`);
    }

    await this.checkProjectAccess(record.projectId, userId, userRole, 'contributor');

    // Delete all records that belong to the same project
    const result = await db
      .delete(pipelineData)
      .where(
        and(eq(pipelineData.projectId, record.projectId), inArray(pipelineData.id, ids)),
      )
      .returning({ id: pipelineData.id });

    this.logger.log(`Deleted ${result.length} data records`);

    return result.length;
  }

  /**
   * Export all data records for a schema
   */
  async exportBySchemaId(
    schemaId: string,
    format: 'json' | 'csv',
    userId: string,
    userRole: string,
  ): Promise<string> {
    // Get schema for project ID and access check
    const [schema] = await db
      .select()
      .from(pipelineSchemas)
      .where(eq(pipelineSchemas.id, schemaId))
      .limit(1);

    if (!schema) {
      throw new NotFoundException(`Schema ${schemaId} not found`);
    }

    await this.checkProjectAccess(schema.projectId, userId, userRole, 'viewer');

    // Get all records
    const records = await db
      .select()
      .from(pipelineData)
      .where(eq(pipelineData.schemaId, schemaId))
      .orderBy(desc(pipelineData.createdAt));

    if (format === 'json') {
      return JSON.stringify(
        records.map((r) => ({
          id: r.id,
          ...r.data as Record<string, unknown>,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        null,
        2,
      );
    }

    // CSV format
    if (records.length === 0) {
      return '';
    }

    // Get field names from schema
    const fieldNames = schema.fields.map((f) => f.name);
    const headers = ['id', ...fieldNames, 'createdAt', 'updatedAt'];

    const rows: string[] = [headers.join(',')];

    for (const record of records) {
      const data = record.data as Record<string, unknown>;
      const row = [
        this.escapeCSV(record.id),
        ...fieldNames.map((name) => this.escapeCSV(String(data[name] ?? ''))),
        this.escapeCSV(record.createdAt.toISOString()),
        this.escapeCSV(record.updatedAt.toISOString()),
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  // ==================== Helper Methods ====================

  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
    requiredRole: 'viewer' | 'contributor' | 'admin' | 'owner' = 'viewer',
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

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
