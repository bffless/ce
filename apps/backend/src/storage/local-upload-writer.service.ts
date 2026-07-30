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

/**
 * Thrown when the stream ends having written fewer (or more, though that path
 * is unreachable here — see writeStream) bytes than the caller declared it
 * would. The prototypical cause: something upstream of this service (e.g. a
 * body parser mis-triggered by an unexpected Content-Type) fully consumed the
 * request stream before it reached here, so `source` ends immediately having
 * yielded zero bytes. Without this check, that would rename a 0-byte temp
 * file over whatever object already existed at `storageKey` and report 200 —
 * data destruction reported as success. Raised (and the temp file discarded)
 * BEFORE the rename, so the target key is never touched by a short write.
 */
export class UploadIncompleteError extends Error {
  constructor(
    message: string,
    readonly bytesWritten: number,
    readonly expectedBytes: number,
  ) {
    super(message);
    this.name = 'UploadIncompleteError';
  }
}

export interface WriteStreamOptions {
  source: Readable;
  basePath: string;
  storageKey: string;
  maxBytes: number;
  /**
   * The declared body length (Content-Length) the caller verified before
   * streaming. When provided, `writeStream` requires `bytesWritten` to equal
   * it exactly before renaming into place — see UploadIncompleteError.
   * Optional so lower-level/test callers that don't have a declared length
   * aren't forced to supply one.
   */
  expectedBytes?: number;
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
    expectedBytes,
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

    // Integrity check, BEFORE the rename below: a stream that ended having
    // written fewer bytes than declared means something consumed or
    // truncated the body upstream of us (e.g. a global body-parser fully
    // draining the request because of an unexpected Content-Type). Renaming
    // a short temp file into place would silently destroy whatever object
    // already existed at storageKey while reporting success, so this is
    // caught here — before the target key is touched at all — and the temp
    // file is discarded instead of promoted.
    if (expectedBytes !== undefined && bytesWritten !== expectedBytes) {
      await fs.rm(tempPath, { force: true });
      throw new UploadIncompleteError(
        `Upload wrote ${bytesWritten} bytes but the declared length was ${expectedBytes} bytes`,
        bytesWritten,
        expectedBytes,
      );
    }

    // `fs.rename` is only atomic within a single filesystem. That holds here
    // because the temp dir (`<basePath>/.tmp`) is deliberately co-located
    // under the same `basePath` as the target, not on a separate mount. If a
    // caller ever pointed `basePath` at a path spanning a mount boundary
    // relative to the temp dir, this would surface as `EXDEV` — which fails
    // safe: the upload errors out and the temp file is cleaned up below, but
    // nothing at the target key is ever truncated or partially written.
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
   *
   * Liveness contract: this sweeper has no lease tying it to an in-flight
   * `writeStream` call. It infers liveness purely from each temp file's
   * `mtime`. That is safe because every chunk written via `createWriteStream`
   * issues a real `write()` syscall, which advances the file's `mtime` — so
   * an upload that is actively making progress is continuously refreshing
   * its own `mtime` and is therefore never eligible for a sweep under any
   * sane cutoff. The population this sweeper actually deletes is temp files
   * whose writes have *stopped* — i.e. genuinely stalled or abandoned
   * uploads — which is exactly what it's for.
   *
   * Caller obligation: `olderThanMs` must exceed the longest plausible
   * *stall* within a legitimate upload (a slow chunk, a network hiccup), not
   * merely the upload's total expected duration. A cutoff sized to "total
   * upload time" would be far too aggressive and could sweep a slow-but-live
   * upload.
   *
   * Failure mode if a sweep still wins a race against a live upload: the
   * temp file disappears out from under the open write stream, and the
   * final `fs.rename` in `writeStream` fails with `ENOENT`. The client's
   * upload is lost, but nothing is corrupted — no partial or truncated
   * object is ever written to the target key.
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
