/**
 * uploadStream — streaming write path added for the ffmpeg handler so multi-GB
 * transcode outputs never enter the backend heap. Mirrors upload()'s key
 * sanitization and metadata handling.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { LocalStorageAdapter } from './local.adapter';

describe('LocalStorageAdapter.uploadStream', () => {
  let dir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-stream-'));
    adapter = new LocalStorageAdapter({ localPath: dir });
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('streams bytes to the key and round-trips via download', async () => {
    const bytes = Buffer.from('streamed-video-bytes');
    const key = await adapter.uploadStream!(Readable.from(bytes), 'o/r/uploads/a.mp4', bytes.length, {
      mimeType: 'video/mp4',
    });
    expect(key).toBe('o/r/uploads/a.mp4');
    expect(await adapter.download('o/r/uploads/a.mp4')).toEqual(bytes);
  });

  it('rejects traversal keys like upload() does', async () => {
    await expect(
      adapter.uploadStream!(Readable.from(Buffer.from('x')), '../escape', 1),
    ).rejects.toThrow();
  });
});
