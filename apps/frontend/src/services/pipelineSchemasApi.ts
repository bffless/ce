import { api } from './api';

// ==================== Types ====================

export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'email'
  | 'text'
  | 'datetime'
  | 'json';

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  required: boolean;
  default?: unknown;
}

/** What a schema is for, as declared at creation. Null = not declared. */
export type SchemaKind = 'upload' | 'chat' | 'state';

export interface PipelineSchema {
  id: string;
  projectId: string;
  name: string;
  version: number;
  fields: SchemaField[];
  /**
   * Declared intent, null for schemas predating the field or written by hand.
   * Read it through `isUploadSchema()` rather than comparing here — null needs
   * the field-shape fallback.
   */
  kind: SchemaKind | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineSchemaWithCount extends PipelineSchema {
  recordCount: number;
}

export interface PipelineDataRecord {
  id: string;
  projectId: string;
  schemaId: string;
  alias: string | null;
  version: number;
  data: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== DTOs ====================

export interface CreateSchemaDto {
  projectId: string;
  name: string;
  fields: SchemaField[];
}

export interface UpdateSchemaDto {
  name?: string;
  version?: number;
  fields?: SchemaField[];
}

export interface CreateRecordDto {
  data: Record<string, unknown>;
}

export interface UpdateRecordDto {
  data: Record<string, unknown>;
}

export interface GenerateStateSchemaDto {
  projectId: string;
  name: string;
  scope: 'global' | 'user';
  ruleSetId?: string;
}

export interface GenerateStateSchemaResponse {
  schema: PipelineSchema;
  pipelines: { id: string; path: string; method: string }[];
}

export interface GenerateChatSchemaDto {
  projectId: string;
  name: string;
  scope: 'user' | 'guest';
  provider?: string;
  model?: string;
  systemPrompt?: string;
  ruleSetId?: string;
}

export interface GenerateChatSchemaResponse {
  conversationsSchema: PipelineSchema;
  messagesSchema: PipelineSchema;
  pipelines: { id: string; path: string; method: string }[];
}

export interface GenerateUploadSchemaDto {
  projectId: string;
  name: string;
  subDir: string;
  dateBucket?: boolean;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  accessControl?: 'public' | 'authenticated' | 'role';
  requiredRole?: string;
  ruleSetId?: string;
}

export interface GenerateUploadSchemaResponse {
  schema: PipelineSchema;
  pipelines: { id: string; path: string; method: string }[];
}

export interface FieldFilter {
  /** `exists` filters on presence of the field, with value 'true' | 'false'. */
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'like' | 'exists';
  value: string;
}

export interface DataFilterParams {
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  filters?: Record<string, FieldFilter>;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ==================== Responses ====================

export interface SchemasListResponse {
  schemas: PipelineSchemaWithCount[];
}

export interface PaginatedDataResponse {
  records: PipelineDataRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ==================== API Definition ====================

export const pipelineSchemasApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // ==================== Schemas ====================

    getProjectSchemas: builder.query<SchemasListResponse, string>({
      query: (projectId) => `/api/pipeline-schemas/project/${projectId}`,
      providesTags: (_result, _error, projectId) => [
        { type: 'PipelineSchema' as const, id: `project-${projectId}` },
        'PipelineSchema',
      ],
    }),

    getSchema: builder.query<PipelineSchemaWithCount, string>({
      query: (id) => `/api/pipeline-schemas/${id}`,
      providesTags: (_result, _error, id) => [
        { type: 'PipelineSchema' as const, id },
      ],
    }),

