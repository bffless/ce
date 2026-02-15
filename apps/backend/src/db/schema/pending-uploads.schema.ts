import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.schema';
import { users } from './users.schema';
import { proxyRuleSets } from './proxy-rule-sets.schema';

/**
 * File info stored in the pending upload manifest
 */
export interface PendingUploadFile {
  /** Relative path within the deployment */
  path: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** Storage key where the file will be uploaded */
  storageKey: string;
}

/**
 * Pending uploads table
 *
 * Tracks batch uploads that use presigned URLs for direct-to-storage uploads.
 * Records are created when prepare-batch-upload is called and deleted after
 * successful finalize-upload. Expired records are cleaned up by a scheduler.
 */
export const pendingUploads = pgTable(
  'pending_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Unique token used to identify this upload session */
    uploadToken: varchar('upload_token', { length: 64 }).notNull().unique(),

    /** Project this upload belongs to */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),

    /** Repository string (owner/repo) for backwards compatibility */
    repository: varchar('repository', { length: 255 }).notNull(),

    /** Git commit SHA */
    commitSha: varchar('commit_sha', { length: 40 }).notNull(),

    /** Git branch name */
    branch: varchar('branch', { length: 255 }),

    /** Alias to create/update after finalization */
    alias: varchar('alias', { length: 100 }),

    /** Base path within the upload for preview alias */
    basePath: varchar('base_path', { length: 512 }),

    /** Optional description for the deployment */
    description: text('description'),

    /** Tags for the deployment (JSON array) */
    tags: jsonb('tags'),

    /** Proxy rule set to apply to aliases */
    proxyRuleSetId: uuid('proxy_rule_set_id').references(() => proxyRuleSets.id),

    /**
     * File manifest - array of PendingUploadFile objects
     * Contains all files expected in this upload with their storage keys
     */
    files: jsonb('files').notNull().$type<PendingUploadFile[]>(),

    /** User who initiated the upload */
    uploadedBy: uuid('uploaded_by').references(() => users.id),

    /** When the upload session was created */
    createdAt: timestamp('created_at').defaultNow().notNull(),

    /** When the upload session expires (presigned URLs become invalid) */
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('pending_uploads_token_idx').on(table.uploadToken),
    index('pending_uploads_expires_idx').on(table.expiresAt),
    index('pending_uploads_project_idx').on(table.projectId),
  ],
);

export type PendingUpload = typeof pendingUploads.$inferSelect;
export type NewPendingUpload = typeof pendingUploads.$inferInsert;
