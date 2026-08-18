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

describe('remote executor env', () => {
  it('defaults', () => {
    const e = readFfmpegEnv({});
    expect(e).toMatchObject({
      executor: 'local',
      remoteUrl: null,
      remoteAuth: 'google_id_token',
      remoteSaKeyJson: null,
      remoteMaxInflight: 8,
      remoteConnection: null,
      workerMinVersion: null,
      maxOutputBytes: 2 * 1024 ** 3,
    });
  });
  it('reads and normalises', () => {
    const e = readFfmpegEnv({
      FFMPEG_EXECUTOR: 'remote',
      FFMPEG_REMOTE_URL: ' https://w.run.app/ ',
      FFMPEG_REMOTE_AUTH: 'none',
      FFMPEG_REMOTE_SA_KEY_JSON: '{"type":"service_account"}',
      FFMPEG_REMOTE_MAX_INFLIGHT: '2',
      FFMPEG_WORKER_MIN_VERSION: '0.4.31',
      FFMPEG_MAX_OUTPUT_BYTES: '1024',
    });
    expect(e).toMatchObject({
      executor: 'remote',
      remoteUrl: 'https://w.run.app',
      remoteAuth: 'none',
      remoteSaKeyJson: '{"type":"service_account"}',
      remoteMaxInflight: 2,
      workerMinVersion: '0.4.31',
      maxOutputBytes: 1024,
    });
  });
  it('unknown enum values fall back to defaults; empty strings count as unset', () => {
    expect(
      readFfmpegEnv({
        FFMPEG_EXECUTOR: 'cloud',
        FFMPEG_REMOTE_AUTH: 'basic',
        FFMPEG_REMOTE_URL: '',
      }),
    ).toMatchObject({ executor: 'local', remoteAuth: 'google_id_token', remoteUrl: null });
  });
  it('remoteConnection: FFMPEG_REMOTE_CONNECTION, else the legacy FFMPEG_REMOTE_URL implies the connection named ffmpeg', () => {
    expect(readFfmpegEnv({ FFMPEG_REMOTE_URL: 'https://w' }).remoteConnection).toBe('ffmpeg');
    expect(readFfmpegEnv({ FFMPEG_REMOTE_CONNECTION: 'pdf' }).remoteConnection).toBe('pdf');
    // An explicit name wins over the legacy alias.
    expect(
      readFfmpegEnv({ FFMPEG_REMOTE_CONNECTION: 'pdf', FFMPEG_REMOTE_URL: 'https://w' })
        .remoteConnection,
    ).toBe('pdf');
    expect(readFfmpegEnv({}).remoteConnection).toBeNull();
    expect(readFfmpegEnv({ FFMPEG_REMOTE_CONNECTION: '' }).remoteConnection).toBeNull();
  });
  it('localEnabled is always true from env; remoteEnabled mirrors whether FFMPEG_REMOTE_URL is set', () => {
    const off = readFfmpegEnv({});
    expect(off.localEnabled).toBe(true);
    expect(off.remoteEnabled).toBe(false);
    const on = readFfmpegEnv({ FFMPEG_REMOTE_URL: 'https://w.example.com/' });
    expect(on.remoteEnabled).toBe(true);
    expect(on.remoteUrl).toBe('https://w.example.com');
    expect(readFfmpegEnv({ FFMPEG_REMOTE_URL: '' }).remoteEnabled).toBe(false);
  });
});
