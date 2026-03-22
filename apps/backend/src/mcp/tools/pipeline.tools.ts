import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { PipelineSchemasService } from '../../pipelines/pipeline-schemas.service';
import { PipelineDataService } from '../../pipelines/pipeline-data.service';
import { SchemaFieldType } from '../../db/schema';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class PipelineTools {
  constructor(
    private readonly schemasService: PipelineSchemasService,
    private readonly dataService: PipelineDataService,
    private readonly authService: AuthService,
  ) {}

  // =====================
  // Schema Tools
  // =====================

  @Tool({
    name: 'list_pipeline_schemas',
    description: 'List all pipeline schemas for a project.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  })
  async listSchemas(
    { projectId }: { projectId: string },
    _context: Context,
    _request: Request,
  ) {
    const result = await this.schemasService.getByProjectId(projectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_pipeline_schema',
    description: 'Get a pipeline schema by ID, including record count.',
    parameters: z.object({
      id: z.string().describe('Schema ID'),
    }),
  })
  async getSchema({ id }: { id: string }, _context: Context, _request: Request) {
    const result = await this.schemasService.getByIdWithCount(id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_pipeline_schema',
    description: 'Create a new pipeline schema with typed fields.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Schema name'),
      fields: z
        .array(
          z.object({
            name: z.string(),
            type: z
              .enum(['string', 'number', 'boolean', 'email', 'text', 'datetime', 'json'])
              .describe('Field type'),
            required: z.boolean().optional(),
            description: z.string().optional(),
          }),
        )
        .describe('Schema field definitions'),
    }),
  })
  async createSchema(
    args: {
      projectId: string;
      name: string;
      fields: Array<{
        name: string;
        type: SchemaFieldType;
        required?: boolean;
        description?: string;
      }>;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.schemasService.create(
      {
        projectId: args.projectId,
        name: args.name,
        fields: args.fields.map((f) => ({ name: f.name, type: f.type, required: f.required })),
      },
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_pipeline_schema',
    description: 'Delete a pipeline schema and all its data records.',
    parameters: z.object({
      id: z.string().describe('Schema ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteSchema(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.schemasService.delete(id, user.id, user.role);
    return JSON.stringify({ success: true, id });
  }

  // =====================
  // Data Tools
  // =====================

  @Tool({
    name: 'query_pipeline_data',
    description:
      'Query pipeline data records by schema ID with pagination, search, and filters.',
    parameters: z.object({
      schemaId: z.string().describe('Schema ID to query'),
      page: z.number().optional().describe('Page number (default 1)'),
      pageSize: z.number().optional().describe('Items per page (default 20)'),
      search: z.string().optional().describe('Full-text search across text fields'),
      sortBy: z.string().optional().describe('Field name to sort by'),
      sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort order'),
    }),
  })
  async queryData(
    args: {
      schemaId: string;
      page?: number;
      pageSize?: number;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.dataService.getBySchemaId(
      args.schemaId,
      args.page ?? 1,
      args.pageSize ?? 20,
      user.id,
      user.role,
      {
        search: args.search,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
      },
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_pipeline_record',
    description: 'Get a single pipeline data record by ID.',
    parameters: z.object({
      id: z.string().describe('Record ID'),
    }),
  })
  async getRecord(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.dataService.getByIdWithAccess(id, user.id, user.role);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_pipeline_record',
    description: 'Create a new pipeline data record.',
    parameters: z.object({
      schemaId: z.string().describe('Schema ID'),
      data: z.record(z.string(), z.unknown()).describe('Record data matching the schema fields'),
    }),
  })
  async createRecord(
    args: { schemaId: string; data: Record<string, unknown> },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.dataService.createWithAccess(
      args.schemaId,
      args.data,
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_pipeline_record',
    description: 'Update an existing pipeline data record.',
    parameters: z.object({
      id: z.string().describe('Record ID to update'),
      data: z.record(z.string(), z.unknown()).describe('Updated record data'),
    }),
  })
  async updateRecord(
    args: { id: string; data: Record<string, unknown> },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.dataService.update(args.id, args.data, user.id, user.role);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_pipeline_record',
    description: 'Delete a pipeline data record.',
    parameters: z.object({
      id: z.string().describe('Record ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteRecord(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.dataService.delete(id, user.id, user.role);
    return JSON.stringify({ success: true, id });
  }
}
