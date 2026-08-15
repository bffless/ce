import { EventEmitter } from 'events';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
// Real cgroup files don't exist on this host either, but fs.readFile is real
// (threadpool-backed) I/O — mocking it keeps the memory pre-flight's async
// chain to plain microtasks so the flush ticks below are deterministic.
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));
import { spawn } from 'child_process';
import * as fsPromises from 'fs/promises';
import { FfmpegRunnerService } from './ffmpeg-runner.service';

/** Flush pending microtasks (promise chains) without depending on real/fake timers. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const fsReadFile = fsPromises.readFile as jest.Mock;

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
  beforeEach(() => {
    spawnMock.mockReset();
    // Default: no readable cgroup limit (bare host) — matches this test host.
    fsReadFile.mockReset().mockRejectedValue(enoent());
  });

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

  it('wraps ffprobe with only -hide_banner — no ffmpeg-only -nostdin/-y', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffprobe', args: ['-show_format', 'in.mp4'], cwd: '/tmp' });
    await flush();
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
      'ffprobe',
      '-hide_banner',
      '-show_format',
      'in.mp4',
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

  it('escalates a wedged SIGKILL: rejects FFMPEG_TIMEOUT after the grace window so the slot frees', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);
      const svc = new FfmpegRunnerService();
      const done = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp', timeoutSeconds: 5 });
      await flush();
      jest.advanceTimersByTime(5001);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      // Process never actually exits (e.g. stuck in uninterruptible I/O) — 'close' never fires.
      // Advance past the 30s escalation grace window: the runner must give up and self-heal.
      jest.advanceTimersByTime(30001);
      await expect(done).rejects.toMatchObject({ code: 'FFMPEG_TIMEOUT' });
      // A late 'close' arriving after the escalation already settled the promise must be a no-op.
      expect(() => child.emit('close', null)).not.toThrow();
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

  /**
   * #669: a queued caller must never wait forever. If the slot holder stops
   * making progress the waiter gives up with the same fail-fast BUSY the queue
   * ceiling produces — and, critically, removes itself from the queue so the
   * eventual release does not hand the slot to a caller that is no longer there
   * (which would pin `busy` true for the life of the process).
   */
  it('bounds a queue wait: gives up with FFMPEG_BUSY and leaves the queue consistent', async () => {
    jest.useFakeTimers();
    process.env.FFMPEG_MAX_SECONDS = '1000'; // process watchdog far beyond the wait ceiling
    process.env.FFMPEG_JOB_MAX_SECONDS = '10';
    try {
      const first = fakeChild();
      spawnMock.mockReturnValue(first);
      const svc = new FfmpegRunnerService();
      const run1 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' }); // holds the slot
      await flush();
      const run2 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' }).catch((e) => e); // queued
      await flush();
      jest.advanceTimersByTime(10_001);
      expect(await run2).toMatchObject({ code: 'FFMPEG_BUSY' });

      // The holder finishes: the slot must go free, not to the departed waiter.
      first.emit('close', 0);
      await run1;
      await flush();
      const second = fakeChild();
      spawnMock.mockReturnValue(second);
      const run3 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' });
      await flush();
      expect(spawnMock).toHaveBeenCalledTimes(2); // run3 got the slot immediately
      second.emit('close', 0);
      await run3;
    } finally {
      delete process.env.FFMPEG_MAX_SECONDS;
      delete process.env.FFMPEG_JOB_MAX_SECONDS;
      jest.useRealTimers();
    }
  });

  /**
   * #669 item 2: self-heal beyond the watchdog-escalation path. A slot held
   * longer than any run can legitimately take belongs to a caller that is gone;
   * the next acquirer reclaims it instead of queueing behind a corpse.
   */
  it('reclaims a slot held past the ceiling instead of queueing behind it', async () => {
    const svc = new FfmpegRunnerService();
    const internals = svc as never as { holder: { token: number; since: number } | null };
    internals.holder = { token: 1, since: Date.now() - 24 * 60 * 60 * 1000 }; // held for a day
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const done = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' });
    await flush();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    child.emit('close', 0);
    await expect(done).resolves.toMatchObject({ stdout: '' });
    expect(internals.holder).toBeNull(); // reclaimed, used, then released cleanly
  });

  it('reclaiming hands the freed slot to the caller that queued first', async () => {
    const svc = new FfmpegRunnerService();
    const internals = svc as never as { holder: { token: number; since: number } | null };
    internals.holder = { token: 1, since: Date.now() }; // a live run holds the slot
    const queued = fakeChild();
    spawnMock.mockReturnValue(queued);
    const runQueued = svc.run({ binary: 'ffmpeg', args: ['queued'], cwd: '/tmp' });
    await flush();
    expect(spawnMock).not.toHaveBeenCalled(); // parked behind the holder

    internals.holder!.since = Date.now() - 24 * 60 * 60 * 1000; // the holder goes wedged
    const runLater = svc.run({ binary: 'ffmpeg', args: ['later'], cwd: '/tmp' });
    await flush();
    // The reclaimed slot goes to the waiter, not to whoever noticed the wedge.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][1]).toContain('queued');

    const second = fakeChild();
    spawnMock.mockReturnValue(second);
    queued.emit('close', 0);
    await runQueued;
    await flush();
    expect(spawnMock.mock.calls[1][1]).toContain('later');
    second.emit('close', 0);
    await runLater;
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

  it('readCgroupLimitBytes parses cgroup v2/v1 formats', async () => {
    const svc = new FfmpegRunnerService();
    const call = () =>
      (
        svc as never as { readCgroupLimitBytes: () => Promise<number | null> }
      ).readCgroupLimitBytes();

    fsReadFile.mockReset().mockResolvedValueOnce('max\n'); // v2 unlimited
    await expect(call()).resolves.toBeNull();

    fsReadFile.mockReset().mockResolvedValueOnce('9223372036854771712\n'); // v1 unlimited sentinel
    await expect(call()).resolves.toBeNull();

    fsReadFile.mockReset().mockResolvedValueOnce('536870912\n'); // v2 present, a real limit
    await expect(call()).resolves.toBe(536870912);

    fsReadFile
      .mockReset()
      .mockRejectedValueOnce(enoent()) // v2 file missing
      .mockResolvedValueOnce('268435456\n'); // v1 file present
    await expect(call()).resolves.toBe(268435456);

    fsReadFile.mockReset().mockRejectedValue(enoent()); // neither readable (bare host)
    await expect(call()).resolves.toBeNull();
  });

  it('assertMemoryHeadroom refuses tight headroom and allows comfortable headroom', async () => {
    process.env.FFMPEG_MEMORY_MB = '1'; // tiny footprint so the arithmetic is deterministic against real rss
    try {
      const svc = new FfmpegRunnerService();
      const assertHeadroom = () =>
        (svc as never as { assertMemoryHeadroom: () => Promise<void> }).assertMemoryHeadroom();
      const rss = process.memoryUsage().rss;

      // limit − rss (~1MB) < memoryMb(1) + headroom(128) MB needed → refuse
      fsReadFile.mockReset().mockResolvedValueOnce(String(rss + 1024 * 1024));
      await expect(assertHeadroom()).rejects.toMatchObject({ code: 'FFMPEG_INSUFFICIENT_MEMORY' });

      // limit − rss (~1GB) comfortably clears the ~129MB needed → no throw
      fsReadFile.mockReset().mockResolvedValueOnce(String(rss + 1024 * 1024 * 1024));
      await expect(assertHeadroom()).resolves.toBeUndefined();
    } finally {
      delete process.env.FFMPEG_MEMORY_MB;
    }
  });
});
