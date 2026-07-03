import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, desc, asc, count, inArray, gte, lte, or, sql, SQL } from 'drizzle-orm';
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

export interface DataFilterOptions {
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
  filters?: Record<string, { op: string; value: string }>;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class PipelineDataService {
  private readonly logger = new Logger(PipelineDataService.name);

  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get paginated data records for a schema with optional filtering
   */
  async getBySchemaId(
    schemaId: string,
    page = 1,
    pageSize = 20,
    userId: string,
    userRole: string,
    filterOptions?: DataFilterOptions,
    apiKeyProjectId?: string | null,
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

    await this.permissionsService.requireProjectAccess(
      schema.projectId,
      userId,
      userRole,
      'viewer',
      apiKeyProjectId,
    );

    // Build filter conditions
    const conditions: SQL[] = [eq(pipelineData.schemaId, schemaId)];

    if (filterOptions) {
      // Search: match ID or text fields
      if (filterOptions.search) {
        const searchTerm = `%${filterOptions.search}%`;
        const searchConditions: SQL[] = [
          // Cast UUID to text for ILIKE search
          sql`${pipelineData.id}::text ILIKE ${searchTerm}`,
        ];
        // Search in all text fields of the JSONB data
        for (const field of schema.fields) {
          if (['string', 'text', 'email'].includes(field.type)) {
            const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${field.name}'`)}`;
            searchConditions.push(sql`${fieldPath} ILIKE ${searchTerm}`);
          }
        }
        conditions.push(or(...searchConditions)!);
      }

      // Date range filters
      if (filterOptions.createdAfter) {
        conditions.push(gte(pipelineData.createdAt, filterOptions.createdAfter));
      }
      if (filterOptions.createdBefore) {
        conditions.push(lte(pipelineData.createdAt, filterOptions.createdBefore));
      }
      if (filterOptions.updatedAfter) {
        conditions.push(gte(pipelineData.updatedAt, filterOptions.updatedAfter));
      }
      if (filterOptions.updatedBefore) {
        conditions.push(lte(pipelineData.updatedAt, filterOptions.updatedBefore));
      }

      // Field-specific filters on JSONB data column
      if (filterOptions.filters) {
        for (const [fieldName, filter] of Object.entries(filterOptions.filters)) {
          const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${fieldName}'`)}`;
          const value = filter.value;

          switch (filter.op) {
            case 'eq':
              conditions.push(sql`${fieldPath} = ${value}`);
              break;
            case 'ne':
              conditions.push(sql`${fieldPath} != ${value}`);
              break;
            case 'gt':
              conditions.push(sql`(${fieldPath})::numeric > ${Number(value)}`);
              break;
            case 'lt':
              conditions.push(sql`(${fieldPath})::numeric < ${Number(value)}`);
              break;
            case 'gte':
              conditions.push(sql`(${fieldPath})::numeric >= ${Number(value)}`);
              break;
            case 'lte':
              conditions.push(sql`(${fieldPath})::numeric <= ${Number(value)}`);
              break;
            case 'like':
              conditions.push(sql`${fieldPath} ILIKE ${`%${value}%`}`);
              break;
          }
        }
      }
    }

    const whereClause = and(...conditions);

    // Get total count with filters applied
    const [countResult] = await db
      .select({ count: count() })
      .from(pipelineData)
      .where(whereClause);

    const total = countResult?.count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    // Build order by clause
    let orderByClause;
    if (filterOptions?.sortBy) {
      const direction = filterOptions.sortOrder === 'asc' ? asc : desc;
      if (filterOptions.sortBy === 'createdAt') {
        orderByClause = direction(pipelineData.createdAt);
      } else if (filterOptions.sortBy === 'updatedAt') {
        orderByClause = direction(pipelineData.updatedAt);
      } else if (filterOptions.sortBy === 'version') {
        orderByClause = direction(pipelineData.version);
      } else if (filterOptions.sortBy === 'alias') {
        orderByClause = direction(pipelineData.alias);
      } else {
        // Sort by JSONB field
        const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${filterOptions.sortBy}'`)}`;
        orderByClause = filterOptions.sortOrder === 'asc'
          ? sql`${fieldPath} ASC`
          : sql`${fieldPath} DESC`;
      }
    } else {
      orderByClause = desc(pipelineData.createdAt);
    }

    // Get records with pagination
    const offset = (page - 1) * pageSize;
    const records = await db
      .select()
      .from(pipelineData)
      .where(whereClause)
      .orderBy(orderByClause)
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
    alias?: string | null,
    version?: number,
  ): Promise<PipelineData> {
    const [record] = await db
      .insert(pipelineData)
      .values({
        schemaId,
        projectId,
        data,
        createdBy,
        alias: alias ?? null,
        version: version ?? 1,
      } as NewPipelineData)
      .returning();

    this.logger.log(`Created data record ${record.id} in schema ${schemaId}`);

    return record;
  }

  /**
   * Bulk-insert many data records in one shot. Used by the data_upsert_many
   * handler; functionally the single-row {@link create} in a loop, but batched
   * into chunked multi-row INSERTs to stay within Postgres parameter limits.
   * No permission check — callers run in a trusted pipeline/system context and
   * have already resolved the schema + project.
   */
  async createMany(
    schemaId: string,
    projectId: string,
    records: Record<string, unknown>[],
    createdBy?: string,
    alias?: string | null,
    version?: number,
  ): Promise<PipelineData[]> {
    if (records.length === 0) {
      return [];
    }

    const rows: NewPipelineData[] = records.map(
      (data) =>
        ({
          schemaId,
          projectId,
          data,
          createdBy,
          alias: alias ?? null,
          version: version ?? 1,
        }) as NewPipelineData,
    );

    // Chunk so a very large batch never blows the ~65k bound parameter ceiling
    // (6 columns per row → ~10k rows/chunk is safe; keep well under it).
    const CHUNK = 500;
    const inserted: PipelineData[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const result = await db.insert(pipelineData).values(chunk).returning();
      inserted.push(...result);
    }

    this.logger.log(`Bulk-created ${inserted.length} data record(s) in schema ${schemaId}`);
    return inserted;
  }

  /**
   * Return the subset of `values` that already exist in a schema's records under
   * a given JSONB field. Used by data_upsert_many to detect already-present
   * dedup keys before inserting. `field` MUST be validated against the schema's
   * field names by the caller (it is interpolated into SQL).
   */
  async findExistingKeys(
    schemaId: string,
    projectId: string,
    field: string,
    values: string[],
  ): Promise<Set<string>> {
    const existing = new Set<string>();
    if (values.length === 0) {
      return existing;
    }

    const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${field}'`)}`;
    const CHUNK = 500;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      const rows = await db
        .select({ key: fieldPath })
        .from(pipelineData)
        .where(
          and(
            eq(pipelineData.schemaId, schemaId),
            eq(pipelineData.projectId, projectId),
            inArray(fieldPath, chunk),
          ),
        );
      for (const row of rows) {
        if (row.key != null) {
          existing.add(String(row.key));
        }
      }
    }
    return existing;
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
    apiKeyProjectId?: string | null,
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

    await this.permissionsService.requireProjectAccess(
      schema.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    return this.create(schemaId, schema.projectId, data, userId, null, schema.version);
  }

  /**
   * Update an existing data record
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<PipelineData> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      record.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

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
    apiKeyProjectId?: string | null,
  ): Promise<PipelineData> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      record.projectId,
      userId,
      userRole,
      'viewer',
      apiKeyProjectId,
    );

    return record;
  }

  /**
   * Delete a data record
   */
  async delete(
    id: string,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<void> {
    const record = await this.getById(id);
    if (!record) {
      throw new NotFoundException(`Record ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      record.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    await db.delete(pipelineData).where(eq(pipelineData.id, id));

    this.logger.log(`Deleted data record ${id}`);
  }

  /**
   * Delete multiple data records
   */
  async deleteMany(
    ids: string[],
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<number> {
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

    await this.permissionsService.requireProjectAccess(
      record.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

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
    apiKeyProjectId?: string | null,
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

    await this.permissionsService.requireProjectAccess(
      schema.projectId,
      userId,
      userRole,
      'viewer',
      apiKeyProjectId,
    );

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
          alias: r.alias,
          version: r.version,
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
    const headers = ['id', 'alias', 'version', ...fieldNames, 'createdAt', 'updatedAt'];

    const rows: string[] = [headers.join(',')];

    for (const record of records) {
      const data = record.data as Record<string, unknown>;
      const row = [
        this.escapeCSV(record.id),
        this.escapeCSV(record.alias ?? ''),
        this.escapeCSV(String(record.version)),
        ...fieldNames.map((name) => this.escapeCSV(String(data[name] ?? ''))),
        this.escapeCSV(record.createdAt.toISOString()),
        this.escapeCSV(record.updatedAt.toISOString()),
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  // ==================== Helper Methods ====================

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
