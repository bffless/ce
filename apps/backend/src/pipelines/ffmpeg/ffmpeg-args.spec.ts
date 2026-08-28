import {
  buildConcatArgs,
  buildConcatListContent,
  buildExtractAudioArgs,
  buildFrameArgs,
  buildProbeArgs,
  buildSliceArgs,
  buildTileArgs,
} from './ffmpeg-args';
import type { FrameOverlay, OverlayPosition } from './ffmpeg-args';

/** Mirrors MIN_OVERLAY_SIZE in ffmpeg-args.ts — see the floor test below. */
const MIN_SIZE = 0.005;

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

describe('buildFrameArgs — no overlay', () => {
  it('fast-seeks to the time, scales, and writes one jpeg', () => {
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

  it('the filter chain is EXACTLY the scale — no drawtext at all', () => {
    const args = buildFrameArgs({
      input: 'in.mp4',
      output: 'frame-01.jpg',
      time: 10,
      height: 480,
      quality: 5,
    });
    expect(argAfter(args, '-vf')).toBe('scale=-2:480');
    expect(argAfter(args, '-vf')).not.toContain('drawtext');
  });
});

describe('buildFrameArgs — overlay defaults', () => {
  const vf = (overlay: FrameOverlay) =>
    argAfter(
      buildFrameArgs({
        input: 'in.mp4',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay,
      }),
      '-vf',
    );

  /**
   * The defaults must reproduce the visual result of the old hard-coded
   * filter (bottom-right, h/12, white, dark box). Only ONE token differs
   * from that string: `fontsize=h*0.08333333333333333` where it used to say
   * `fontsize=h/12`. That is a deliberate, MEASURED equivalence, not a
   * regression — `size` is a fraction so the general form has to be a
   * multiply, and ffmpeg 7.0.2's own expression evaluator returns the same
   * integer for both. Verified by feeding each form to the same av_expr
   * evaluator via `scale=w=320:h=<expr>` and reading the negotiated link
   * size back out of `-v verbose`: ih/12 and ih*0.08333333333333333 both
   * gave h:60 at 720, h:90 at 1080, h:40 at 480, h:41 at 500, h:42 at 505
   * and h:83 at 999 (see the task 17a' report for the transcripts), and
   * `Math.trunc(h/12) === Math.trunc(h*(1/12))` holds for every integer
   * height 1..10000 in IEEE-754 doubles, which is the arithmetic both
   * ffmpeg and this builder do.
   */
  it('reproduces the old hard-coded overlay, one measured-equivalent token aside', () => {
    expect(vf({ text: '1:23' })).toBe(
      'scale=-2:720,drawtext=text=1\\\\\\:23:expansion=none:fontsize=h*0.08333333333333333:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16',
    );
  });

  it('pins the filter option ORDER (text, expansion, fontsize, fontcolor, box trio, x, y)', () => {
    // 'hi' carries no comma, so the chain splits cleanly on the filter separator.
    const drawtext = vf({ text: 'hi' })
      .split(',')[1]
      .replace(/^drawtext=/, '');
    expect(drawtext.split(':').map((o) => o.split('=')[0])).toEqual([
      'text',
      'expansion',
      'fontsize',
      'fontcolor',
      'box',
      'boxcolor',
      'boxborderw',
      'x',
      'y',
    ]);
  });

  it('always carries expansion=none, closing drawtext own post-parse %{...} pass', () => {
    expect(vf({ text: 'A%{pts}B' })).toContain('expansion=none');
    // `%` is NOT escaped (it is not special to the avfilter parser); the
    // expansion=none option is what makes it inert. Proven against the real
    // parser: raw "A[B];C%D" reads back byte-identical.
    expect(vf({ text: 'A%{pts}B' })).toContain('text=A%{pts}B:');
  });
});

describe('buildFrameArgs — overlay position (enum, never a caller expression)', () => {
  const vf = (overlay: FrameOverlay) =>
    argAfter(
      buildFrameArgs({
        input: 'i',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay,
      }),
      '-vf',
    );

  it.each([
    ['top-left', 'x=16', 'y=16'],
    ['top-center', 'x=(w-tw)/2', 'y=16'],
    ['top-right', 'x=w-tw-16', 'y=16'],
    ['center', 'x=(w-tw)/2', 'y=(h-th)/2'],
    ['bottom-left', 'x=16', 'y=h-th-16'],
    ['bottom-center', 'x=(w-tw)/2', 'y=h-th-16'],
    ['bottom-right', 'x=w-tw-16', 'y=h-th-16'],
  ] as Array<[OverlayPosition, string, string]>)('%s -> %s / %s', (position, x, y) => {
    // Both expressions were run through ffmpeg 7.0.2's real option parser via
    // `drawbox` (which takes the same kind of x/y expression) and accepted:
    // parentheses and `/` are not avfilter metacharacters.
    const suffix = `:${x}:${y}`;
    expect(vf({ text: 'T', position }).slice(-suffix.length)).toBe(suffix);
  });

  it('defaults to bottom-right', () => {
    expect(vf({ text: 'T' })).toBe(vf({ text: 'T', position: 'bottom-right' }));
  });

  it('rejects an unknown position rather than emitting a malformed x=/y=', () => {
    expect(() => vf({ text: 'T', position: 'middle-ish' as OverlayPosition })).toThrow(/position/i);
    // The whole point of the enum: a caller must never be able to write into
    // the x=/y= fields, so a coordinate expression is not a position either.
    expect(() => vf({ text: 'T', position: 'w-tw-16' as OverlayPosition })).toThrow(/position/i);
  });

  /**
   * A bare `hasOwnProperty` lookup string-coerces its key, so `['top-left']`
   * used to resolve to the `'top-left'` row. Never dangerous — the coerced
   * key still has to name one of CE's own rows, so the emitted x=/y= was
   * always ours — but the enum is only genuinely closed if the value is a
   * string in the first place.
   */
  it.each([
    ['an array', ['top-left']],
    ['null', null],
    ['a number', 0],
    ['an object', {}],
  ])('rejects a position that is %s', (_label, position) => {
    expect(() => vf({ text: 'T', position: position as unknown as OverlayPosition })).toThrow(
      /position/i,
    );
  });
});

describe('buildFrameArgs — overlay background', () => {
  const vf = (overlay: FrameOverlay) =>
    argAfter(
      buildFrameArgs({ input: 'i', output: 'o.jpg', time: 1, height: 720, quality: 3, overlay }),
      '-vf',
    );

  it('background:false drops the whole box trio', () => {
    const s = vf({ text: 'T', background: false });
    expect(s).not.toContain('box=');
    expect(s).not.toContain('boxcolor=');
    expect(s).not.toContain('boxborderw=');
    expect(s).toBe(
      'scale=-2:720,drawtext=text=T:expansion=none:fontsize=h*0.08333333333333333:fontcolor=white:x=w-tw-16:y=h-th-16',
    );
  });

  it('background defaults to on, and background:true is the default', () => {
    expect(vf({ text: 'T' })).toContain(':box=1:boxcolor=black@0.6:boxborderw=8:');
    expect(vf({ text: 'T', background: true })).toBe(vf({ text: 'T' }));
  });

  /**
   * The string "false" is what YAML/JSON pipeline config actually delivers,
   * and a plain `!== false` test would treat it as ON — the exact bug
   * `ffmpeg.handler.ts` already had to fix for `label` ("`label: 'false'`
   * must turn labels OFF rather than being silently truthy"). A wrong image
   * with no error is worse than a config error, and `text`/`color`/`size`
   * all throw on a wrong type, so this does too.
   */
  it.each(['false', 'true', 0, 1, null, '', 'yes'])(
    'rejects the non-boolean background %p instead of silently drawing the box',
    (background) => {
      expect(() => vf({ text: 'T', background: background as unknown as boolean })).toThrow(
        /background/i,
      );
    },
  );
});

describe('buildFrameArgs — overlay color (pattern-validated, Ruling R98)', () => {
  const vf = (color: string) =>
    argAfter(
      buildFrameArgs({
        input: 'i',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay: { text: 'T', color },
      }),
      '-vf',
    );

  // Every accepted form was fed to ffmpeg 7.0.2's real av_parse_color (via
  // `drawbox=color=<v>`) and accepted; see the task 17a' report.
  it.each(['white', 'red', 'Red', 'yellow', '0xFF0000', '0xff0000', '#ff0000', '#FFAA00'])(
    'accepts %s',
    (color) => {
      expect(vf(color)).toContain(`fontcolor=${color}:`);
    },
  );

  /**
   * A colour is interpolated into the option list WITHOUT escaping, so the
   * pattern is the fence. `@alpha` is rejected on purpose even though ffmpeg
   * understands it: `@` and `:` in a colour are the syntax hatch we are
   * closing, and a caller who could write `white@0.5` could equally write
   * `white@0.5:x=0`.
   */
  it.each([
    'white@0.5',
    'red:x=0',
    "'; hflip",
    '0xff0000@0.5',
    '#ff0000@0.5',
    '',
    '0xFFF',
    '#ff00',
    '0xGGGGGG',
    'rgb(1,2,3)',
    'light blue',
    'white\\',
    'white,hflip',
  ])('rejects %s', (color) => {
    expect(() => vf(color)).toThrow(/colou?r/i);
  });

  it('rejects a non-string colour', () => {
    expect(() => vf(0xff0000 as unknown as string)).toThrow(/colou?r/i);
  });
});

describe('buildFrameArgs — overlay size (fraction of frame height)', () => {
  const vf = (size: number) =>
    argAfter(
      buildFrameArgs({
        input: 'i',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay: { text: 'T', size },
      }),
      '-vf',
    );

  it('multiplies the frame height by the fraction', () => {
    expect(vf(0.25)).toContain('fontsize=h*0.25:');
    expect(vf(1)).toContain('fontsize=h*1:');
  });

  /**
   * Pins the FULL shortest-round-tripping decimal for an explicit size, the
   * same property the default-overlay test pins for 1/12. Every digit is
   * load-bearing: rounding 1/12 to 11 significant figures was measured
   * through ffmpeg's own evaluator to give a 59px font where h/12 gives 60px
   * at height 720. Without a size that actually needs the digits, a
   * `.toPrecision()` "tidy-up" passes the rest of this suite untouched.
   */
  it('emits the full shortest-round-tripping decimal, never a shortened one', () => {
    expect(vf(1 / 3)).toContain('fontsize=h*0.3333333333333333:');
    expect(vf(1 / 12)).toContain('fontsize=h*0.08333333333333333:');
    expect(vf(0.123456789012345)).toContain('fontsize=h*0.123456789012345:');
  });

  /**
   * The floor exists so that "out of range" stays a CONFIG error the author
   * can fix. Without it, `size: 1e-7` is accepted here and then fails inside
   * ffmpeg at run time with a font size of 0 — which is the failure mode the
   * throw was chosen to avoid in the first place.
   */
  it('accepts the floor and rejects just under it', () => {
    expect(vf(MIN_SIZE)).toContain(`fontsize=h*${MIN_SIZE}:`);
    expect(() => vf(0.0049)).toThrow(/size/i);
    expect(() => vf(1e-7)).toThrow(/size/i);
  });

  /**
   * Out-of-range sizes THROW rather than clamp — the same choice as `color`,
   * so a bad `draw` block surfaces as one config error the caller can fix
   * instead of silently rendering at a size they did not ask for. A size of
   * 0/negative/NaN must never reach `fontsize=`: `fontsize=h*0` is a runtime
   * ffmpeg failure and `fontsize=h*NaN` an unrunnable argv.
   */
  it.each([0, -1, -0.5, NaN, Infinity, -Infinity, 1.0001, 2, 100, 1e-7, 0.001, 0.0049])(
    'rejects %s',
    (size) => {
      expect(() => vf(size)).toThrow(/size/i);
    },
  );

  it('rejects a non-number size', () => {
    expect(() => vf('0.5' as unknown as number)).toThrow(/size/i);
  });
});

describe('buildFrameArgs — the text fence (Ruling R98)', () => {
  //
  // Under the old design `label` only ever carried `clockLabel()` output —
  // digits and a colon. It now carries ARBITRARY caller text from pipeline
  // config, so `escapeAvfilterValue` is the only thing between that config
  // and an ffmpeg filter graph.
  //
  // None of the expected strings below is guesswork. Each was produced by
  // this builder and then fed to ffmpeg 7.0.2's real avfilter option parser
  // — `-v debug` against `drawgraph=m1=<value>:m2=MARKER`, reading the
  // parser's own `Setting 'm1' to value '<v>'` trace, since this build has
  // no drawtext but `m1` goes through the SAME generic string-option parser
  // drawtext's `text` does. Every case round-tripped byte-identically with
  // the trailing `m2` option intact and ffmpeg exiting 0. Full transcripts
  // are in the task 17a' report.
  const vf = (text: string) =>
    argAfter(
      buildFrameArgs({
        input: 'in.mp4',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay: { text },
      }),
      '-vf',
    );
  const TAIL =
    ':expansion=none:fontsize=h*0.08333333333333333:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16';

  it('round-trips a clock label (baseline)', () => {
    // parser reads text back as exactly "1:23"
    expect(vf('1:23')).toBe(`scale=-2:720,drawtext=text=1\\\\\\:23${TAIL}`);
  });

  it('round-trips a bare apostrophe — does NOT truncate or corrupt the text', () => {
    // parser reads text back as exactly "A'B"; the classic shell-style 'a'\''b'
    // requote trick FAILS under this two-pass parser (reads back as "ab").
    expect(vf("A'B")).toBe(`scale=-2:720,drawtext=text=A\\\\\\'B${TAIL}`);
  });

  it('round-trips two apostrophes in one text', () => {
    // parser reads text back as exactly "A'B'C" — one quote and a pair behave
    // the same, so the fence has no even/odd quote-pairing hole.
    expect(vf("A'B'C")).toBe(`scale=-2:720,drawtext=text=A\\\\\\'B\\\\\\'C${TAIL}`);
  });

  it('round-trips quote + colon + backslash together', () => {
    // parser reads text back as exactly "a'b:c\d"
    expect(vf("a'b:c\\d")).toBe(`scale=-2:720,drawtext=text=a\\\\\\'b\\\\\\:c\\\\\\\\d${TAIL}`);
  });

  it('a colon in the text cannot inject a fontsize option', () => {
    // parser reads text back as exactly "A'B:fontsize=200" — it stays INSIDE
    // the text value and the real fontsize that follows is untouched.
    expect(vf("A'B:fontsize=200")).toBe(
      `scale=-2:720,drawtext=text=A\\\\\\'B\\\\\\:fontsize=200${TAIL}`,
    );
  });

  it('a comma in the text cannot chain a second filter', () => {
    // parser reads text back as exactly "A'B,hflip" — no hflip instance is created.
    expect(vf("A'B,hflip")).toBe(`scale=-2:720,drawtext=text=A\\\\\\'B\\\\\\,hflip${TAIL}`);
  });

  it('a quote+semicolon cannot close the filter and start a new chain', () => {
    // parser reads text back as exactly "'; hflip"
    expect(vf("'; hflip")).toBe(`scale=-2:720,drawtext=text=\\\\\\'\\\\\\; hflip${TAIL}`);
  });

  it('crafted text cannot read an arbitrary local file via textfile=', () => {
    // parser reads text back as exactly "x':textfile=/etc/passwd:y='" — drawtext
    // never sees a textfile= OPTION, so it cannot render /etc/passwd.
    expect(vf("x':textfile=/etc/passwd:y='")).toBe(
      `scale=-2:720,drawtext=text=x\\\\\\'\\\\\\:textfile=/etc/passwd\\\\\\:y=\\\\\\'${TAIL}`,
    );
  });

  it('round-trips brackets, semicolon and percent', () => {
    // parser reads text back as exactly "A[B];C%D" — brackets/semicolon (graph
    // link-label syntax) stay inert; `%` needs no escaping at this layer.
    expect(vf('A[B];C%D')).toBe(`scale=-2:720,drawtext=text=A\\\\\\[B\\\\\\]\\\\\\;C%D${TAIL}`);
  });

  it('round-trips a trailing backslash without eating the next option', () => {
    // parser reads text back as exactly "A\" and m2 survives untouched.
    expect(vf('A\\')).toBe(`scale=-2:720,drawtext=text=A\\\\\\\\${TAIL}`);
  });

  it('round-trips ordinary prose with quotes, a colon and a percent', () => {
    // parser reads text back as exactly: Chapter 1: "Intro" - 50% done
    expect(vf('Chapter 1: "Intro" 50% done')).toBe(
      `scale=-2:720,drawtext=text=Chapter 1\\\\\\: "Intro" 50% done${TAIL}`,
    );
  });

  it('accepts the empty string (parser reads it back as an empty value)', () => {
    expect(vf('')).toBe(`scale=-2:720,drawtext=text=${TAIL}`);
  });

  /**
   * `draw:` with an empty body is `null` in YAML, not `undefined`, so this is
   * the shape a real authoring slip produces. It must be an Error like every
   * other bad-config case — a raw TypeError from inside the escape would slip
   * past the typed-config-error mapping and surface as a generic failure.
   */
  it.each([
    ['null', null],
    ['a string', 'bottom-right'],
    ['a number', 12],
    ['an array', ['text']],
  ])('rejects an overlay that is %s rather than an object', (_label, overlay) => {
    expect(() =>
      buildFrameArgs({
        input: 'i',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay: overlay as unknown as FrameOverlay,
      }),
    ).toThrow(/overlay/i);
  });

  it('rejects a non-string text rather than throwing a TypeError deep in the escape', () => {
    expect(() =>
      buildFrameArgs({
        input: 'i',
        output: 'o.jpg',
        time: 1,
        height: 720,
        quality: 3,
        overlay: { text: 42 as unknown as string },
      }),
    ).toThrow(/text/i);
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