    createSchema: builder.mutation<PipelineSchema, CreateSchemaDto>({
      query: (data) => ({
        url: '/api/pipeline-schemas',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchema' as const, id: `project-${projectId}` },
        'PipelineSchema',
      ],
    }),

    updateSchema: builder.mutation<PipelineSchema, { id: string; data: UpdateSchemaDto }>({
      query: ({ id, data }) => ({
        url: `/api/pipeline-schemas/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'PipelineSchema' as const, id },
        'PipelineSchema',
      ],
    }),

    deleteSchema: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({
        url: `/api/pipeline-schemas/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['PipelineSchema', 'PipelineData'],
    }),

    generateStateSchema: builder.mutation<GenerateStateSchemaResponse, GenerateStateSchemaDto>({
      query: (data) => ({
        url: '/api/pipeline-schemas/generate-state',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchema' as const, id: `project-${projectId}` },
        'PipelineSchema',
        'Pipeline',
        'ProxyRuleSet',
      ],
    }),

    generateChatSchema: builder.mutation<GenerateChatSchemaResponse, GenerateChatSchemaDto>({
      query: (data) => ({
        url: '/api/pipeline-schemas/generate-chat',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchema' as const, id: `project-${projectId}` },
        'PipelineSchema',
        'Pipeline',
        'ProxyRuleSet',
      ],
    }),

    generateUploadSchema: builder.mutation<GenerateUploadSchemaResponse, GenerateUploadSchemaDto>({
      query: (data) => ({
        url: '/api/pipeline-schemas/generate-upload',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchema' as const, id: `project-${projectId}` },
        'PipelineSchema',
        'Pipeline',
        'ProxyRuleSet',
      ],
    }),

    // ==================== Schema Data ====================

    getSchemaData: builder.query<
      PaginatedDataResponse,
      { schemaId: string; page?: number; pageSize?: number } & DataFilterParams
    >({
      query: ({ schemaId, page = 1, pageSize = 20, search, createdAfter, createdBefore, updatedAfter, updatedBefore, filters, sortBy, sortOrder }) => {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (search) params.set('search', search);
        if (createdAfter) params.set('createdAfter', createdAfter);
        if (createdBefore) params.set('createdBefore', createdBefore);
        if (updatedAfter) params.set('updatedAfter', updatedAfter);
        if (updatedBefore) params.set('updatedBefore', updatedBefore);
        if (filters && Object.keys(filters).length > 0) {
          params.set('filters', JSON.stringify(filters));
        }
        if (sortBy) params.set('sortBy', sortBy);
        if (sortOrder) params.set('sortOrder', sortOrder);
        return `/api/pipeline-schemas/${schemaId}/data?${params.toString()}`;
      },
      providesTags: (_result, _error, { schemaId }) => [
        { type: 'PipelineData' as const, id: `schema-${schemaId}` },
        'PipelineData',
      ],
    }),

    deleteRecord: builder.mutation<{ success: boolean }, { schemaId: string; recordId: string }>({
      query: ({ schemaId, recordId }) => ({
        url: `/api/pipeline-schemas/${schemaId}/data/${recordId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { schemaId }) => [
        { type: 'PipelineData' as const, id: `schema-${schemaId}` },
        'PipelineData',
        'PipelineSchema',
      ],
    }),

    deleteRecords: builder.mutation<
      { success: boolean; deleted: number },
      { schemaId: string; ids: string[] }
    >({
      query: ({ schemaId, ids }) => ({
        url: `/api/pipeline-schemas/${schemaId}/data/bulk`,
        method: 'DELETE',
        body: { ids },
      }),
      invalidatesTags: (_result, _error, { schemaId }) => [
        { type: 'PipelineData' as const, id: `schema-${schemaId}` },
        'PipelineData',
        'PipelineSchema',
      ],
    }),

    getRecord: builder.query<PipelineDataRecord, { schemaId: string; recordId: string }>({
      query: ({ schemaId, recordId }) => `/api/pipeline-schemas/${schemaId}/data/${recordId}`,
      providesTags: (_result, _error, { recordId }) => [
        { type: 'PipelineData' as const, id: recordId },
      ],
    }),

    createRecord: builder.mutation<
      PipelineDataRecord,
      { schemaId: string; data: Record<string, unknown> }
    >({
      query: ({ schemaId, data }) => ({
        url: `/api/pipeline-schemas/${schemaId}/data`,
        method: 'POST',
        body: { data },
      }),
      invalidatesTags: (_result, _error, { schemaId }) => [
        { type: 'PipelineData' as const, id: `schema-${schemaId}` },
        'PipelineData',
        'PipelineSchema',
      ],
    }),

    updateRecord: builder.mutation<
      PipelineDataRecord,
      { schemaId: string; recordId: string; data: Record<string, unknown> }
    >({
      query: ({ schemaId, recordId, data }) => ({
        url: `/api/pipeline-schemas/${schemaId}/data/${recordId}`,
        method: 'PUT',
        body: { data },
      }),
      invalidatesTags: (_result, _error, { schemaId, recordId }) => [
        { type: 'PipelineData' as const, id: `schema-${schemaId}` },
        { type: 'PipelineData' as const, id: recordId },
        'PipelineData',
        'PipelineSchema',
      ],
    }),

    // Note: Export is handled via direct download, not RTK Query
  }),
});

export const {
  // Schemas
  useGetProjectSchemasQuery,
  useGetSchemaQuery,
  useCreateSchemaMutation,
  useUpdateSchemaMutation,
  useDeleteSchemaMutation,
  useGenerateStateSchemaMutation,
  useGenerateChatSchemaMutation,
  useGenerateUploadSchemaMutation,
  // Data
  useGetSchemaDataQuery,
  useGetRecordQuery,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useDeleteRecordMutation,
  useDeleteRecordsMutation,
} = pipelineSchemasApi;

/**
 * Helper function to download schema data export
 */
export async function downloadSchemaExport(
  schemaId: string,
  format: 'json' | 'csv' = 'json',
): Promise<void> {
  const response = await fetch(`/api/pipeline-schemas/${schemaId}/data/export?format=${format}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `data-export.${format}`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
