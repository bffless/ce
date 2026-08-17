import { withDeadline } from './with-deadline';

describe('withDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes the value through when the work settles before the deadline', async () => {
    const onTimeout = jest.fn();
    await expect(withDeadline(Promise.resolve('ok'), 5, 'download', onTimeout)).resolves.toBe('ok');
    jest.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    // The timer is cleared, so nothing is left pending to keep the process alive.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with FFMPEG_JOB_TIMEOUT naming the phase, and calls onTimeout once', async () => {
    const onTimeout = jest.fn();
    // A stalled await that never settles — the failure mode #669 is about.
    const raced = withDeadline(new Promise<never>(() => {}), 5, 'download of a.mp4', onTimeout);
    jest.advanceTimersByTime(5001);
    await expect(raced).rejects.toMatchObject({
      code: 'FFMPEG_JOB_TIMEOUT',
      message: 'ffmpeg_handler download of a.mp4 exceeded 5s and was abandoned',
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('swallows a late rejection from the abandoned work (no unhandled rejection)', async () => {
    let fail: (error: Error) => void = () => undefined;
    const work = new Promise<never>((_, reject) => {
      fail = reject;
    });
    const raced = withDeadline(work, 5, 'upload');
    jest.advanceTimersByTime(5001);
    await expect(raced).rejects.toMatchObject({ code: 'FFMPEG_JOB_TIMEOUT' });
    fail(new Error('late boom'));
    await expect(work).rejects.toThrow('late boom');
  });
});
