/**
 * Pure ffmpeg argv builders — a direct port of the wasm-proven commands in
 * Studio (repos/apps: apps/studio/src/lib/export/{slice,assemble}.ts). Two
 * details are load-bearing and must not be "simplified":
 *
 * 1. trim/atrim rebase to ONE shared origin (`PTS-<start>/TB`, never
 *    `PTS-STARTPTS`): video can only cut on whole frames while audio is
 *    sample-exact; rebasing each to its own first sample shifts the picture up
 *    to 1/fps ahead of the sound at EVERY cut.
 * 2. `-fps_mode passthrough`: setpts clears the frame rate on the filter link
 *    and ffmpeg falls back to 25 fps, resampling — dropping over half the
 *    frames of a 60 fps screen recording.
 *
 * Encode profile is the wasm one (libx264 ultrafast / yuv420p / aac /
 * +faststart) so server clips stream-copy-concat with wasm clips and with each
 * other. Builders are pure; the runner prepends global flags (-nostdin -y).
 */

export interface Span {
  start: number;
  end: number;
}

/** Trim trailing zeros off a fixed-precision seconds value for the argv. */
function secs(v: number): string {
  return Number(v.toFixed(3)).toString();
}

/** ~10ms audio edge fade per kept piece, kills clicks at cut joins (assemble.ts FADE). */
const FADE = 0.01;

const ENCODE_PROFILE = (threads: number): string[] => [
  '-fps_mode',
  'passthrough',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-threads',
  String(threads),
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-movflags',
  '+faststart',
];

/** 16 kHz mono WAV — the transcription contract (Studio story 01b). */
export function buildExtractAudioArgs(input: string, output: string): string[] {
  return ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', output];
}

