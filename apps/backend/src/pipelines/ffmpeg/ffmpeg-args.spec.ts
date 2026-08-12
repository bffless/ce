import {
  buildConcatArgs,
  buildConcatListContent,
  buildExtractAudioArgs,
  buildProbeArgs,
  buildSliceArgs,
} from './ffmpeg-args';

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('buildExtractAudioArgs', () => {
  it('is the 16kHz mono WAV transcription contract', () => {
    expect(buildExtractAudioArgs('in.mp4', 'out.wav')).toEqual([
      '-i',
      'in.mp4',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'wav',
      'out.wav',
    ]);
  });
});

describe('buildSliceArgs — single span (fast-seek cut, port of slice.ts)', () => {
  const args = buildSliceArgs({
    input: 'src.mp4',
    output: 'clip.mp4',
    spans: [{ start: 104, end: 228 }],
    threads: 2,
  });

  it('fast-seeks before -i and keeps absolute timestamps', () => {
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(argAfter(args, '-ss')).toBe('104');
    expect(args).toContain('-copyts');
    expect(argAfter(args, '-to')).toBe('228');
    expect(args.indexOf('-to')).toBeGreaterThan(args.indexOf('-i'));
  });

  it('trims both streams against one shared origin (A/V sync)', () => {
    const graph = argAfter(args, '-filter_complex');
    expect(graph).toContain('[0:v]trim=104:228,setpts=PTS-104/TB[v0]');
    expect(graph).toContain('[0:a]atrim=104:228,asetpts=PTS-104/TB[a0]');
  });

  it('keeps the wasm-proven encode profile and fps passthrough', () => {
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('ultrafast');
    expect(argAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(argAfter(args, '-c:a')).toBe('aac');
    expect(argAfter(args, '-fps_mode')).toBe('passthrough');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
    expect(argAfter(args, '-threads')).toBe('2');
    expect(args[args.length - 1]).toBe('clip.mp4');
  });

  it('clamps degenerate spans (start<0, end<start)', () => {
    const a = buildSliceArgs({
      input: 's',
      output: 'o',
      spans: [{ start: -2, end: -1 }],
      threads: 1,
    });
    expect(argAfter(a, '-ss')).toBe('0');
  });
});

describe('buildSliceArgs — multi-span (assemble, port of assemble.ts)', () => {
  const spans = [
    { start: 0, end: 2 },
    { start: 5, end: 8.5 },
  ];
  const args = buildSliceArgs({
    input: 'clip.mp4',
    output: 'out.mp4',
    spans,
    threads: 2,
    audioFades: true,
  });
  const graph = argAfter(args, '-filter_complex');

  it('does NOT fast-seek (whole input feeds the graph)', () => {
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-copyts');
  });

  it('emits per-span shared-origin trims and an interleaved concat', () => {
    expect(graph).toContain('[0:v]trim=0:2,setpts=PTS-0/TB[v0]');
    expect(graph).toContain('[0:v]trim=5:8.5,setpts=PTS-5/TB[v1]');
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]');
  });

  it('audioFades adds ~10ms edge fades anchored per piece', () => {
    expect(graph).toContain('afade=t=in:st=0:d=0.01');
    expect(graph).toContain(`afade=t=out:st=${3.5 - 0.01}`);
  });

  it('omits fades when audioFades is false/undefined', () => {
    const noFade = buildSliceArgs({ input: 'c', output: 'o', spans, threads: 1 });
    expect(argAfter(noFade, '-filter_complex')).not.toContain('afade');
  });
});

describe('buildConcatArgs / buildConcatListContent', () => {
  it('stream-copies via the concat demuxer with regenerated PTS', () => {
    expect(buildConcatArgs('list.txt', 'final.mp4', { reencode: false, threads: 2 })).toEqual([
      '-f',
      'concat',
      '-safe',
      '0',
      '-fflags',
      '+genpts',
      '-i',
      'list.txt',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      'final.mp4',
    ]);
  });

  it('re-encode fallback swaps -c copy for the shared encode profile', () => {
    const args = buildConcatArgs('list.txt', 'final.mp4', { reencode: true, threads: 2 });
    expect(args).not.toContain('copy');
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('ultrafast');
    expect(argAfter(args, '-c:a')).toBe('aac');
  });

  it('list content is one file directive per part', () => {
    expect(buildConcatListContent(['a.mp4', 'b.mp4'])).toBe("file 'a.mp4'\nfile 'b.mp4'\n");
  });

  it('rejects paths containing single quotes (list-file injection)', () => {
    expect(() => buildConcatListContent(["evil'.mp4"])).toThrow();
  });
});

describe('buildProbeArgs', () => {
  it('asks ffprobe for json format+streams', () => {
    expect(buildProbeArgs('in.mp4')).toEqual([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      'in.mp4',
    ]);
  });
});
