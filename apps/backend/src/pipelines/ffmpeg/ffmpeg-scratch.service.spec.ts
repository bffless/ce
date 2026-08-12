import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FfmpegScratchService } from './ffmpeg-scratch.service';

describe('FfmpegScratchService', () => {
  let root: string;
  let svc: FfmpegScratchService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-scratch-spec-'));
    process.env.FFMPEG_SCRATCH_DIR = root;
    svc = new FfmpegScratchService();
  });
  afterEach(async () => {
    delete process.env.FFMPEG_SCRATCH_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates isolated job dirs under the scratch root', async () => {
    const a = await svc.createJobDir();
    const b = await svc.createJobDir();
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(root);
    await expect(fs.stat(a)).resolves.toBeDefined();
  });

  it('cleanup removes the dir and tolerates repeats', async () => {
    const dir = await svc.createJobDir();
    await fs.writeFile(path.join(dir, 'x.mp4'), 'bytes');
    await svc.cleanup(dir);
    await expect(fs.stat(dir)).rejects.toThrow();
    await expect(svc.cleanup(dir)).resolves.toBeUndefined(); // idempotent
  });

  it('sweepOrphans removes stale job dirs but spares fresh ones', async () => {
    const stale = await svc.createJobDir();
    const fresh = await svc.createJobDir();
    // Age the stale dir well past the cutoff (2 × FFMPEG_MAX_SECONDS default).
    const old = Date.now() / 1000 - 4000;
    await fs.utimes(stale, old, old);
    process.env.FFMPEG_MAX_SECONDS = '1'; // cutoff = max(2×1s, floor) — see impl floor note
    const removed = await svc.sweepOrphans();
    expect(removed).toBe(1);
    await expect(fs.stat(stale)).rejects.toThrow();
    await expect(fs.stat(fresh)).resolves.toBeDefined();
    delete process.env.FFMPEG_MAX_SECONDS;
  });

  it('assertFreeSpace passes for tiny requirements and throws for absurd ones', async () => {
    await expect(svc.assertFreeSpace(1024)).resolves.toBeUndefined();
    await expect(svc.assertFreeSpace(Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
      code: 'FFMPEG_INSUFFICIENT_DISK',
    });
  });
});
