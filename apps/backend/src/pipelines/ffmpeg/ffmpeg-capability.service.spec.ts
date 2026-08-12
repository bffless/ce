/**
 * Boot probe for ffmpeg/ffprobe presence. Missing binaries must degrade
 * gracefully (ENOENT → capability false, one warning) — the wasm fallback in
 * apps depends on this never throwing (spec success criterion 3).
 */
import { FfmpegCapabilityService } from './ffmpeg-capability.service';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';

/** Make the mocked callback-style execFile succeed/fail per binary name. */
function armExecFile(impl: (cmd: string) => { error?: NodeJS.ErrnoException; stdout?: string }) {
  (execFile as unknown as jest.Mock).mockImplementation(
    (
      cmd: string,
      _args: string[],
      cb: (e: Error | null, out: { stdout: string; stderr: string }) => void,
    ) => {
      const r = impl(cmd);
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
    await expect(svc.getOps()).resolves.toEqual(['probe', 'extract_audio', 'slice', 'concat']);
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
    await expect(svc.getOps()).resolves.toEqual(['probe', 'extract_audio', 'slice', 'concat']);
  });

  it('flag on but binaries missing stays false', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    armExecFile(() => ({ error: enoent }));
    const svc = new FfmpegCapabilityService(fakeFlags(true));
    await svc.probe();
    await expect(svc.isEnabled()).resolves.toBe(false);
  });
});
