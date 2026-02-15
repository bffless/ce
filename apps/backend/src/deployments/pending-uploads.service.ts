import { Injectable, Logger } from '@nestjs/common';
import { eq, lt, and } from 'drizzle-orm';
import * as crypto from 'crypto';
import { db } from '../db/client';
import {
  pendingUploads,
  PendingUpload,
  NewPendingUpload,
  PendingUploadFile,
} from '../db/schema/pending-uploads.schema';

export interface CreatePendingUploadParams {
  projectId: string;
  repository: string;
  commitSha: string;
  branch?: string;
  alias?: string;
  basePath?: string;
  description?: string;
  tags?: unknown;
  proxyRuleSetId?: string;
  files: PendingUploadFile[];
  uploadedBy?: string;
  expiresInSeconds?: number;
}

@Injectable()
export class PendingUploadsService {
  private readonly logger = new Logger(PendingUploadsService.name);

  /**
   * Generate a cryptographically secure upload token
   */
  private generateUploadToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new pending upload record
   */
  async create(params: CreatePendingUploadParams): Promise<PendingUpload> {
    const uploadToken = this.generateUploadToken();
    const expiresInSeconds = params.expiresInSeconds ?? 3600; // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const values: NewPendingUpload = {
      uploadToken,
      projectId: params.projectId,
      repository: params.repository,
      commitSha: params.commitSha,
      branch: params.branch,
      alias: params.alias,
      basePath: params.basePath,
      description: params.description,
      tags: params.tags,
      proxyRuleSetId: params.proxyRuleSetId,
      files: params.files,
      uploadedBy: params.uploadedBy,
      expiresAt,
    };

    const [created] = await db.insert(pendingUploads).values(values).returning();

    this.logger.log({
      event: 'pending_upload_created',
      uploadToken,
      projectId: params.projectId,
      fileCount: params.files.length,
      expiresAt: expiresAt.toISOString(),
    });

    return created;
  }

  /**
   * Find a pending upload by its upload token
   */
  async findByToken(token: string): Promise<PendingUpload | null> {
    const [record] = await db
      .select()
      .from(pendingUploads)
      .where(eq(pendingUploads.uploadToken, token))
      .limit(1);

    return record || null;
  }

  /**
   * Delete a pending upload by ID
   * Called after successful finalization
   */
  async delete(id: string): Promise<void> {
    await db.delete(pendingUploads).where(eq(pendingUploads.id, id));

    this.logger.log({
      event: 'pending_upload_deleted',
      id,
    });
  }

  /**
   * Find all expired pending uploads
   */
  async findExpired(): Promise<PendingUpload[]> {
    const now = new Date();

    return db
      .select()
      .from(pendingUploads)
      .where(lt(pendingUploads.expiresAt, now));
  }

  /**
   * Delete multiple pending uploads by their IDs
   * Used by the cleanup scheduler
   */
  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    let deletedCount = 0;
    for (const id of ids) {
      const result = await db
        .delete(pendingUploads)
        .where(eq(pendingUploads.id, id))
        .returning();
      if (result.length > 0) deletedCount++;
    }

    this.logger.log({
      event: 'pending_uploads_batch_deleted',
      count: deletedCount,
    });

    return deletedCount;
  }

  /**
   * Get all storage keys from a pending upload's file manifest
   * Used by cleanup to delete orphaned files
   */
  getStorageKeysFromUpload(upload: PendingUpload): string[] {
    return upload.files.map((f) => f.storageKey);
  }
}
