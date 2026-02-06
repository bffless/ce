import { api } from './api';
import type { StorageProvider } from './setupApi';

// Migration status enum (matching backend)
export type MigrationStatusType =
  | 'none'
  | 'pending'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Migration error details
export interface MigrationError {
  key: string;
  error: string;
  timestamp: string;
  retryable: boolean;
}

// Migration progress
export interface MigrationProgress {
  status: MigrationStatusType;
  totalFiles: number;
  migratedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  migratedBytes: number;
  startedAt: string;
  estimatedCompletionAt?: string;
  currentFile?: string;
  errors: MigrationError[];
  canResume: boolean;
}

// Migration scope calculation
export interface MigrationScope {
  fileCount: number;
  totalBytes: number;
  formattedSize: string;
  estimatedDuration: string;
}

// Migration options
export interface MigrationOptions {
  continueOnError?: boolean;
  concurrency?: number;
  verifyIntegrity?: boolean;
  deleteSourceAfter?: boolean;
  maxRetries?: number;
  filterPrefix?: string;
}

// Start migration request
export interface StartMigrationRequest {
  provider: StorageProvider;
  config: Record<string, unknown>;
  options?: MigrationOptions;
}

// Start migration response
export interface StartMigrationResponse {
  jobId: string;
  message: string;
}

// Migration job details
export interface MigrationJob {
  id?: string;
  sourceProvider?: string;
  targetProvider?: string;
  targetConfig?: Record<string, unknown>;
  status: MigrationStatusType;
  progress?: MigrationProgress;
}

// Complete migration request
export interface CompleteMigrationRequest {
  provider: string;
  config: Record<string, unknown>;
}

// Resume migration request
export interface ResumeMigrationRequest {
  config: Record<string, unknown>;
}

export const migrationApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Calculate migration scope (how many files, total size)
    calculateMigrationScope: builder.query<MigrationScope, string | void>({
      query: (prefix) => ({
        url: '/api/storage/migration/scope',
        params: prefix ? { prefix } : undefined,
      }),
    }),

    // Start a new migration
    startMigration: builder.mutation<StartMigrationResponse, StartMigrationRequest>({
      query: (body) => ({
        url: '/api/storage/migration/start',
        method: 'POST',
        body,
      }),
    }),

    // Get current migration progress
    getMigrationProgress: builder.query<MigrationProgress | { status: 'none' }, void>({
      query: () => '/api/storage/migration/progress',
    }),

    // Get current migration job details
    getMigrationJob: builder.query<MigrationJob, void>({
      query: () => '/api/storage/migration/job',
    }),

    // Cancel current migration
    cancelMigration: builder.mutation<{ success: boolean }, void>({
      query: () => ({
        url: '/api/storage/migration/cancel',
        method: 'DELETE',
      }),
    }),

    // Resume a paused/failed migration
    resumeMigration: builder.mutation<{ success: boolean }, ResumeMigrationRequest>({
      query: (body) => ({
        url: '/api/storage/migration/resume',
        method: 'POST',
        body,
      }),
    }),

    // Complete migration and switch to new provider
    completeMigration: builder.mutation<{ success: boolean }, CompleteMigrationRequest>({
      query: (body) => ({
        url: '/api/storage/migration/complete',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),
  }),
});

export const {
  useCalculateMigrationScopeQuery,
  useLazyCalculateMigrationScopeQuery,
  useStartMigrationMutation,
  useGetMigrationProgressQuery,
  useGetMigrationJobQuery,
  useCancelMigrationMutation,
  useResumeMigrationMutation,
  useCompleteMigrationMutation,
} = migrationApi;
