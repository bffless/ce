import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { PipelineSchemasService } from '../../pipelines/pipeline-schemas.service';
import { PipelineDataService } from '../../pipelines/pipeline-data.service';
import { PipelineExecutionLogService } from '../../pipelines/pipeline-execution-log.service';
import { UploadSchemaGeneratorService } from '../../pipelines/upload-schema-generator.service';
import { ProxyRulesService } from '../../proxy-rules/proxy-rules.service';
import { SchemaFieldType } from '../../db/schema';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class PipelineTools {
  constructor(
    private readonly schemasService: PipelineSchemasService,
    private readonly dataService: PipelineDataService,
    private readonly uploadSchemaGenerator: UploadSchemaGeneratorService,
    private readonly executionLogService: PipelineExecutionLogService,
    private readonly proxyRulesService: ProxyRulesService,
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
    request: Request,
  ) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.schemasService.getByProjectId(projectId, apiKeyProjectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_pipeline_schema',
    description: 'Get a pipeline schema by ID, including record count.',
    parameters: z.object({
      id: z.string().describe('Schema ID'),
    }),
  })
  async getSchema({ id }: { id: string }, _context: Context, request: Request) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.schemasService.getByIdWithCount(id, apiKeyProjectId);
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
      user.apiKeyProjectId,
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
    await this.schemasService.delete(id, user.id, user.role, user.apiKeyProjectId);
    return JSON.stringify({ success: true, id });
  }

  @Tool({
    name: 'update_pipeline_schema',
    description:
      'Update an existing pipeline schema. Can rename the schema and/or modify its fields. Version is auto-incremented when fields change.',
    parameters: z.object({
      id: z.string().describe('Schema ID to update'),
      name: z.string().optional().describe('New schema name (must be unique within project)'),
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
        .optional()
        .describe('Updated field definitions (replaces all existing fields)'),
    }),
  })
  async updateSchema(
    args: {
      id: string;
      name?: string;
      fields?: Array<{
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
    const { id, ...dto } = args;
    const updateDto: { name?: string; fields?: Array<{ name: string; type: SchemaFieldType; required?: boolean }> } = {};
    if (dto.name) updateDto.name = dto.name;
    if (dto.fields) updateDto.fields = dto.fields.map((f) => ({ name: f.name, type: f.type, required: f.required }));
    const result = await this.schemasService.update(
      id,
      updateDto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'generate_upload_schema',
    description:
      'Generate an upload schema with POST (upload) and GET (serve) pipelines. This is the recommended way to set up file uploads — it creates the schema with proper upload metadata fields (filename, storage_path, url, etc.), a POST pipeline with file_upload_handler, and a GET pipeline with file_serve_handler. Files uploaded through this schema appear in the Uploads tab in the admin UI. Use this instead of manually creating schemas + proxy rules for file uploads.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      name: z
        .string()
        .describe('Schema name (lowercase letters, numbers, underscores, e.g. "product_images")'),
      subDir: z
        .string()
        .describe(
          'Storage sub-directory for files (e.g. "images", "documents"). Endpoint will be POST /api/uploads/{subDir}',
        ),
      dateBucket: z
        .boolean()
        .optional()
        .describe('Organize files in YYYY-MM-DD date folders (default false)'),
      maxFileSize: z
        .number()
        .optional()
        .describe('Maximum file size in bytes (default 10485760 = 10MB)'),
      allowedMimeTypes: z
        .array(z.string())
        .optional()
        .describe('Allowed MIME types (e.g. ["image/*", "application/pdf"]). Default: all types'),
      accessControl: z
        .enum(['public', 'authenticated', 'role'])
        .optional()
        .describe('Access control for serving files (default "public")'),
      ruleSetId: z
        .string()
        .optional()
        .describe('Add pipelines to existing rule set (creates new one if omitted)'),
    }),
  })
  async generateUploadSchema(
    args: {
      projectId: string;
      name: string;
      subDir: string;
      dateBucket?: boolean;
      maxFileSize?: number;
      allowedMimeTypes?: string[];
      accessControl?: 'public' | 'authenticated' | 'role';
      ruleSetId?: string;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.uploadSchemaGenerator.generateUploadSchema(
      args,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
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
      user.apiKeyProjectId,
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
    const result = await this.dataService.getByIdWithAccess(
      id,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
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
      user.apiKeyProjectId,
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
    const result = await this.dataService.update(
      args.id,
      args.data,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
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
    await this.dataService.delete(id, user.id, user.role, user.apiKeyProjectId);
    return JSON.stringify({ success: true, id });
  }

  // =====================
  // Pipeline Execution Log Tools
  // =====================

  @Tool({
    name: 'enable_pipeline_debug',
    description: 'Toggle debug logging on a proxy rule. When enabled, pipeline execution results are persisted for debugging.',
    parameters: z.object({
      ruleId: z.string().describe('Proxy rule ID'),
      enabled: z.boolean().describe('Whether to enable debug logging'),
    }),
  })
  async enableDebug(
    args: { ruleId: string; enabled: boolean },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.proxyRulesService.update(
      args.ruleId,
      { debugEnabled: args.enabled },
      user.id,
      user.role,
    );
    return JSON.stringify({ id: result.id, debugEnabled: result.debugEnabled });
  }

  @Tool({
    name: 'list_pipeline_logs',
    description: 'List execution logs for a proxy rule. Shows recent pipeline runs with status, duration, and errors.',
    parameters: z.object({
      ruleId: z.string().describe('Proxy rule ID'),
      page: z.number().optional().describe('Page number (default 1)'),
      pageSize: z.number().optional().describe('Items per page (default 10)'),
    }),
  })
  async listLogs(
    args: { ruleId: string; page?: number; pageSize?: number },
    _context: Context,
    _request: Request,
  ) {
    const result = await this.executionLogService.getByRuleId(
      args.ruleId,
      args.page ?? 1,
      args.pageSize ?? 10,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_pipeline_log',
    description: 'Get full detail of a single pipeline execution log, including all step debug data (input/output/timing).',
    parameters: z.object({
      id: z.string().describe('Execution log ID'),
    }),
  })
  async getLog(
    { id }: { id: string },
    _context: Context,
    _request: Request,
  ) {
    const result = await this.executionLogService.getById(id);
    if (!result) {
      return JSON.stringify({ error: 'Log not found' });
    }
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_pipeline_log_step',
    description: 'Get a specific step\'s input/output from a pipeline execution log.',
    parameters: z.object({
      logId: z.string().describe('Execution log ID'),
      stepName: z.string().describe('Step name to find'),
    }),
  })
  async getLogStep(
    args: { logId: string; stepName: string },
    _context: Context,
    _request: Request,
  ) {
    const log = await this.executionLogService.getById(args.logId);
    if (!log) {
      return JSON.stringify({ error: 'Log not found' });
    }
    const step = log.debug?.steps?.find(
      (s) => s.stepName === args.stepName || s.stepId === args.stepName,
    );
    if (!step) {
      return JSON.stringify({
        error: `Step '${args.stepName}' not found`,
        availableSteps: log.debug?.steps?.map((s) => s.stepName || s.stepId) ?? [],
      });
    }
    return JSON.stringify(step);
  }
}
