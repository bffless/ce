import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import {
  LocalUploadWriterService,
  UploadTooLargeError,
  TEMP_DIR_NAME,
} from './local-upload-writer.service';

describe('LocalUploadWriterService', () => {
  let basePath: string;
  let writer: LocalUploadWriterService;

  beforeEach(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'bffless-upload-'));
    writer = new LocalUploadWriterService();
  });
  afterEach(async () => {
    await fs.rm(basePath, { recursive: true, force: true });
  });

  const listTemp = async (): Promise<string[]> => {
    try {
      return await fs.readdir(path.join(basePath, TEMP_DIR_NAME));
    } catch {
      return [];
    }
  };

  it('writes the body to the target key and returns a content etag', async () => {
    const body = Buffer.from('hello presigned world');
    const result = await writer.writeStream({
      source: Readable.from([body]),
      basePath,
      storageKey: 'o/r/uploads/content/a.bin',
      maxBytes: 1024,
    });

    expect(result.bytesWritten).toBe(body.length);
    expect(result.etag).toBe(createHash('sha256').update(body).digest('hex'));
    expect(await fs.readFile(path.join(basePath, 'o/r/uploads/content/a.bin'))).toEqual(body);
  });

  it('creates missing parent directories', async () => {
    await writer.writeStream({
      source: Readable.from([Buffer.from('x')]),
      basePath,
      storageKey: 'deep/nested/path/f.txt',
      maxBytes: 16,
    });
    expect(await fs.readFile(path.join(basePath, 'deep/nested/path/f.txt'), 'utf8')).toBe('x');
  });

  it('leaves no temp file behind on success', async () => {
    await writer.writeStream({
      source: Readable.from([Buffer.from('x')]),
      basePath,
      storageKey: 'a.txt',
      maxBytes: 16,
    });
    expect(await listTemp()).toEqual([]);
  });

  it('aborts when the body exceeds maxBytes, writing nothing to the target', async () => {
    await expect(
      writer.writeStream({
        source: Readable.from([Buffer.alloc(100)]),
        basePath,
        storageKey: 'too-big.bin',
        maxBytes: 10,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);

    await expect(fs.access(path.join(basePath, 'too-big.bin'))).rejects.toThrow();
    expect(await listTemp()).toEqual([]);
  });

  it('cleans up when the source stream errors mid-body', async () => {
    const source = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('client disconnected'));
      },
    });

    await expect(
      writer.writeStream({ source, basePath, storageKey: 'partial.bin', maxBytes: 1024 }),
    ).rejects.toThrow(/client disconnected/);

    await expect(fs.access(path.join(basePath, 'partial.bin'))).rejects.toThrow();
    expect(await listTemp()).toEqual([]);
  });

  it('never leaves a partial object at the target key', async () => {
    // Pre-existing content must survive a failed overwrite.
    await fs.writeFile(path.join(basePath, 'existing.bin'), 'ORIGINAL');
    await expect(
      writer.writeStream({
        source: Readable.from([Buffer.alloc(999)]),
        basePath,
        storageKey: 'existing.bin',
        maxBytes: 10,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);

    expect(await fs.readFile(path.join(basePath, 'existing.bin'), 'utf8')).toBe('ORIGINAL');
  });

  it('streams with bounded memory for a body far larger than the heap budget', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x61); // 1 MiB
    const totalChunks = 300; // 300 MiB — would OOM a 128 MB heap if buffered
    let emitted = 0;
    const source = new Readable({
      read() {
        this.push(emitted++ < totalChunks ? chunk : null);
      },
    });

    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    const result = await writer.writeStream({
      source,
      basePath,
      storageKey: 'big.bin',
      maxBytes: totalChunks * chunk.length,
    });

    const growth = process.memoryUsage().heapUsed - before;
    expect(result.bytesWritten).toBe(totalChunks * chunk.length);
    // Generous ceiling; a buffering implementation grows by ~300 MB.
    expect(growth).toBeLessThan(64 * 1024 * 1024);
  }, 60_000);

  it('sweeps temp files older than the cutoff and keeps fresh ones', async () => {
    const tempDir = path.join(basePath, TEMP_DIR_NAME);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'stale'), 'x');
    await fs.writeFile(path.join(tempDir, 'fresh'), 'x');

    const old = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(path.join(tempDir, 'stale'), old, old);

    expect(await writer.sweepTempFiles(basePath, 30 * 60 * 1000)).toBe(1);
    expect(await fs.readdir(tempDir)).toEqual(['fresh']);
  });
});
