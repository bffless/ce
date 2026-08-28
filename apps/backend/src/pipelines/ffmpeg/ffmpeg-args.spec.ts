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
  it('fast-seeks to the time, scales, and writes one jpeg (no label)', () => {
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'frame-01.jpg',
      time: 83.5,
      height: 720,
      quality: 3,
    });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(argAfter(args, '-ss')).toBe('83.5');
    expect(argAfter(args, '-frames:v')).toBe('1');
    expect(argAfter(args, '-vf')).toBe('scale=-2:720');
    expect(argAfter(args, '-q:v')).toBe('3');
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

  it('carries expansion=none so drawtext cannot do its own post-parse %{...} expansion on the label', () => {
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: '1:23',
    });
    expect(argAfter(args, '-vf')).toContain('expansion=none');
  });

  // --- filter-injection fence (C1) ---------------------------------------
  //
  // Each case below is a hostile `label`. The expected `-vf` string is not
  // asserted by string-shape guesswork: it was generated by running the
  // SAME escaping this file ships against ffmpeg 7.0.2's real avfilter
  // option parser (via `-v debug`, reading its own `Setting 'm1' to value
  // '<value>'` trace against `drawgraph` — the same generic string-option
  // parser drawtext's `text` uses, since this box's ffmpeg build has no
  // drawtext) and confirming the parsed value round-trips to the raw label
  // byte-for-byte, with a trailing option (`m2='MARKER'`) proven to survive
  // untouched. See task 17a fix report (round 1, C1) for the full command
  // transcripts. What's asserted here is the argv our builder produces;
  // the comment on each case states what ffmpeg's parser does with it.
  it('round-trips a real clock label unchanged (baseline)', () => {
    // parser reads text back as exactly "1:23"
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: '1:23',
    });
    expect(args).toEqual([
      '-ss',
      '1',
      '-i',
      'in.mp4',
      '-frames:v',
      '1',
      '-vf',
      'scale=-2:720,drawtext=text=1\\\\\\:23:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16',
      '-q:v',
      '3',
      'o.jpg',
    ]);
  });

  it('round-trips a bare apostrophe — does NOT truncate or corrupt the text', () => {
    // parser reads text back as exactly "A'B"; the classic shell-style 'a'\''b'
    // requote trick FAILS under this parser (reads back as "ab") and was rejected
    // for that reason — see the fix report.
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: "A'B",
    });
    expect(argAfter(args, '-vf')).toBe(
      "scale=-2:720,drawtext=text=A\\\\\\'B:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16",
    );
  });

  it('round-trips two apostrophes in one label', () => {
    // parser reads text back as exactly "A'B'C"
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: "A'B'C",
    });
    expect(argAfter(args, '-vf')).toBe(
      "scale=-2:720,drawtext=text=A\\\\\\'B\\\\\\'C:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16",
    );
  });

  it("round-trips the brief's original quote+colon+backslash label", () => {
    // parser reads text back as exactly "a'b:c\d" — the plan's original single-level
    // \: \' escaping truncated this at the colon; this does not.
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: "a'b:c\\d",
    });
    expect(argAfter(args, '-vf')).toBe(
      "scale=-2:720,drawtext=text=a\\\\\\'b\\\\\\:c\\\\\\\\d:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16",
    );
  });

  it('does not let a colon in the label inject a fontsize option', () => {
    // parser reads text back as exactly "A'B:fontsize=200" — the `:fontsize=200`
    // stays INSIDE the text value; the real `:fontsize=h/12` that follows in the
    // template is untouched (proven with a trailing marker option, see report).
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: "A'B:fontsize=200",
    });
    expect(argAfter(args, '-vf')).toBe(
      "scale=-2:720,drawtext=text=A\\\\\\'B\\\\\\:fontsize=200:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16",
    );
  });

  it('does not let a comma in the label inject a chained filter', () => {
    // parser reads text back as exactly "A'B,hflip" — no second "hflip" filter
    // instance is ever created; the comma stays inside the text value.
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: "A'B,hflip",
    });
    expect(argAfter(args, '-vf')).toBe(
      "scale=-2:720,drawtext=text=A\\\\\\'B\\\\\\,hflip:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16",
    );
  });

  it('does not let a crafted label read an arbitrary local file via textfile=', () => {
    // parser reads text back as exactly "x':textfile=/etc/passwd:y='" — drawtext
    // never sees a `textfile=` OPTION (only this literal text content), so it can't
    // render /etc/passwd into the output jpeg.
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: "x':textfile=/etc/passwd:y='",
    });
    expect(argAfter(args, '-vf')).toBe(
      "scale=-2:720,drawtext=text=x\\\\\\'\\\\\\:textfile=/etc/passwd\\\\\\:y=\\\\\\':expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16",
    );
  });

  it('round-trips brackets, semicolon, and percent unchanged', () => {
    // parser reads text back as exactly "A[B];C%D" — brackets/semicolon (graph-level
    // link-label/chain syntax) stay inert; `%` needs no escaping here at all (it is
    // not special to avfilter's parser — drawtext's OWN %{...} expansion is the
    // separate mechanism `expansion=none` closes, not this escaping).
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: 'A[B];C%D',
    });
    expect(argAfter(args, '-vf')).toBe(
      'scale=-2:720,drawtext=text=A\\\\\\[B\\\\\\]\\\\\\;C%D:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16',
    );
  });

  it('round-trips a trailing backslash without eating the closing option', () => {
    // parser reads text back as exactly "A\" (one trailing backslash)
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'o.jpg',
      time: 1,
      height: 720,
      quality: 3,
      label: 'A\\',
    });
    expect(argAfter(args, '-vf')).toBe(
      'scale=-2:720,drawtext=text=A\\\\\\\\:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16',
    );
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
      'trim=end_frame=9,tile=3x3:padding=2:margin=2:color=0x111111',
      '-q:v',
      '3',
      'sheet-01.jpg',
    ]);
  });

  it('rows grow to fit a short sheet, and the trim stops tile reading into the NEXT sheet', () => {
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
      'trim=end_frame=4,tile=3x2:padding=2:margin=2:color=0x111111',
      '-q:v',
      '3',
      'sheet-02.jpg',
    ]);
  });

  it('clamps columns:0 to 1 rather than emitting an infinite row count', () => {
    const args = buildTileArgs({
      pattern: 'cell-%03d.jpg',
      start: 1,
      count: 4,
      columns: 0,
      output: 'sheet.jpg',
    });
    expect(argAfter(args, '-vf')).toBe(
      'trim=end_frame=4,tile=1x4:padding=2:margin=2:color=0x111111',
    );
  });

  it('clamps count:0 to 1 rather than emitting a zero row count', () => {
    const args = buildTileArgs({
      pattern: 'cell-%03d.jpg',
      start: 1,
      count: 0,
      columns: 3,
      output: 'sheet.jpg',
    });
    expect(argAfter(args, '-vf')).toBe(
      'trim=end_frame=1,tile=3x1:padding=2:margin=2:color=0x111111',
    );
  });

  /**
   * The regression this pins is silent: `tile` only emits once it has C×R
   * frames and `image2` keeps reading past `count` into the next sheet's
   * cells, so a non-final short sheet renders the WRONG frames while its
   * reported `times` say otherwise. Verified against real ffmpeg 7.0.2 (see
   * buildTileArgs' TSDoc): without this clause slots 11-12 of a
   * `start 1, count 10, tile=3x4` sheet were cells 11 and 12.
   */
  it('trims to exactly `count` frames, on every sheet shape', () => {
    const vf = (count: number, columns: number) =>
      argAfter(
        buildTileArgs({ pattern: 'cell-%03d.jpg', start: 1, count, columns, output: 's.jpg' }),
        '-vf',
      );
    // Non-final short sheet: 10 cells on a 3-wide grid needs 12 slots — the two
    // spare ones must be padding, not the next sheet's first two cells.
    expect(vf(10, 3)).toBe('trim=end_frame=10,tile=3x4:padding=2:margin=2:color=0x111111');
    // A full sheet trims to its own size — the clause is unconditional so no
    // caller has to know which sheets are "safe".
    expect(vf(12, 3)).toBe('trim=end_frame=12,tile=3x4:padding=2:margin=2:color=0x111111');
    // An exact-grid sheet (2 cells, cols 2) has no spare slot at all.
    expect(vf(2, 2)).toBe('trim=end_frame=2,tile=2x1:padding=2:margin=2:color=0x111111');
    // The clamped count is what gets trimmed, never the raw one.
    expect(vf(0, 3)).toBe('trim=end_frame=1,tile=3x1:padding=2:margin=2:color=0x111111');
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

  it('the -0.05 clamp actually engages on a short clip sampled very densely', () => {
    // duration=1, minInterval=0.001 -> dense=1000, budget-capped to 120 frames;
    // uncapped last bucket centre would be (119.5/120) ≈ 0.9958, clamped to 0.95.
    const plan = planContactSheet(1, { minInterval: 0.001 });
    expect(plan.times[plan.times.length - 1]).toBe(0.95);
  });

  it('pins the (i + 0.5) bucket-centring formula, not just times.length', () => {
    const plan = planContactSheet(600);
    expect(plan.times.slice(0, 3)).toEqual([2.5, 7.5, 12.5]);
  });

  it('MAX_INTERVAL_SECONDS is a fixed coverage floor minInterval cannot loosen past (M9)', () => {
    // Requesting minInterval:60 (a looser density) still samples every 30s (20
    // frames), not every 60s (10 frames), because the 30s coverage floor demands
    // more frames than the requested density does and coverage always wins.
    const plan = planContactSheet(600, { minInterval: 60 });
    expect(plan.interval).toBe(30);
    expect(plan.times).toHaveLength(20);
  });

  it('minInterval: NaN falls back to the default density instead of cascading NaN (I2)', () => {
    const withNaN = planContactSheet(600, { minInterval: NaN });
    const withDefault = planContactSheet(600);
    expect(withNaN).toEqual(withDefault);
  });

  it('a negative minInterval falls back to the default density instead of widening (I2)', () => {
    const withNegative = planContactSheet(600, { minInterval: -5 });
    const withDefault = planContactSheet(600);
    expect(withNegative).toEqual(withDefault);
  });

  it('columns:0 falls back to the default rather than producing cols:0/rows:Infinity (I3)', () => {
    const plan = planContactSheet(600, { columns: 0 });
    for (const sheet of plan.sheets) {
      expect(sheet.cols).toBeGreaterThan(0);
      expect(Number.isFinite(sheet.rows)).toBe(true);
    }
    expect(plan).toEqual(planContactSheet(600));
  });

  it('maxSheets:0 falls back to the default rather than producing an Infinity interval (I3)', () => {
    const plan = planContactSheet(600, { maxSheets: 0 });
    expect(Number.isFinite(plan.interval)).toBe(true);
    expect(plan).toEqual(planContactSheet(600));
  });

  it('cellsPerSheet:0 falls back to the default rather than producing an Infinity interval (I3)', () => {
    const plan = planContactSheet(600, { cellsPerSheet: 0 });
    expect(Number.isFinite(plan.interval)).toBe(true);
    expect(plan).toEqual(planContactSheet(600));
  });

  it('a negative maxSheets falls back to the default (I3)', () => {
    const plan = planContactSheet(600, { maxSheets: -2 });
    expect(plan).toEqual(planContactSheet(600));
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
