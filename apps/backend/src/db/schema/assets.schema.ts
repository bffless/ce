import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { projects } from './projects.schema';
import { AssetType } from '../../types/asset-type.enum';

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalPath: text('original_path'),
    storageKey: text('storage_key').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(),

    // GitHub Context
    projectId: uuid('project_id')
      .references(() => projects.id)
      .notNull(), // Required - migration complete in Phase 3A
    branch: varchar('branch', { length: 255 }),
    commitSha: varchar('commit_sha', { length: 40 }),
    workflowName: varchar('workflow_name', { length: 255 }),
    workflowRunId: varchar('workflow_run_id', { length: 50 }),
    workflowRunNumber: integer('workflow_run_number'),

    // Ownership
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    organizationId: uuid('organization_id'),

    // Metadata
    tags: text('tags'), // JSON array stored as text
    description: text('description'),

    // Deployment & Public Serving (for section 1.7)
    deploymentId: uuid('deployment_id'), // groups files from same deployment
    publicPath: text('public_path'), // file path within deployment (e.g., "css/style.css")

    // Asset type for path segmentation (commits, uploads, static)
    assetType: varchar('asset_type', { length: 20 }).notNull().default(AssetType.COMMITS),

    // Git commit timestamp (when the commit was authored)
    // Nullable for backwards compatibility - old records use createdAt as fallback
    committedAt: timestamp('committed_at'),

    // Content hash for ETag optimization (MD5 of file content)
    // Computed at upload time to avoid MD5 on every request
    // Nullable for backwards compatibility with existing assets
    contentHash: text('content_hash'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Phase 3H.7: Cleaned up - removed deprecated repository and isPublic indexes
    // Indexes for Phase 3A - Projects Table Foundation
    index('assets_project_id_idx').on(table.projectId),
    index('assets_project_type_idx').on(table.projectId, table.assetType),
    index('assets_project_commit_path_idx').on(table.projectId, table.commitSha, table.publicPath),
    index('assets_project_branch_idx').on(table.projectId, table.branch),
    index('assets_project_commit_idx').on(table.projectId, table.commitSha),
    index('assets_project_created_at_idx').on(table.projectId, table.createdAt),
    index('assets_project_committed_at_idx').on(table.projectId, table.committedAt),
    // Indexes for Deployment lookups
    index('assets_deployment_path_idx').on(table.deploymentId, table.publicPath),
    index('assets_deployment_id_idx').on(table.deploymentId),
    index('assets_deployment_size_idx').on(table.deploymentId, table.size),
  ],
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
