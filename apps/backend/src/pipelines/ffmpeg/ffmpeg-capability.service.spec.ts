/**
 * Boot probe for ffmpeg/ffprobe presence. Missing binaries must degrade
 * gracefully (ENOENT → capability false, one warning) — the wasm fallback in
 * apps depends on this never throwing (spec success criterion 3).
 */
import { FfmpegCapabilityService } from './ffmpeg-capability.service';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';

/** Make the mocked callback-style execFile succeed/fail per binary name. */
function armExecFile(
  impl: (cmd: string, args: string[]) => { error?: NodeJS.ErrnoException; stdout?: string },
) {
  (execFile as unknown as jest.Mock).mockImplementation(
    (
      cmd: string,
      args: string[],
      cb: (e: Error | null, out: { stdout: string; stderr: string }) => void,
    ) => {
      const r = impl(cmd, args);
      // promisify(execFile) resolves {stdout, stderr} — reproduce that contract
      if (r.error) cb(r.error, { stdout: '', stderr: '' });
      else cb(null, { stdout: r.stdout ?? '', stderr: '' });
    },
  );
}

function fakeFlags(enabled: boolean) {
  return { isEnabled: jest.fn().mockResolvedValue(enabled) } as never;
}

describe('FfmpegCapabilityService', () => {
  it('reports available with version when both binaries respond', async () => {
    armExecFile(() => ({ stdout: 'ffmpeg version 6.1.1 Copyright...\nbuilt with gcc' }));
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    expect(svc.isAvailable()).toBe(true);
    expect(svc.getVersion()).toBe('ffmpeg version 6.1.1 Copyright...');
    await expect(svc.getOps()).resolves.toEqual([
      'probe',
      'extract_audio',
      'slice',
      'concat',
      'frames',
    ]);
  });

  it('degrades to unavailable on ENOENT without throwing', async () => {
    const enoent = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
    armExecFile(() => ({ error: enoent }));
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await expect(svc.probe()).resolves.toBeUndefined();
    expect(svc.isAvailable()).toBe(false);
    await expect(svc.getOps()).resolves.toEqual([]);
  });

  it('unavailable when ffprobe alone is missing (both binaries are required)', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    armExecFile((cmd) =>
      cmd === 'ffprobe' ? { error: enoent } : { stdout: 'ffmpeg version 6.0' },
    );
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    expect(svc.isAvailable()).toBe(false);
  });

  it('isEnabled is false when the flag is off, even with binaries present (opt-in default)', async () => {
    armExecFile(() => ({ stdout: 'ffmpeg version 6.0' }));
    const svc = new FfmpegCapabilityService(fakeFlags(false));
    await svc.probe();
    await expect(svc.isEnabled()).resolves.toBe(false);
    await expect(svc.getOps()).resolves.toEqual([]);
  });

  it('isEnabled is true only when flag on AND binaries present', async () => {
    armExecFile(() => ({ stdout: 'ffmpeg version 6.0' }));
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    await expect(svc.isEnabled()).resolves.toBe(true);
    await expect(svc.getOps()).resolves.toEqual([
      'probe',
      'extract_audio',
      'slice',
      'concat',
      'frames',
    ]);
  });

  it('flag on but binaries missing stays false', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    armExecFile(() => ({ error: enoent }));
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    await expect(svc.isEnabled()).resolves.toBe(false);
  });
});

/**
 * `-filters` is parsed by FIELD, not substring: a filter's DESCRIPTION can
 * mention another filter's name, and `hasFilter` gates whether a `frames`
 * step even attempts its burned-in `draw` overlay (R77).
 */
const FILTERS_STDOUT = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  ..C = Command support
  V = Video input/output
 ... abench            A->A       Benchmark part of a filtergraph.
 T.C drawbox           V->V       Draw a colored box on the input video.
 ... metadata          V->V       Manipulate metadata, the way drawtext reads it.
 T.. hflip             V->V       Horizontally flip the input video.
`;

/** ffmpeg -version + ffprobe -version succeed; `-filters` answers per `filters`. */
function armWithFilters(filters: { error?: NodeJS.ErrnoException; stdout?: string }) {
  armExecFile((cmd, args) =>
    cmd === 'ffmpeg' && args.includes('-filters')
      ? filters
      : { stdout: 'ffmpeg version 6.1.1 Copyright...' },
  );
}

describe('FfmpegCapabilityService.hasFilter', () => {
  it('parses the -filters table by field, so a description mention is not a match', async () => {
    armWithFilters({ stdout: FILTERS_STDOUT });
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    expect(svc.hasFilter('drawbox')).toBe(true);
    expect(svc.hasFilter('hflip')).toBe(true);
    // 'drawtext' appears only inside a DESCRIPTION — a substring check would lie.
    expect(svc.hasFilter('drawtext')).toBe(false);
  });

  it('is undefined (not false) when the -filters probe itself fails, and the capability survives', async () => {
    armWithFilters({ error: Object.assign(new Error('boom'), { code: 'EACCES' }) });
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await expect(svc.probe()).resolves.toBeUndefined();
    expect(svc.isAvailable()).toBe(true);
    expect(svc.hasFilter('drawtext')).toBeUndefined();
  });

  /**
   * An UNPARSED table must stay unknown. An empty Set would answer `false` for
   * every filter, which is exactly the silently un-labelled contact sheet the
   * tri-state exists to prevent (R77).
   */
  it('is undefined when the -filters output parses to nothing', async () => {
    armWithFilters({ stdout: 'Filters:\n  T.. = Timeline support\n' });
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    expect(svc.hasFilter('drawtext')).toBeUndefined();
    expect(svc.hasFilter('anything')).toBeUndefined();
  });

  it('is undefined when the probe never ran or the binaries are missing', async () => {
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    expect(svc.hasFilter('drawtext')).toBeUndefined();
    armExecFile(() => ({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    await svc.probe();
    expect(svc.hasFilter('drawtext')).toBeUndefined();
  });
});
