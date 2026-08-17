import { mapWorkerResponse, isWorkerResponse } from './result-mapping';
import type { FfmpegJob } from '../ffmpeg-executor.interface';

const job: FfmpegJob = {
  id: 'j',
  commands: [],
  inputs: [],
  outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', contentType: 'audio/wav' }],
  files: [],
};
const okRes = {
  v: 1 as const,
  ok: true,
  commands: [{ id: 'a', ran: true, exitCode: 0 }],
  stdout: '{}',
  stderrTail: '',
  outputs: [{ name: 'out.wav', bytes: 12 }],
  bytesIn: 100,
  bytesOut: 12,
  timings: { transferInMs: 1, ffmpegMs: 2, transferOutMs: 3, totalMs: 6 },
  worker: { version: '0.4.31', ffmpeg: '6.1.1' },
};

it('maps a successful response, joining output keys back from the job', () => {
  expect(mapWorkerResponse(okRes, job)).toEqual({
    executor: 'remote',
    stdout: '{}',
    stderrTail: '',
    commands: okRes.commands,
    outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', bytes: 12 }],
    bytesIn: 100,
    bytesOut: 12,
    timings: { queueMs: 0, transferInMs: 1, ffmpegMs: 2, transferOutMs: 3, totalMs: 6 },
    worker: { version: '0.4.31', ffmpeg: '6.1.1' },
  });
});
it.each([
  ['FFMPEG_FAILED', 'FFMPEG_FAILED'],
  ['FFMPEG_TIMEOUT', 'FFMPEG_TIMEOUT'],
  ['INPUT_FETCH_FAILED', 'FILE_NOT_FOUND'],
  ['OUTPUT_UPLOAD_FAILED', 'FFMPEG_FAILED'],
  ['OUTPUT_TOO_LARGE', 'FFMPEG_FAILED'],
  ['BAD_REQUEST', 'FFMPEG_EXECUTOR_UNAVAILABLE'],
  ['CANCELLED', 'FFMPEG_EXECUTOR_UNAVAILABLE'],
])('worker code %s → CE code %s, keeping the worker message', (workerCode, ceCode) => {
  expect(() =>
    mapWorkerResponse(
      { ...okRes, ok: false, code: workerCode as never, message: 'why', stderrTail: 'tail' },
      job,
    ),
  ).toThrow(expect.objectContaining({ code: ceCode, message: expect.stringContaining('why') }));
});
it('FFMPEG_FAILED carries exitCode + stderrTail like FfmpegProcessError', () => {
  try {
    mapWorkerResponse(
      {
        ...okRes,
        ok: false,
        code: 'FFMPEG_FAILED',
        message: 'exit 1',
        commands: [{ id: 'a', ran: true, exitCode: 1 }],
        stderrTail: 'tail',
      },
      job,
    );
  } catch (e) {
    expect(e).toMatchObject({ code: 'FFMPEG_FAILED', exitCode: 1, stderrTail: 'tail' });
    return;
  }
  throw new Error('did not throw');
});
it('a successful response missing a declared output is FFMPEG_FAILED', () => {
  expect(() => mapWorkerResponse({ ...okRes, outputs: [] }, job)).toThrow(
    expect.objectContaining({ code: 'FFMPEG_FAILED' }),
  );
});
it('isWorkerResponse guards the shape', () => {
  expect(isWorkerResponse(okRes)).toBe(true);
  expect(isWorkerResponse({ ok: true })).toBe(false);
  expect(isWorkerResponse('nope')).toBe(false);
});
