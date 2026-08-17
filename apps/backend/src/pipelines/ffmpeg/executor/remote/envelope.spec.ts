import { buildEnvelope, envelopeMaxSeconds, signedUrlTtlSeconds } from './envelope';
import { readFfmpegEnv } from '../../ffmpeg-env';

const urls = {
  getUrl: jest.fn(async (k: string, ttl: number) => `https://b/get/${k}?ttl=${ttl}`),
  putUrl: jest.fn(
    async (k: string, ttl: number, max: number) => `https://b/put/${k}?ttl=${ttl}&max=${max}`,
  ),
};
const env = readFfmpegEnv({
  FFMPEG_MAX_SECONDS: '1800',
  FFMPEG_JOB_MAX_SECONDS: '3600',
  FFMPEG_MAX_OUTPUT_BYTES: '4096',
});

it('TTL is max(jobMaxSeconds, 900) and maxSeconds is min(maxSeconds, jobMax-60)', () => {
  expect(signedUrlTtlSeconds({ jobMaxSeconds: 120 })).toBe(900);
  expect(signedUrlTtlSeconds({ jobMaxSeconds: 3600 })).toBe(3600);
  expect(envelopeMaxSeconds({ maxSeconds: 1800, jobMaxSeconds: 3600 })).toBe(1800);
  expect(envelopeMaxSeconds({ maxSeconds: 1800, jobMaxSeconds: 1000 })).toBe(940);
  expect(envelopeMaxSeconds({ maxSeconds: 30, jobMaxSeconds: 30 })).toBe(60); // floor
});

it('signs every input/output, prepends per-kind global flags, keeps placeholders verbatim', async () => {
  const envelope = await buildEnvelope(
    {
      id: 's1',
      commands: [
        { id: 'a', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] },
        { id: 'p', kind: 'ffprobe', argv: ['-show_format', '{in:in.mp4}'], timeoutSeconds: 60 },
      ],
      inputs: [{ name: 'in.mp4', key: 'o/r/uploads/a.mp4' }],
      outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', contentType: 'audio/wav' }],
      files: [{ name: 'list.txt', content: 'x' }],
    },
    urls,
    env,
  );
  expect(envelope).toEqual({
    v: 1,
    id: 's1',
    commands: [
      {
        id: 'a',
        kind: 'ffmpeg',
        argv: ['-nostdin', '-hide_banner', '-y', '-i', '{in:in.mp4}', '{out:out.wav}'],
      },
      {
        id: 'p',
        kind: 'ffprobe',
        argv: ['-hide_banner', '-show_format', '{in:in.mp4}'],
        timeoutSeconds: 60,
      },
    ],
    inputs: [{ name: 'in.mp4', url: 'https://b/get/o/r/uploads/a.mp4?ttl=3600' }],
    outputs: [
      {
        name: 'out.wav',
        url: 'https://b/put/o/r/uploads/a.wav?ttl=3600&max=4096',
        contentType: 'audio/wav',
      },
    ],
    files: [{ name: 'list.txt', content: 'x' }],
    maxSeconds: 1800,
    limits: { maxOutputBytes: 4096 },
  });
});
