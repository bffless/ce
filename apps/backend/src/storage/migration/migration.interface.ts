/**
 * Migration status enum
 */
export enum MigrationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Individual file migration result
 */
export interface MigrationFileResult {
  key: string;
  status: 'success' | 'failed' | 'skipped';
  size: number;
  error?: string;
  durationMs?: number;
}

/**
 * Migration progress snapshot
 */
export interface MigrationProgress {
  status: MigrationStatus;
  totalFiles: number;
  migratedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  migratedBytes: number;
  startedAt: Date;
  estimatedCompletionAt?: Date;
  currentFile?: string;
  errors: MigrationError[];
  canResume: boolean;
}

/**
 * Migration error details
 */
export interface MigrationError {
  key: string;
  error: string;
  timestamp: Date;
  retryable: boolean;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /**
   * Continue migration if individual files fail
   * Default: true
   */
  continueOnError?: boolean;

  /**
   * Number of concurrent file transfers
   * Default: 5
   */
  concurrency?: number;

  /**
   * Verify file integrity after upload (checksum comparison)
   * Default: true
   */
  verifyIntegrity?: boolean;

  /**
   * Delete source files after successful migration
   * Default: false (user must explicitly confirm)
   */
  deleteSourceAfter?: boolean;

  /**
   * Maximum retries per file
   * Default: 3
   */
  maxRetries?: number;

  /**
   * Filter files by prefix (migrate subset)
   */
  filterPrefix?: string;
}

/**
 * Migration job record (stored in database)
 */
export interface MigrationJob {
  id: string;
  sourceProvider: string;
  targetProvider: string;
  targetConfig: Record<string, unknown>; // Stored for use after completion
  status: MigrationStatus;
  options: MigrationOptions;
  progress: MigrationProgress;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  checkpoint?: string; // Last successfully migrated key for resume
}

/**
 * Migration result summary
 */
export interface MigrationResult {
  success: boolean;
  totalFiles: number;
  migratedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  durationMs: number;
  errors: MigrationError[];
}

/**
 * Migration scope calculation result
 */
export interface MigrationScope {
  fileCount: number;
  totalBytes: number;
  formattedSize: string;
  estimatedDuration: string;
}

/**
 * Start migration request DTO
 */
export interface StartMigrationDto {
  provider: 's3' | 'gcs' | 'azure' | 'minio' | 'local';
  config: Record<string, unknown>;
  options?: MigrationOptions;
}

/**
 * Complete migration request DTO
 */
export interface CompleteMigrationDto {
  provider: string;
  config: Record<string, unknown>;
}
