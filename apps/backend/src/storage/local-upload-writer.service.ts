import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';

/** Sub-directory of the storage root holding in-flight uploads. */
export const TEMP_DIR_NAME = '.tmp';

export class UploadTooLargeError extends Error {
  constructor(
    message: string,
    readonly bytesWritten: number,
  ) {
    super(message);
    this.name = 'UploadTooLargeError';
  }
}

export interface WriteStreamOptions {
  source: Readable;
  basePath: string;
  storageKey: string;
  maxBytes: number;
}

/**
 * Streams an upload body to local storage with bounded memory.
 *
 * Writes to a temp file and atomically renames on success, so a failure never
 * leaves a partial object — or a truncated overwrite of an existing one — at
 * the target key.
 */
@Injectable()
export class LocalUploadWriterService {
  private readonly logger = new Logger(LocalUploadWriterService.name);

  async writeStream({
    source,
    basePath,
    storageKey,
    maxBytes,
  }: WriteStreamOptions): Promise<{ bytesWritten: number; etag: string }> {
    const tempDir = path.join(basePath, TEMP_DIR_NAME);
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, randomUUID());

    const hash = createHash('sha256');
    let bytesWritten = 0;

    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            bytesWritten += chunk.length;
            if (bytesWritten > maxBytes) {
              throw new UploadTooLargeError(
                `Upload exceeds the signed maximum of ${maxBytes} bytes`,
                bytesWritten,
              );
            }
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(tempPath),
      );
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }

    const targetPath = path.join(basePath, storageKey);
    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }

    this.logger.log(`Presigned upload wrote ${bytesWritten} bytes to ${storageKey}`);
    return { bytesWritten, etag: hash.digest('hex') };
  }

  /**
   * Remove abandoned temp files (client disconnected before the body ended).
   * Returns how many were deleted.
   */
  async sweepTempFiles(basePath: string, olderThanMs: number): Promise<number> {
    const tempDir = path.join(basePath, TEMP_DIR_NAME);
    let entries: string[];
    try {
      entries = await fs.readdir(tempDir);
    } catch {
      return 0;
    }

    const cutoff = Date.now() - olderThanMs;
    let deleted = 0;
    for (const entry of entries) {
      const full = path.join(tempDir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(full, { force: true });
          deleted += 1;
        }
      } catch {
        // Raced with another sweeper or a rename; nothing to do.
      }
    }
    if (deleted > 0) this.logger.log(`Swept ${deleted} abandoned upload temp file(s)`);
    return deleted;
  }
}
