import {
  buildEnvelope,
  envelopeMaxSeconds,
  insertReconnectFlags,
  signedUrlTtlSeconds,
  STREAM_INPUTS_MIN_WORKER_PROTOCOL,
  workerSupportsStreamInputs,
} from './envelope';
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

describe('streamed inputs (#796)', () => {
  const streamJob = () => ({
    id: 's2',
    commands: [
      {
        id: 'slice',
        kind: 'ffmpeg' as const,
        argv: ['-ss', '1', '-copyts', '-i', '{in:in.mov}', '-to', '4', '{out:clip.mp4}'],
      },
      // Reads a local output as input — never gets reconnect flags.
      { id: 'wav', kind: 'ffmpeg' as const, argv: ['-i', '{out:clip.mp4}', '{out:clip.wav}'] },
      // A second, NOT streamed input in the same argv keeps its -i bare.
      {
        id: 'mix',
        kind: 'ffmpeg' as const,
        argv: ['-i', '{in:logo.png}', '-i', '{in:in.mov}', '{out:mix.mp4}'],
      },
      // ffprobe's positional input has no -i to precede: left alone.
      { id: 'p', kind: 'ffprobe' as const, argv: ['-show_format', '{in:in.mov}'] },
    ],
    inputs: [
      { name: 'in.mov', key: 'o/r/uploads/big.mov', stream: true as const },
      { name: 'logo.png', key: 'o/r/uploads/logo.png' },
    ],
    outputs: [
      { name: 'clip.mp4', key: 'o/r/uploads/c.mp4', contentType: 'video/mp4' },
      { name: 'clip.wav', key: 'o/r/uploads/c.wav', contentType: 'audio/wav' },
      { name: 'mix.mp4', key: 'o/r/uploads/m.mp4', contentType: 'video/mp4' },
    ],
    files: [],
  });
  const reconnect = [
    '-reconnect',
    '1',
    '-reconnect_on_network_error',
    '1',
    '-reconnect_delay_max',
    '5',
  ];

  it('marks only stream-hinted inputs and inserts reconnect flags right before their -i', async () => {
    const envelope = await buildEnvelope(streamJob(), urls, env, { streamInputs: true });
    expect(envelope.inputs).toEqual([
      { name: 'in.mov', url: 'https://b/get/o/r/uploads/big.mov?ttl=3600', stream: true },
      { name: 'logo.png', url: 'https://b/get/o/r/uploads/logo.png?ttl=3600' },
    ]);
    const argv = Object.fromEntries(envelope.commands.map((c) => [c.id, c.argv]));
    expect(argv.slice).toEqual([
      '-nostdin',
      '-hide_banner',
      '-y',
      '-ss',
      '1',
      '-copyts',
      ...reconnect,
      '-i',
      '{in:in.mov}',
      '-to',
      '4',
      '{out:clip.mp4}',
    ]);
    expect(argv.wav).toEqual([
      '-nostdin',
      '-hide_banner',
      '-y',
      '-i',
      '{out:clip.mp4}',
      '{out:clip.wav}',
    ]);
    expect(argv.mix).toEqual([
      '-nostdin',
      '-hide_banner',
      '-y',
      '-i',
      '{in:logo.png}',
      ...reconnect,
      '-i',
      '{in:in.mov}',
      '{out:mix.mp4}',
    ]);
    expect(argv.p).toEqual(['-hide_banner', '-show_format', '{in:in.mov}']);
  });

  it('without streamInputs (an older Worker) nothing is marked and argv is untouched', async () => {
    for (const opts of [undefined, { streamInputs: false }]) {
      const envelope = await buildEnvelope(streamJob(), urls, env, opts);
      expect(envelope.inputs.every((i) => !('stream' in i))).toBe(true);
      expect(envelope.commands.flatMap((c) => c.argv)).not.toContain('-reconnect');
      expect(envelope.commands[0].argv).toEqual([
        '-nostdin',
        '-hide_banner',
        '-y',
        ...streamJob().commands[0].argv,
      ]);
    }
  });

  it('workerSupportsStreamInputs: protocol >= 2 only; absent / old / unknown health is "no"', () => {
    expect(STREAM_INPUTS_MIN_WORKER_PROTOCOL).toBe(2);
    expect(workerSupportsStreamInputs({ protocol: 2 })).toBe(true);
    expect(workerSupportsStreamInputs({ protocol: 3 })).toBe(true);
    expect(workerSupportsStreamInputs({ protocol: 1 })).toBe(false);
    expect(workerSupportsStreamInputs({})).toBe(false);
    expect(workerSupportsStreamInputs(undefined)).toBe(false);
  });

  it('insertReconnectFlags is a no-op for an empty set and never matches a non-whole token', () => {
    const argv = ['-i', '{in:a.mov}'];
    expect(insertReconnectFlags(argv, new Set())).toBe(argv);
    expect(insertReconnectFlags(['-i', 'x{in:a.mov}'], new Set(['a.mov']))).toEqual([
      '-i',
      'x{in:a.mov}',
    ]);
  });
});
