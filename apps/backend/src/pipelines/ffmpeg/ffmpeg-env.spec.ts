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
    expect(cfg.jobMaxSeconds).toBe(3600); // 2x the process watchdog
    expect(cfg.ioMaxSeconds).toBe(900);
    expect(cfg.scratchDir).toBe(path.join(os.tmpdir(), 'bffless-ffmpeg'));
  });

  it('derives the job ceiling from FFMPEG_MAX_SECONDS unless set explicitly', () => {
    expect(readFfmpegEnv({ FFMPEG_MAX_SECONDS: '60' }).jobMaxSeconds).toBe(120);
    expect(
      readFfmpegEnv({ FFMPEG_MAX_SECONDS: '60', FFMPEG_JOB_MAX_SECONDS: '90' }).jobMaxSeconds,
    ).toBe(90);
  });

  it('treats empty string as unset (compose passthrough leaves FOO: "" when unconfigured)', () => {
    expect(readFfmpegEnv({ FFMPEG_MEMORY_MB: '' }).memoryMb).toBe(1024);
  });

  it('rejects garbage numbers back to defaults', () => {
    expect(readFfmpegEnv({ FFMPEG_QUEUE_MAX: 'lots' }).queueMax).toBe(8);
    expect(readFfmpegEnv({ FFMPEG_MAX_SECONDS: '-5' }).maxSeconds).toBe(1800);
  });
});
