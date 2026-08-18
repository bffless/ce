import { readRemoteConnectionsEnv } from './remote-connections-env';

describe('readRemoteConnectionsEnv', () => {
  it('reads REMOTE_CONNECTION_<NAME>_* into a lower-case dashed name', () => {
    const m = readRemoteConnectionsEnv({
      REMOTE_CONNECTION_PDF_RENDERER_URL: 'https://pdf.run.app/',
      REMOTE_CONNECTION_PDF_RENDERER_AUTH: 'none',
      REMOTE_CONNECTION_PDF_RENDERER_MAX_INFLIGHT: '3',
      REMOTE_CONNECTION_PDF_RENDERER_HEALTH_PATH: '/healthz',
    });
    expect(m.get('pdf-renderer')).toEqual({
      url: 'https://pdf.run.app',
      auth: 'none',
      maxInflight: 3,
      healthPath: '/healthz',
    });
  });

  it('maps legacy FFMPEG_REMOTE_* onto the ffmpeg connection', () => {
    const m = readRemoteConnectionsEnv({
      FFMPEG_REMOTE_URL: 'https://w.run.app',
      FFMPEG_REMOTE_AUTH: 'none',
      FFMPEG_REMOTE_SA_KEY_JSON: '{"type":"service_account"}',
      FFMPEG_REMOTE_MAX_INFLIGHT: '4',
    });
    expect(m.get('ffmpeg')).toEqual({
      url: 'https://w.run.app',
      auth: 'none',
      credential: '{"type":"service_account"}',
      maxInflight: 4,
    });
  });

  it('explicit REMOTE_CONNECTION_FFMPEG_* wins over the legacy alias per field', () => {
    const m = readRemoteConnectionsEnv({
      FFMPEG_REMOTE_URL: 'https://old.run.app',
      REMOTE_CONNECTION_FFMPEG_URL: 'https://new.run.app',
      FFMPEG_REMOTE_AUTH: 'none',
    });
    expect(m.get('ffmpeg')).toEqual({ url: 'https://new.run.app', auth: 'none' });
  });

  it("treats '' as unset, ignores bad numbers and unknown auth values", () => {
    const m = readRemoteConnectionsEnv({
      REMOTE_CONNECTION_A_URL: '',
      REMOTE_CONNECTION_B_URL: 'https://b',
      REMOTE_CONNECTION_B_MAX_INFLIGHT: 'lots',
      REMOTE_CONNECTION_B_AUTH: 'magic',
    });
    expect(m.has('a')).toBe(false);
    expect(m.get('b')).toEqual({ url: 'https://b' });
  });

  it("HEALTH_PATH 'none' disables the probe", () => {
    const m = readRemoteConnectionsEnv({
      REMOTE_CONNECTION_X_URL: 'https://x',
      REMOTE_CONNECTION_X_HEALTH_PATH: 'none',
    });
    expect(m.get('x')).toEqual({ url: 'https://x', healthPath: null });
  });
});
