import {
  buildConcatArgs,
  buildConcatListContent,
  buildExtractAudioArgs,
  buildFrameArgs,
  buildProbeArgs,
  buildSliceArgs,
  buildTileArgs,
  clockLabel,
  planContactSheet,
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

describe('buildFrameArgs', () => {
  it('fast-seeks to the time and writes one labelled jpeg', () => {
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'frame-01.jpg',
      time: 83.5,
      height: 720,
      quality: 3,
      label: '1:23',
    });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(argAfter(args, '-ss')).toBe('83.5');
    expect(argAfter(args, '-frames:v')).toBe('1');
    expect(argAfter(args, '-vf')).toContain('scale=-2:720');
    expect(argAfter(args, '-vf')).toContain("drawtext=text='1\\:23'");
    expect(args[args.length - 1]).toBe('frame-01.jpg');
  });

  it('omits drawtext without a label', () => {
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'frame-01.jpg',
      time: 10,
      height: 480,
      quality: 5,
    });
    expect(argAfter(args, '-vf')).not.toContain('drawtext');
  });

  it('escapes backslash, colon, and single-quote in the label (filter-injection fence)', () => {
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'out.jpg',
      time: 1,
      height: 480,
      quality: 3,
      label: "a'b:c\\d",
    });
    expect(argAfter(args, '-vf')).toContain("drawtext=text='a\\'b\\:c\\\\d'");
  });
});

describe('buildTileArgs', () => {
  it('tiles a numbered sequence into one sheet', () => {
    expect(
      buildTileArgs({
        pattern: 'cell-%03d.jpg',
        start: 1,
        count: 9,
        columns: 3,
        output: 'sheet-01.jpg',
      }),
    ).toEqual([
      '-start_number',
      '1',
      '-i',
      'cell-%03d.jpg',
      '-frames:v',
      '1',
      '-vf',
      'tile=3x3:padding=2:margin=2:color=0x111111',
      '-q:v',
      '3',
      'sheet-01.jpg',
    ]);
  });

  it('rows grow to fit a short last sheet', () => {
    expect(
      buildTileArgs({
        pattern: 'cell-%03d.jpg',
        start: 13,
        count: 4,
        columns: 3,
        output: 'sheet-02.jpg',
      }),
    ).toEqual([
      '-start_number',
      '13',
      '-i',
      'cell-%03d.jpg',
      '-frames:v',
      '1',
      '-vf',
      'tile=3x2:padding=2:margin=2:color=0x111111',
      '-q:v',
      '3',
      'sheet-02.jpg',
    ]);
  });
});

describe('planContactSheet (port of Studio contactSheet.ts, Ruling R74)', () => {
  it('a 600s clip at default density hits the frame budget with 10 full sheets', () => {
    const plan = planContactSheet(600);
    expect(plan.interval).toBe(5);
    expect(plan.times).toHaveLength(120);
    expect(plan.perSheet).toBe(12);
    expect(plan.sheets).toHaveLength(10);
    for (const sheet of plan.sheets) {
      expect(sheet.cols).toBe(3);
      expect(sheet.rows).toBe(4);
    }
    expect(plan.sheets[0].start).toBe(1);
    expect(plan.sheets[1].start).toBe(13);
    expect(plan.sheets.reduce((sum, s) => sum + s.count, 0)).toBe(120);
  });

  it('a SHORT clip samples densely into one small sheet', () => {
    const plan = planContactSheet(10);
    expect(plan.times).toHaveLength(2);
    expect(plan.sheets).toHaveLength(1);
    expect(plan.sheets[0].cols).toBe(2);
    expect(plan.sheets[0].rows).toBe(1);
    for (const t of plan.times) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(10);
    }
  });

  it('a LONG clip is capped by the frame budget and the interval widens past MAX_INTERVAL_SECONDS', () => {
    const plan = planContactSheet(7200);
    expect(plan.times).toHaveLength(120);
    expect(plan.interval).toBe(60);
  });

  it('duration <= 0 or non-finite yields the empty plan', () => {
    expect(planContactSheet(0)).toEqual({ interval: 0, times: [], perSheet: 0, sheets: [] });
    expect(planContactSheet(NaN)).toEqual({ interval: 0, times: [], perSheet: 0, sheets: [] });
  });

  it('minInterval override samples scene-dense (Studio planSceneContactSheet density)', () => {
    const plan = planContactSheet(120, { minInterval: 1 });
    expect(plan.times).toHaveLength(120);
  });

  it('maxSheets/cellsPerSheet overrides shrink the budget', () => {
    const plan = planContactSheet(600, { maxSheets: 2, cellsPerSheet: 4 });
    expect(plan.times).toHaveLength(8);
    expect(plan.sheets).toHaveLength(2);
    expect(plan.perSheet).toBe(4);
  });

  it('columns override changes sheet grid width', () => {
    const plan = planContactSheet(600, { maxSheets: 2, cellsPerSheet: 4, columns: 2 });
    expect(plan.sheets[0].cols).toBe(2);
  });

  it('every time is inside the clip and the last one respects the -0.05 clamp', () => {
    const plan = planContactSheet(600);
    for (const t of plan.times) {
      expect(t).toBeLessThan(600);
    }
    expect(plan.times[plan.times.length - 1]).toBeLessThanOrEqual(600 - 0.05);
  });
});

describe('clockLabel', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [83.5, '1:23'],
    [3661, '1:01:01'],
    [-1, '0:00'],
    [NaN, '0:00'],
  ])('%s -> %s', (seconds, expected) => {
    expect(clockLabel(seconds)).toBe(expected);
  });
});
