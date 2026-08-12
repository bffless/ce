import * as os from 'os';
import * as path from 'path';
import { readFfmpegEnv } from './ffmpeg-env';

describe('readFfmpegEnv', () => {
  it('applies spec defaults when unset', () => {
    const cfg = readFfmpegEnv({});
    expect(cfg.memoryMb).toBe(1024);
    expect(cfg.threads).toBe(Math.max(1, os.cpus().length - 1));
    expect(cfg.queueMax).toBe(8);
    expect(cfg.maxSeconds).toBe(1800);
    expect(cfg.scratchDir).toBe(path.join(os.tmpdir(), 'bffless-ffmpeg'));
  });

  it('treats empty string as unset (compose passthrough leaves FOO: "" when unconfigured)', () => {
    expect(readFfmpegEnv({ FFMPEG_MEMORY_MB: '' }).memoryMb).toBe(1024);
  });

  it('rejects garbage numbers back to defaults', () => {
    expect(readFfmpegEnv({ FFMPEG_QUEUE_MAX: 'lots' }).queueMax).toBe(8);
    expect(readFfmpegEnv({ FFMPEG_MAX_SECONDS: '-5' }).maxSeconds).toBe(1800);
  });
});