function spanFilterGraph(spans: Span[], audioFades: boolean): string {
  const parts: string[] = [];
  spans.forEach((v, i) => {
    const s = secs(v.start);
    const e = secs(v.end);
    const origin = `PTS-${s}/TB`;
    parts.push(`[0:v]trim=${s}:${e},setpts=${origin}[v${i}]`);
    const len = v.end - v.start;
    const fade = audioFades
      ? `,afade=t=in:st=0:d=${secs(FADE)},afade=t=out:st=${secs(Math.max(0, len - FADE))}:d=${secs(FADE)}`
      : '';
    parts.push(`[0:a]atrim=${s}:${e},asetpts=${origin}${fade}[a${i}]`);
  });
  const labels = spans.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${labels}concat=n=${spans.length}:v=1:a=1[vout][aout]`);
  return parts.join(';');
}

/**
 * Cut the kept spans out of `input` and concat them into one clip.
 * Single span → fast-seek (`-ss` before `-i`) + `-copyts` so the trim graph
 * addresses original-video seconds without decoding from 0 (slice.ts). Multi
 * span → whole input through the graph (assemble.ts).
 */
export function buildSliceArgs(opts: {
  input: string;
  output: string;
  spans: Span[];
  threads: number;
  audioFades?: boolean;
}): string[] {
  const spans = opts.spans.map((v) => {
    const start = Math.max(0, v.start);
    return { start, end: Math.max(start, v.end) };
  });
  const graph = spanFilterGraph(spans, opts.audioFades === true);
  const inputArgs =
    spans.length === 1
      ? ['-ss', secs(spans[0].start), '-copyts', '-i', opts.input, '-to', secs(spans[0].end)]
      : ['-i', opts.input];
  return [
    ...inputArgs,
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    ...ENCODE_PROFILE(opts.threads),
    opts.output,
  ];
}

/** One `file '<part>'` line per part, in order (concat demuxer list). */
export function buildConcatListContent(paths: string[]): string {
  for (const p of paths) {
    // Scratch filenames are UUID-based so this never fires in practice; it is a
    // guard against list-file directive injection if that ever changes.
    if (p.includes("'") || p.includes('\n')) {
      throw new Error(`concat list entry contains illegal character: ${p}`);
    }
  }
  return paths.map((p) => `file '${p}'`).join('\n') + '\n';
}

/**
 * Stitch uniformly-encoded parts. Stream-copy first (near-instant, ~no memory);
 * `reencode: true` is the automatic fallback for stream-mismatch failures.
 * `-fflags +genpts` regenerates PTS so scene boundaries are clean.
 */
export function buildConcatArgs(
  listPath: string,
  output: string,
  opts: { reencode: boolean; threads: number },
): string[] {
  const codec = opts.reencode
    ? ENCODE_PROFILE(opts.threads).filter((a) => a !== '-fps_mode' && a !== 'passthrough')
    : ['-c', 'copy', '-movflags', '+faststart'];
  return ['-f', 'concat', '-safe', '0', '-fflags', '+genpts', '-i', listPath, ...codec, output];
}

/** ffprobe (not ffmpeg) argv: json essentials — duration, streams. */
export function buildProbeArgs(input: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input];
}

/**
 * Escape a raw string for use as an UNQUOTED avfilter option value (e.g. the
 * `text=` value of `drawtext`), so that whatever ffmpeg's option parser
 * ultimately reads back is byte-identical to the input. This is a genuine
 * filter-injection fence — verified empirically against ffmpeg 7.0.2's real
 * avfilter parser (see task 17a fix report, C1) — not a guess from reading
 * the docs.
 *
 * It is also the ONLY thing standing between pipeline config and an ffmpeg
 * filter graph: `buildFrameArgs`'s overlay text is arbitrary caller-supplied
 * text (Ruling R98), not a formatted clock, so this is a security boundary
 * and not a defensive nicety. Re-proven at that widened threat model in the
 * task 17a' report — eleven hostile texts round-trip byte-identically with a
 * trailing marker option intact. Do not "simplify" it, and do not add a
 * second escaping layer on top: both break the measured round trip.
 *
 * ffmpeg parses a `-vf`/`-filter_complex` string in TWO independent,
 * escape/quote-aware passes: an outer pass that splits the whole graph on
 * unescaped `,` `;` `[` `]` to find each filter instance, and an inner pass
 * (`av_set_options_string`) that splits that instance's option list on
 * unescaped `:`. Both passes apply the SAME rule — `\X` collapses to a
 * literal `X` (any `X`, including another backslash or a quote), and a bare
 * `'` toggles a quoted region where backslash stops being special — and
 * BOTH passes run over our value, one after the other. A single level of
 * backslash-escaping only survives one of those passes (proven empirically:
 * `m1='1\:23'` round-trips only because the outer pass's quoting shields
 * the inner pass's `\:`; drop either the quotes or the escape and it
 * truncates at the colon). Wrapping the value in `'...'` doesn't help
 * either — a label that itself contains `'` collides with the SAME quote
 * character the wrapper uses, and the outer pass closes on it early
 * (proven empirically: the classic shell `'a'\''b'` requote trick reads
 * back as `ab`, not `a'b`, under this two-pass parser).
 *
 * What DOES survive both passes, proven against real `Setting 'm1' to
 * value '<value>'` parser traces for every character below: escape `\`,
 * `'`, `:`, `,`, `;`, `[`, `]` once each (backslash first, so later
 * insertions aren't re-escaped), and apply that WHOLE escaping pass AGAIN
 * over its own output — no surrounding quotes needed or wanted. `%` is
 * deliberately left alone: it isn't special to this parser at all; its
 * `%{pts}` / `%{metadata:…}` / `%{eif:…}` expansion happens inside drawtext
 * itself, as a THIRD pass over the already-parsed text, and is closed by
 * `expansion=none` on the filter instead (see `buildFrameArgs`).
 */
function escapeAvfilterValue(raw: string): string {
  const once = (s: string): string =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
  return once(once(raw));
}

/**
 * Where an overlay sits in the frame. A CLOSED enum on purpose (Ruling R98):
 * `drawtext`'s `x=`/`y=` take arbitrary expressions, so a caller who could
 * supply one could read filter variables or smuggle option syntax into the
 * graph. The caller picks a corner; CE writes the expression.
 */
export type OverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** One burned-in text overlay — the whole of what CE lets a caller draw (Ruling R99: one per frame, no images, no stacking). */
export interface FrameOverlay {
  /** Text to burn in, verbatim. Escaped into the graph and never interpreted — see `escapeAvfilterValue`. */
  text: string;
  /** Default `'bottom-right'`. */
  position?: OverlayPosition;
  /** Font height as a FRACTION of the frame height, in (0, 1]. Default 1/12. */
  size?: number;
  /** Text colour: an ffmpeg colour NAME or `0xRRGGBB`/`#RRGGBB`. No `@alpha`. Default `'white'`. */
  color?: string;
  /** Draw the dark box behind the text. Default true. */
  background?: boolean;
}

/** Inset from the frame edge in pixels — the margin the original hard-coded corner label used. */
const OVERLAY_MARGIN = 16;

/** Font height as a fraction of frame height, matching the original `fontsize=h/12`. */
const DEFAULT_OVERLAY_SIZE = 1 / 12;

/** Smallest font we let a caller ask for — ~4px at 720p, and small enough that ffmpeg still rounds it to a drawable size. */
const MIN_OVERLAY_SIZE = 0.005;
/** Largest — a font taller than its own frame is a config mistake, not a request. */
const MAX_OVERLAY_SIZE = 1;

/**
 * The `x`/`y` expression pair CE emits for each position. `tw`/`th` are
 * drawtext's rendered text width/height, `w`/`h` the frame's.
 */
const OVERLAY_PLACEMENT: Record<OverlayPosition, { x: string; y: string }> = {
  'top-left': { x: `${OVERLAY_MARGIN}`, y: `${OVERLAY_MARGIN}` },
  'top-center': { x: '(w-tw)/2', y: `${OVERLAY_MARGIN}` },
  'top-right': { x: `w-tw-${OVERLAY_MARGIN}`, y: `${OVERLAY_MARGIN}` },
  center: { x: '(w-tw)/2', y: '(h-th)/2' },
  'bottom-left': { x: `${OVERLAY_MARGIN}`, y: `h-th-${OVERLAY_MARGIN}` },
  'bottom-center': { x: '(w-tw)/2', y: `h-th-${OVERLAY_MARGIN}` },
  'bottom-right': { x: `w-tw-${OVERLAY_MARGIN}`, y: `h-th-${OVERLAY_MARGIN}` },
};

/** An ffmpeg colour name (`white`, `Red`, …) — letters only, so it cannot carry filter syntax. */
const COLOR_NAME = /^[A-Za-z]+$/;
/** `0xRRGGBB` / `#RRGGBB`. Both are accepted by `av_parse_color`, verified on ffmpeg 7.0.2. */
const COLOR_HEX = /^(?:0x|#)[0-9A-Fa-f]{6}$/;

/**
 * Unlike `text`, a colour is interpolated into the option list WITHOUT
 * escaping — `av_parse_color` would not understand an escaped value — so this
 * pattern is the fence, and it is deliberately narrower than ffmpeg's own
 * colour syntax. `@alpha` is refused even though ffmpeg understands it:
 * `white@0.5` and `white@0.5:x=0` differ only in what follows the `@`, and a
 * validator that admits the first has already conceded the character that
 * makes the second expressible. Callers that want translucency get it from
 * `background`, not from a colour string.
 */
function overlayColor(color: string | undefined): string {
  if (color === undefined) return 'white';
  if (typeof color !== 'string' || (!COLOR_NAME.test(color) && !COLOR_HEX.test(color))) {
    throw new Error(
      `overlay color must be an ffmpeg colour name or 0xRRGGBB/#RRGGBB with no @alpha suffix, got: ${JSON.stringify(color)}`,
    );
  }
  return color;
}

/**
 * `size` is a fraction of frame height, so the argv is a MULTIPLY
 * (`fontsize=h*<size>`) where the original hard-coded filter divided
 * (`fontsize=h/12`). The two are the same to ffmpeg: its expression
 * evaluator does IEEE-754 double arithmetic on the value `strtod` recovers
 * from our shortest-round-trip decimal, and `h/12` and
 * `h*0.08333333333333333` were measured to yield the identical integer on
 * ffmpeg 7.0.2 (see the task 17a' report).
 *
 * DO NOT SHORTEN THE EMITTED LITERAL. `String(size)` gives JavaScript's
 * shortest round-tripping decimal, and every digit of it is load-bearing:
 * rounding the default to 11 significant figures
 * (`h*8.3333333333e-2`) was MEASURED through the same evaluator to give 59
 * where `h/12` gives 60 at height 720 — a one-pixel-smaller font in every
 * frame we render. A `.toFixed(6)`-style tidy-up here reads like cosmetics
 * and is a silent visual regression.
 *
 * Out of range THROWS rather than clamping, so a bad `draw` block surfaces
 * as one config error instead of silently rendering at a size nobody asked
 * for. The floor is part of that promise, not fussiness: `size: 1e-7` is a
 * perfectly finite fraction that ffmpeg then rejects at RUN time with a font
 * size of 0, turning the config error we wanted into the runtime failure we
 * were avoiding. `MIN_OVERLAY_SIZE` is ~4px at 720p, below which nothing is
 * legible anyway.
 *
 * The range also keeps the interpolation safe: a finite positive `number`
 * stringifies to digits, `.`, and possibly `e`/`-` — never a filter
 * metacharacter — which is why this value needs no escaping.
 */
function overlayFontSize(size: number | undefined): string {
  if (size === undefined) return String(DEFAULT_OVERLAY_SIZE);
  if (
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    size < MIN_OVERLAY_SIZE ||
    size > MAX_OVERLAY_SIZE
  ) {
    throw new Error(
      `overlay size must be a fraction of the frame height between ${MIN_OVERLAY_SIZE} and ${MAX_OVERLAY_SIZE}, got: ${String(size)}`,
    );
  }
  return String(size);
}

/**
 * Resolve a position to its expression pair; anything not in the table throws
 * rather than emitting an empty `x=`/`y=`.
 *
 * The `typeof` test is what actually closes the enum. `hasOwnProperty`
 * string-coerces its key, so without it `['top-left']` resolves to the
 * `'top-left'` row. That was never dangerous — a coerced key still has to
 * name one of CE's OWN rows, so the emitted expression is always ours — but
 * an enum that quietly accepts a one-element array is not closed. Only
 * `undefined` defaults; an explicitly-written-but-empty `position:` (which
 * YAML hands us as `null`) is an authoring slip and is reported as one,
 * exactly like every other wrong-typed field in the block.
 */
function overlayPlacement(position: OverlayPosition | undefined): { x: string; y: string } {
  const key = position === undefined ? 'bottom-right' : position;
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(OVERLAY_PLACEMENT, key)) {
    throw new Error(
      `unknown overlay position: ${JSON.stringify(key)} (expected one of ${Object.keys(OVERLAY_PLACEMENT).join(', ')})`,
    );
  }
  return OVERLAY_PLACEMENT[key];
}

/**
 * One still: fast-seek (`-ss` before `-i`, keyframe-accurate rather than
 * frame-exact) to `time`, scale to `height` (width kept even via `-2`), and
 * optionally draw ONE line of text on it. That is deliberately a DRAWING
 * primitive, not a labelled-thumbnail feature: what the text says, how many
 * frames there are and how far apart they sit are the calling app's policy,
 * not CE's (Ruling R99). A contact-sheet cell and a title card on a
 * screenshot are the same call with different `overlay` values.
 *
 * `overlay` needs `drawtext`, which needs libfreetype AND fontconfig plus an
 * installed font in the runtime image (there is no `font=`/`fontfile=` here,
 * so it resolves via fontconfig) — omit it and the filter chain skips
 * drawtext entirely rather than failing.
 *
 * Every caller-supplied part of the overlay is fenced, because `overlay.text`
 * now carries arbitrary strings from pipeline config rather than a formatted
 * clock (Ruling R98), and everything in a filter graph shares one flat option
 * syntax:
 *
 * - `text` goes through `escapeAvfilterValue` (a measured filter-injection
 *   fence, not cosmetics) and the filter carries `expansion=none`, which
 *   closes drawtext's OWN `%{...}` pass — a separate mechanism the
 *   value-level escaping cannot reach.
 * - `color` is pattern-validated (`overlayColor`); it cannot be escaped
 *   because `av_parse_color` has to read it back literally.
 * - `size` is range-checked (`overlayFontSize`), so only digits reach `h*`.
 * - `position` is an enum CE turns into the `x=`/`y=` expressions itself
 *   (`overlayPlacement`); a caller never writes a coordinate.
 */
export function buildFrameArgs(o: {
  input: string;
  output: string;
  time: number;
  height: number;
  quality: number;
  overlay?: FrameOverlay;
}): string[] {
  // `height` is interpolated WITHOUT escaping, unlike everything in `overlay`.
  // That asymmetry is deliberate, not an oversight: `height` is a dimension
  // the calling handler has already coerced to a number
  // (`ffmpeg.handler.ts`'s `knobs()`, which coerces it via
  // `knob(config.height, 'height', 'integer')` — the right place for a value
  // that is arithmetic rather than text), whereas `overlay` is prose
  // and colours a pipeline author types verbatim. If `height` ever becomes
  // caller-supplied without that upstream coercion, it needs a fence here
  // too — `buildFrameArgs({ height: '720,hflip' })` would otherwise chain a
  // second filter.
  const filters = [`scale=-2:${o.height}`];
  const overlay = o.overlay;
  if (overlay !== undefined) {
    // `draw:` with an empty body is `null`, not `undefined`, in YAML — so
    // this guard is a real authoring slip, not a defensive nicety. It has to
    // be an Error like every other bad-config case: a raw TypeError out of
    // the escape below would slip past the caller's typed-config-error
    // mapping and surface as a generic handler failure.
    if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) {
      throw new Error(
        `overlay must be an object, got: ${overlay === null ? 'null' : typeof overlay}`,
      );
    }
    if (typeof overlay.text !== 'string') {
      throw new Error(`overlay text must be a string, got: ${typeof overlay.text}`);
    }
    const placement = overlayPlacement(overlay.position);
    const options = [
      `text=${escapeAvfilterValue(overlay.text)}`,
      'expansion=none',
      `fontsize=h*${overlayFontSize(overlay.size)}`,
      `fontcolor=${overlayColor(overlay.color)}`,
    ];
    // Deliberately NOT `background !== false`. YAML and JSON pipeline config
    // is exactly where the string "false" comes from, and a truthiness test
    // would draw the box anyway — the same silent-wrong-image bug
    // `ffmpeg.handler.ts` already had to fix for `label`. A wrong frame with
    // no error is worse than a config error.
    if (overlay.background !== undefined && typeof overlay.background !== 'boolean') {
      throw new Error(
        `overlay background must be true or false, got: ${JSON.stringify(overlay.background)}`,
      );
    }
    if (overlay.background !== false) {
      options.push('box=1', 'boxcolor=black@0.6', 'boxborderw=8');
    }
    options.push(`x=${placement.x}`, `y=${placement.y}`);
    filters.push(`drawtext=${options.join(':')}`);
  }
  return [
    '-ss',
    secs(o.time),
    '-i',
    o.input,
    '-frames:v',
    '1',
    '-vf',
    filters.join(','),
    '-q:v',
    String(o.quality),
    // A seek past the end of the source encodes NOTHING, and ffmpeg 7 still
    // exits 0 having written no file (measured on 7.0.2). When the still is an
    // uploaded output that surfaces later as a stat ENOENT, which the caller can
    // rename; when it is a scratch CELL nobody stats, the gap is invisible and
    // the `image2` demuxer feeding the tile pass simply stops early — so the
    // sheet comes back padded with `0x111111` squares while its reported `times`
    // claim real frames. Measured: 6 cells with `cell-003` missing tiled to
    // slot values [30, 61, 17, 17, 17, 17], exit 0, sheet written.
    //
    // `-abort_on empty_output` turns that into exit 234 at the CELL, so the gap
    // can never reach the tile pass. It belongs here and nowhere else: the same
    // flag on the tile command does NOT fire on a gapped sequence (measured,
    // exit 0). ffmpeg 8 (Alpine — CE's backend image and the Worker) already
    // exits 234 without it, so this normalises the older runtimes rather than
    // changing behaviour where it is already right, and a VALID seek still
    // exits 0 on both — with a bare scale chain, with drawbox, and with a real
    // drawtext overlay.
    '-abort_on',
    'empty_output',
    o.output,
  ];
}

