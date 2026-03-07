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

export interface PipelineSchema {
  id: string;
  projectId: string;
  name: string;
  fields: SchemaField[];
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
  fields?: SchemaField[];
}

export interface CreateRecordDto {
  data: Record<string, unknown>;
}

export interface UpdateRecordDto {
  data: Record<string, unknown>;
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

    // ==================== Schema Data ====================

    getSchemaData: builder.query<
      PaginatedDataResponse,
      { schemaId: string; page?: number; pageSize?: number }
    >({
      query: ({ schemaId, page = 1, pageSize = 20 }) =>
        `/api/pipeline-schemas/${schemaId}/data?page=${page}&pageSize=${pageSize}`,
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
