import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LocalFfmpegExecutor } from './local-ffmpeg.executor';
import { FfmpegProcessError } from '../ffmpeg-errors';
import type { FfmpegJob } from './ffmpeg-executor.interface';

function make(overrides: { runner?: { run: jest.Mock } } = {}) {
  const runner = overrides.runner ?? {
    run: jest.fn().mockResolvedValue({ stdout: '', stderrTail: '' }),
  };
  const scratch = {
    createJobDir: jest
      .fn()
      .mockImplementation(() => fsp.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-lx-'))),
    cleanup: jest.fn().mockResolvedValue(undefined),
    assertFreeSpace: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('bytes')),
    upload: jest.fn().mockResolvedValue('k'),
    getMetadata: jest.fn().mockResolvedValue({ size: 1000 }),
  };
  const executor = new LocalFfmpegExecutor(runner as never, scratch as never, storage as never);
  // the runner "produces" the last argv token as a file in cwd (mirrors ffmpeg.handler.spec extractSetup)
  runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
    await fsp.writeFile(path.join(cwd, path.basename(args[args.length - 1])), 'out-bytes');
    return { stdout: '', stderrTail: '' };
  });
  return { executor, runner, scratch, storage };
}

const job = (over: Partial<FfmpegJob> = {}): FfmpegJob => ({
  id: 'j1',
  commands: [{ id: 'main', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '-vn', '{out:out.wav}'] }],
  inputs: [{ name: 'in.mp4', key: 'o/r/uploads/a.mp4' }],
  outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', contentType: 'audio/wav' }],
  files: [],
  ...over,
});

describe('LocalFfmpegExecutor', () => {
  it('materialises inputs, substitutes placeholders with scratch paths, uploads outputs, cleans up', async () => {
    const { executor, runner, scratch, storage } = make();
    const res = await executor.run(job(), { signal: new AbortController().signal });
    const req = runner.run.mock.calls[0][0];
    const cwd = req.cwd as string;
    expect(req.binary).toBe('ffmpeg');
    expect(req.args).toEqual(['-i', path.join(cwd, 'in.mp4'), '-vn', path.join(cwd, 'out.wav')]);
    expect(storage.upload).toHaveBeenCalledWith(expect.any(Buffer), 'o/r/uploads/a.wav', {
      mimeType: 'audio/wav',
    });
    expect(res).toMatchObject({
      executor: 'local',
      commands: [{ id: 'main', ran: true, exitCode: 0 }],
      outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', bytes: 9 }],
      bytesIn: 1000,
      bytesOut: 9,
    });
    expect(res.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(scratch.assertFreeSpace).toHaveBeenCalledWith(2 * 1000 + 64 * 1024 * 1024);
    expect(scratch.cleanup).toHaveBeenCalledTimes(1);
  });

  it('writes job files into scratch and resolves {file:NAME}', async () => {
    const { executor, runner } = make();
    await executor.run(
      job({
        commands: [
          {
            id: 'main',
            kind: 'ffmpeg',
            argv: ['-f', 'concat', '-i', '{file:list.txt}', '{out:out.wav}'],
          },
        ],
        files: [{ name: 'list.txt', content: "file 'in.mp4'\n" }],
      }),
      { signal: new AbortController().signal },
    );
    const { args, cwd } = runner.run.mock.calls[0][0];
    expect(args[3]).toBe(path.join(cwd, 'list.txt'));
    await expect(fsp.readFile(path.join(cwd, 'list.txt'), 'utf8')).resolves.toBe("file 'in.mp4'\n");
  });

  it('runs a fallbackFor command only when its target exits non-zero (FFMPEG_FAILED)', async () => {
    const { executor, runner } = make();
    runner.run
      .mockRejectedValueOnce(new FfmpegProcessError('boom', 1, 'stream mismatch'))
      .mockImplementationOnce(async ({ args, cwd }: { args: string[]; cwd: string }) => {
        await fsp.writeFile(path.join(cwd, path.basename(args[args.length - 1])), 'x');
        return { stdout: '', stderrTail: '' };
      });
    const res = await executor.run(
      job({
        commands: [
          { id: 'copy', kind: 'ffmpeg', argv: ['-c', 'copy', '{out:out.wav}'] },
          {
            id: 'reencode',
            kind: 'ffmpeg',
            argv: ['-c:v', 'libx264', '{out:out.wav}'],
            fallbackFor: 'copy',
          },
        ],
      }),
      { signal: new AbortController().signal },
    );
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(res.commands).toEqual([
      { id: 'copy', ran: true, exitCode: 1 },
      { id: 'reencode', ran: true, exitCode: 0 },
    ]);
  });

  it('skips the fallback when its target succeeded, and rethrows non-FFMPEG_FAILED errors untouched', async () => {
    const { executor, runner } = make();
    const res = await executor.run(
      job({
        commands: [
          { id: 'copy', kind: 'ffmpeg', argv: ['{out:out.wav}'] },
          { id: 'reencode', kind: 'ffmpeg', argv: ['{out:out.wav}'], fallbackFor: 'copy' },
        ],
      }),
      { signal: new AbortController().signal },
    );
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(res.commands[1]).toEqual({ id: 'reencode', ran: false, exitCode: null });

    const busy = Object.assign(new Error('busy'), { code: 'FFMPEG_BUSY' });
    runner.run.mockRejectedValueOnce(busy);
    await expect(executor.run(job(), { signal: new AbortController().signal })).rejects.toBe(busy);
  });

  it('maps a missing input object to FILE_NOT_FOUND and always cleans up', async () => {
    const { executor, storage, scratch } = make();
    storage.download.mockRejectedValue(new Error('File not found: o/r/uploads/a.mp4'));
    await expect(
      executor.run(job(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(scratch.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects an argv placeholder that names no job file', async () => {
    const { executor } = make();
    await expect(
      executor.run(job({ commands: [{ id: 'm', kind: 'ffmpeg', argv: ['{in:nope.mp4}'] }] }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/unknown placeholder/);
  });
});