/**
 * Tile `count` numbered cells (`pattern` is a literal glob like
 * `cell-%03d.jpg`, not an `{out:}` placeholder — both executors spawn with
 * cwd = the scratch dir, so scratch cells are addressed by bare
 * scratch-relative filenames, ruling R75) into one sheet. `columns` is THIS
 * sheet's actual grid width, not the caller's `columns` config knob — the two
 * differ on a short final sheet (2 cells under a `columns: 3` config are laid
 * out 2 wide, not 3), and it is the caller's job to pass the narrower one.
 * Rows grow to fit.
 * `columns`/`count` are clamped to at least 1 so a bad caller value can never
 * produce an unrunnable `tile=0x…` or `tile=…xInfinity` argv.
 *
 * `trim=end_frame=${count}` is LOAD-BEARING, not tidiness. `tile=CxR` emits
 * its first frame only once it has collected C×R inputs, and the `image2`
 * demuxer keeps reading `cell-%0Nd.jpg` upward past `count` — straight into
 * the NEXT sheet's cells, which sit in the same scratch dir with contiguous
 * numbering. So without the trim, every sheet whose `count` is not a multiple
 * of `cols` is built from the wrong frames while its reported `times` say
 * otherwise. Measured on ffmpeg 7.0.2 with 22 numbered grey cells, sheet 1 of
 * a 12-per-sheet plan (`start 1, count 10, tile=3x4`): slots 11 and 12 came
 * back as cells 11 and 12 instead of padding; with the trim they are the
 * `0x111111` pad. The trim is also what makes the "short sheets are padded by
 * `tile` itself" claim TRUE — that padding only happens at EOF, which a
 * non-final sheet never reached.
 */
export function buildTileArgs(o: {
  pattern: string;
  start: number;
  count: number;
  columns: number;
  output: string;
}): string[] {
  const columns = Number.isFinite(o.columns) && o.columns > 0 ? o.columns : 1;
  const count = Number.isFinite(o.count) && o.count > 0 ? o.count : 1;
  const rows = Math.ceil(count / columns);
  return [
    '-start_number',
    String(o.start),
    '-i',
    o.pattern,
    '-frames:v',
    '1',
    '-vf',
    `trim=end_frame=${count},tile=${columns}x${rows}:padding=2:margin=2:color=0x111111`,
    '-q:v',
    '3',
    o.output,
  ];
}
