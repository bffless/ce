import { EventEmitter } from 'events';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
// Real cgroup files don't exist on this host either, but fs.readFile is real
// (threadpool-backed) I/O — mocking it keeps the memory pre-flight's async
// chain to plain microtasks so the flush ticks below are deterministic.
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));
import { spawn } from 'child_process';
import { FfmpegRunnerService } from './ffmpeg-runner.service';

/** Flush pending microtasks (promise chains) without depending on real/fake timers. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A controllable fake child: emit 'close'/'error' and feed stdout/stderr yourself. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = jest.fn(() => {
    child.killed = true;
  });
  return child;
}
const spawnMock = spawn as unknown as jest.Mock;

describe('FfmpegRunnerService', () => {
  beforeEach(() => spawnMock.mockReset());

  it('wraps the command in prlimit --as and nice -n 10', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffmpeg', args: ['-i', 'a', 'b'], cwd: '/tmp' });
    await flush(); // let the memory pre-flight + queue admission resolve before spawn() is reachable
    child.emit('close', 0);
    await done;
    const [cmd, argv] = spawnMock.mock.calls[0];
    expect(cmd).toBe('prlimit');
    expect(argv).toEqual([
      `--as=${1024 * 1024 * 1024}`,
      '--',
      'nice',
      '-n',
      '10',
      'ffmpeg',
      '-nostdin',
      '-hide_banner',
      '-y',
      '-i',
      'a',
      'b',
    ]);
  });

  it('falls back past a missing prlimit (ENOENT) to nice, then bare', async () => {
    const first = fakeChild();
    const second = fakeChild();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffmpeg', args: ['-i', 'a', 'b'], cwd: '/tmp' });
    await flush();
    first.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await flush(); // let the fallback chain advance to the next spawn() before we close it
    second.emit('close', 0);
    await done;
    expect(spawnMock.mock.calls[1][0]).toBe('nice');
  });

  it('rejects with FFMPEG_FAILED carrying the stderr tail on non-zero exit', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' });
    await flush();
    child.stderr.emit('data', Buffer.from('Invalid data found when processing input'));
    child.emit('close', 1);
    await expect(done).rejects.toMatchObject({
      code: 'FFMPEG_FAILED',
      stderrTail: expect.stringContaining('Invalid data'),
    });
  });

  it('SIGKILLs and rejects FFMPEG_TIMEOUT when the watchdog fires', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);
      const svc = new FfmpegRunnerService();
      const done = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp', timeoutSeconds: 5 });
      await flush(); // let the memory pre-flight resolve so spawn() (and the watchdog timer) is armed
      jest.advanceTimersByTime(5001);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.emit('close', null); // the kill lands
      await expect(done).rejects.toMatchObject({ code: 'FFMPEG_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('serializes runs (concurrency 1) and fails fast beyond the queue depth', async () => {
    process.env.FFMPEG_QUEUE_MAX = '1';
    try {
      const first = fakeChild();
      spawnMock.mockReturnValue(first);
      const svc = new FfmpegRunnerService();
      const run1 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' }); // running
      const run2 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' }); // queued (depth 1)
      await expect(svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' })) // over depth
        .rejects.toMatchObject({ code: 'FFMPEG_BUSY' });
      expect(spawnMock).toHaveBeenCalledTimes(1); // run2 not spawned while run1 holds the slot
      const second = fakeChild();
      spawnMock.mockReturnValue(second);
      first.emit('close', 0);
      await run1;
      await new Promise((r) => setImmediate(r)); // let the queue hand over
      expect(spawnMock).toHaveBeenCalledTimes(2);
      second.emit('close', 0);
      await run2;
    } finally {
      delete process.env.FFMPEG_QUEUE_MAX;
    }
  });

  it('refuses when cgroup headroom is insufficient', async () => {
    const svc = new FfmpegRunnerService();
    // limit − rss < memoryMb + headroom → refuse
    jest
      .spyOn(
        svc as never as { readCgroupLimitBytes: () => Promise<number | null> },
        'readCgroupLimitBytes',
      )
      .mockResolvedValue(512 * 1024 * 1024);
    await expect(svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' })).rejects.toMatchObject({
      code: 'FFMPEG_INSUFFICIENT_MEMORY',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
