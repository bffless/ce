import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { assets, projects } from '../db/schema';
import { AssetType } from '../types/asset-type.enum';
import { PipelineContext } from './execution/pipeline-context.interface';
import { PipelineDataService } from './pipeline-data.service';
import { ConfigurationError } from './errors';

/**
 * Parts of a computed upload storage key.
 */
export interface UploadKeyParts {
  /** Full storage key: {owner}/{repo}/uploads/{subDir}[/{date}]/{uuid}-{filename} */
  storageKey: string;
  /** The stored filename including the UUID prefix */
  storedFilename: string;
  /** Filename with unsafe characters replaced, without the UUID prefix */
  sanitizedFilename: string;
  /** Public serving path: /api/uploads/{subDir}[/{date}]/{storedFilename} */
  publicPath: string;
}

/**
 * Standard output shape returned for an uploaded file, identical across the
 * proxied (file_upload_handler) and presigned (register_upload) paths.
 */
export interface UploadRecordOutput {
  id: string;
  filename: string;
  url: string;
  storage_path: string;
  content_type: string;
  size: number;
  original_name: string;
}

/**
 * Shared core for file-upload bookkeeping.
 *
 * Both the proxied upload path (file_upload_handler, which streams bytes through
 * the backend) and the presigned path (register_upload, where bytes go directly
 * to the bucket) use this service so the resulting pipeline_data + asset records
 * are byte-for-byte identical regardless of how the file arrived.
 */
@Injectable()
export class UploadRecordService {
  private readonly logger = new Logger(UploadRecordService.name);

  constructor(private readonly dataService: PipelineDataService) {}

  /**
   * Resolve the owner/repo used to namespace the storage key — from the
   * deployment context if present, otherwise by looking up the project.
   */
  async resolveOwnerRepo(
    context: PipelineContext,
    stepName: string,
  ): Promise<{ owner: string; repo: string }> {
    let owner = context.deployment?.owner;
    let repo = context.deployment?.repo;
    if (owner && repo) {
      return { owner, repo };
    }

    const [project] = await db
      .select({ owner: projects.owner, name: projects.name })
      .from(projects)
      .where(eq(projects.id, context.projectId))
      .limit(1);
    if (!project) {
      throw new ConfigurationError(
        'Could not resolve project for file upload storage path',
        stepName,
      );
    }
    owner = project.owner;
    repo = project.name;
    return { owner, repo };
  }

  /**
   * Build the storage key + public path for a new upload. Used by both the
   * prepare (presigned) and proxied paths so keys are constructed identically.
   */
  buildUploadKey(opts: {
    owner: string;
    repo: string;
    subDir: string;
    originalName: string;
    dateBucket?: boolean;
  }): UploadKeyParts {
    const uuid = randomUUID();
    const sanitizedFilename = opts.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

    let storageKey = `${opts.owner}/${opts.repo}/uploads/${opts.subDir}`;
    let subDirPath = opts.subDir;
    if (opts.dateBucket) {
      const dateSegment = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      storageKey += `/${dateSegment}`;
      subDirPath = `${opts.subDir}/${dateSegment}`;
    }

    const storedFilename = `${uuid}-${sanitizedFilename}`;
    storageKey += `/${storedFilename}`;
    const publicPath = `/api/uploads/${subDirPath}/${storedFilename}`;

    return { storageKey, storedFilename, sanitizedFilename, publicPath };
  }

  /**
   * Validate and parse a storage key that originated from a prepare step and was
   * round-tripped back through an untrusted client. Ensures the key stays within
   * this project's uploads area (no cross-project writes, no path traversal).
   *
   * @returns parsed key parts, or null if the key is not a valid upload key for this owner/repo
   */
  parseUploadKey(
    storageKey: string,
    owner: string,
    repo: string,
  ): UploadKeyParts | null {
    const prefix = `${owner}/${repo}/uploads/`;
    if (typeof storageKey !== 'string') return null;
    if (!storageKey.startsWith(prefix)) return null;
    if (storageKey.includes('..') || storageKey.includes('//')) return null;

    const rest = storageKey.slice(prefix.length); // e.g. "images/2024-01-01/uuid-name.png"
    const segments = rest.split('/');
    const storedFilename = segments[segments.length - 1];
    if (!storedFilename) return null;

    // Strip a leading UUID prefix ("<uuid>-") to recover the sanitized name
    const sanitizedFilename = storedFilename.replace(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-/,
      '',
    );
    const publicPath = `/api/uploads/${rest}`;

    return { storageKey, storedFilename, sanitizedFilename, publicPath };
  }

  /**
   * Create the pipeline_data + asset records for an uploaded file. This is the
   * single source of truth for what an uploaded file looks like in the DB.
   *
   * The asset record is best-effort: the pipeline_data record is authoritative,
   * so an asset insert failure is logged but not fatal (matching prior behavior).
   */
  async createUploadRecords(params: {
    context: PipelineContext;
    schemaId: string;
    schemaVersion: number;
    subDir: string;
    storageKey: string;
    storedFilename: string;
    sanitizedFilename: string;
    originalName: string;
    mimeType: string;
    size: number;
    publicPath: string;
    contentHash?: string | null;
    /** Already-evaluated extra fields to merge into the pipeline_data record */
    extraData?: Record<string, unknown>;
  }): Promise<UploadRecordOutput> {
    const { context } = params;

    const data: Record<string, unknown> = {
      filename: params.storedFilename,
      storage_path: params.storageKey,
      content_type: params.mimeType,
      size: params.size,
      url: params.publicPath,
      sub_dir: params.subDir,
      original_name: params.originalName,
      ...(params.extraData ?? {}),
    };

    const record = await this.dataService.create(
      params.schemaId,
      context.projectId,
      data,
      context.user?.id,
      context.deployment?.alias ?? null,
      params.schemaVersion,
    );

    try {
      await db.insert(assets).values({
        fileName: params.sanitizedFilename,
        originalPath: params.originalName,
        storageKey: params.storageKey,
        mimeType: params.mimeType,
        size: params.size,
        projectId: context.projectId,
        uploadedBy: context.user?.id || null,
        assetType: AssetType.UPLOADS,
        publicPath: params.publicPath,
        contentHash: params.contentHash ?? null,
      });
    } catch (err) {
      this.logger.warn(`Failed to create asset record: ${err}`);
      // Non-fatal - the upload and pipeline_data record are the source of truth
    }

    this.logger.debug(
      `Recorded upload "${params.sanitizedFilename}" at ${params.storageKey} (record ${record.id})`,
    );

    return {
      id: record.id,
      filename: params.sanitizedFilename,
      url: params.publicPath,
      storage_path: params.storageKey,
      content_type: params.mimeType,
      size: params.size,
      original_name: params.originalName,
    };
  }

  /**
   * Check if a MIME type matches allowed patterns (supports glob like "image/*").
   */
  isMimeTypeAllowed(mimeType: string, allowedTypes: string[]): boolean {
    for (const pattern of allowedTypes) {
      if (pattern === '*/*') return true;
      if (pattern === mimeType) return true;
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (mimeType.startsWith(prefix + '/')) return true;
      }
    }
    return false;
  }
}
