/**
 * The executor selector: what the OPERATOR enabled (binaries / FFMPEG_REMOTE_URL),
 * which one a step gets, and the additive capability payload. Literal
 * collaborators cast `as never`, per the repo's handler-spec pattern.
 */
import { readFfmpegEnv, type FfmpegEnvConfig } from '../ffmpeg-env';
import { FfmpegExecutorSelector } from './ffmpeg-executor.selector';

function make(
  envOver: Record<string, string> = {},
  o: {
    localAvailable?: boolean;
    flag?: boolean;
    remoteReady?: { ok: boolean; reason?: string; version?: string };
    /** Overrides on the RESOLVED config — what FfmpegExecutorSettingsService.resolved() would hand back. */
    cfg?: Partial<FfmpegEnvConfig>;
    /** What the local `-filters` probe found; undefined = it never ran (remote-only box). */
    drawtext?: boolean;
  } = {},
) {
  const local = {
    name: 'local',
    ready: jest.fn().mockResolvedValue({ ok: true }),
    run: jest.fn(),
    argvThreads: () => 3,
  };
  const remote = {
    name: 'remote',
    ready: jest.fn().mockResolvedValue(o.remoteReady ?? { ok: true, version: '0.4.31' }),
    run: jest.fn(),
    argvThreads: () => 0,
  };
  const capability = {
    isAvailable: () => o.localAvailable ?? true,
    isEnabled: async () => (o.flag ?? true) && (o.localAvailable ?? true),
    getVersion: () => 'ffmpeg version 6.1.1',
    getOps: async () => ['probe', 'extract_audio', 'slice', 'concat', 'frames'],
    isFlagOn: async () => o.flag ?? true,
    hasFilter: () => o.drawtext,
  };
  const env = { ...readFfmpegEnv(envOver), ...(o.cfg ?? {}) };
  return {
    selector: new FfmpegExecutorSelector(
      local as never,
      remote as never,
      capability as never,
      () => env,
    ),
    local,
    remote,
  };
}

it('enabled/default: local only by default; remote joins when FFMPEG_REMOTE_URL is set; FFMPEG_EXECUTOR picks the default', () => {
  expect(make().selector.enabled()).toEqual(['local']);
  expect(make({ FFMPEG_REMOTE_URL: 'https://w' }).selector.enabled()).toEqual(['local', 'remote']);
  expect(
    make({ FFMPEG_REMOTE_URL: 'https://w', FFMPEG_EXECUTOR: 'remote' }).selector.defaultExecutor(),
  ).toBe('remote');
  expect(make({ FFMPEG_EXECUTOR: 'remote' }).selector.defaultExecutor()).toBe('local'); // remote not enabled → falls back
  expect(
    make({ FFMPEG_REMOTE_URL: 'https://w' }, { localAvailable: false }).selector.enabled(),
  ).toEqual(['remote']);
});

it('pick(): explicit request wins; undefined → default; unknown/disabled/not-ready → FFMPEG_EXECUTOR_UNAVAILABLE with a reason', async () => {
  const m = make({ FFMPEG_REMOTE_URL: 'https://w' });
  expect((await m.selector.pick('remote')).name).toBe('remote');
  expect((await m.selector.pick(undefined)).name).toBe('local');
  await expect(m.selector.pick('cloud')).rejects.toMatchObject({
    code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
    message: expect.stringContaining('unknown executor'),
  });
  await expect(make().selector.pick('remote')).rejects.toMatchObject({
    code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
    message: expect.stringContaining('not enabled'),
  });
  await expect(
    make(
      { FFMPEG_REMOTE_URL: 'https://w' },
      { remoteReady: { ok: false, reason: 'worker unreachable: x' } },
    ).selector.pick('remote'),
  ).rejects.toMatchObject({
    code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
    message: expect.stringContaining('worker unreachable'),
  });
});

it('probe(): server = flag && any ready; additive executors/defaultExecutor/remote', async () => {
  await expect(
    make(
      { FFMPEG_REMOTE_URL: 'https://w', FFMPEG_EXECUTOR: 'remote' },
      { localAvailable: false },
    ).selector.probe(),
  ).resolves.toEqual({
    server: true,
    ops: ['probe', 'extract_audio', 'slice', 'concat', 'frames'],
    version: null,
    executors: ['remote'],
    defaultExecutor: 'remote',
    remote: { ready: true, version: '0.4.31', maxInflight: 8 },
  });
  await expect(make({}, { flag: false }).selector.probe()).resolves.toMatchObject({
    server: false,
    ops: [],
    executors: ['local'],
    defaultExecutor: 'local',
  });
  await expect(
    make(
      { FFMPEG_REMOTE_URL: 'https://w' },
      { localAvailable: false, remoteReady: { ok: false, reason: 'nope' } },
    ).selector.probe(),
  ).resolves.toMatchObject({ server: false, remote: { ready: false, reason: 'nope' } });
  // The cap comes from the resolved connection, so apps can size their own queue.
  await expect(
    make({ FFMPEG_REMOTE_URL: 'https://w' }, { cfg: { remoteMaxInflight: 2 } }).selector.probe(),
  ).resolves.toMatchObject({ remote: { ready: true, maxInflight: 2 } });
});

it('enabled(): localEnabled=false hides local even with binaries; remoteEnabled=false hides remote even with a URL', () => {
  expect(make({}, { cfg: { localEnabled: false } }).selector.enabled()).toEqual([]);
  expect(
    make(
      {},
      { cfg: { remoteEnabled: false, remoteUrl: 'https://w.example.com' } },
    ).selector.enabled(),
  ).toEqual(['local']);
  expect(
    make(
      {},
      { cfg: { localEnabled: false, remoteEnabled: true, remoteUrl: 'https://w.example.com' } },
    ).selector.enabled(),
  ).toEqual(['remote']);
});

it("pick('remote') when remote is switched off says so without pointing only at the env var", async () => {
  const { selector } = make({}, { cfg: { remoteEnabled: false } });
  await expect(selector.pick('remote')).rejects.toThrow(/not enabled on this instance/);
  await expect(selector.pick('remote')).rejects.toThrow(/Admin Settings/);
});

/**
 * `filters` is local-only, exactly like `version`: it reports what THIS box's
 * ffmpeg can do, and a remote-only instance has no local binaries to ask. It is
 * additive — absent whenever the probe never ran (R77: absent means "try it").
 */
it('probe(): reports filters.drawtext only for a local box that actually probed its filters', async () => {
  await expect(make({}, { drawtext: true }).selector.probe()).resolves.toMatchObject({
    filters: { drawtext: true },
  });
  await expect(make({}, { drawtext: false }).selector.probe()).resolves.toMatchObject({
    filters: { drawtext: false },
  });
  expect(await make({}, { drawtext: undefined }).selector.probe()).not.toHaveProperty('filters');
  expect(
    await make(
      { FFMPEG_REMOTE_URL: 'https://w' },
      { localAvailable: false, drawtext: true },
    ).selector.probe(),
  ).not.toHaveProperty('filters');
});
