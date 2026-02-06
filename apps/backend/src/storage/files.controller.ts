import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { IStorageAdapter, STORAGE_ADAPTER } from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';

/**
 * File serving controller for local storage
 *
 * Serves files stored in local storage at /files/* URLs.
 * Only works when local storage adapter is configured.
 *
 * Note: This endpoint does not support presigned URL expiration.
 * For time-limited access, use MinIO/S3 with presigned URLs instead.
 */
@ApiTags('Files')
@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(@Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter) {}

  /**
   * Serve a file from local storage
   *
   * URL format: /files/{owner}/{repo}/commits/{commitSha}/{path}
   * Example: /files/myuser/myrepo/commits/abc123/images/logo.png
   */
  @Get('*')
  @ApiOperation({
    summary: 'Serve file from local storage',
    description:
      'Serves files stored in local storage. Only available when local storage adapter is configured.',
  })
  @ApiParam({
    name: '0',
    description: 'File path (e.g., owner/repo/commits/commitSha/path/to/file.png)',
    type: 'string',
  })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 400, description: 'Invalid path or not using local storage' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async serveFile(@Param('0') filePath: string, @Res() res: Response): Promise<void> {
    // Check if we're using local storage
    if (!(this.storageAdapter instanceof LocalStorageAdapter)) {
      throw new BadRequestException(
        'File serving endpoint is only available with local storage. ' +
          'Use the presigned URL from /api/assets/:id/url instead.',
      );
    }

    // Validate the path
    if (!filePath || filePath.trim() === '') {
      throw new BadRequestException('File path is required');
    }

    // Sanitize and validate path (prevent path traversal)
    const sanitizedPath = filePath.replace(/^\/+|\/+$/g, '');
    if (sanitizedPath.includes('..')) {
      throw new BadRequestException('Invalid file path');
    }

    try {
      // Check if file exists
      const exists = await this.storageAdapter.exists(sanitizedPath);
      if (!exists) {
        throw new NotFoundException(`File not found: ${sanitizedPath}`);
      }

      // Get file metadata for headers
      const metadata = await this.storageAdapter.getMetadata(sanitizedPath);

      // Download the file
      const buffer = await this.storageAdapter.download(sanitizedPath);

      // Set response headers
      res.set({
        'Content-Type': metadata.mimeType || 'application/octet-stream',
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 year cache for immutable content
        ETag: `"${metadata.etag}"`,
        'Last-Modified': metadata.lastModified?.toUTCString(),
      });

      // Handle conditional requests (If-None-Match)
      const ifNoneMatch = res.req?.headers['if-none-match'];
      if (ifNoneMatch === `"${metadata.etag}"`) {
        res.status(304).end();
        return;
      }

      // Send the file
      res.send(buffer);

      this.logger.debug(`Served file: ${sanitizedPath}`);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error serving file ${sanitizedPath}:`, error);

      if (error.message?.includes('not found')) {
        throw new NotFoundException(`File not found: ${sanitizedPath}`);
      }

      throw new BadRequestException(`Failed to serve file: ${error.message}`);
    }
  }
}
