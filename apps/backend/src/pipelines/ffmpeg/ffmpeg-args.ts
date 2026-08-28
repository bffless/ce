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
 * One still: fast-seek (`-ss` before `-i`, keyframe-accurate enough for a
 * contact sheet, not frame-exact) to `time`, scale to `height` (width kept
 * even via `-2`), optionally burn in a corner label. `label` is only ever
 * passed when the caller intends to try `drawtext`, which needs libfreetype
 * AND fontconfig plus an installed font in the runtime image (there is no
 * `font=`/`fontfile=` here, so it resolves via fontconfig) — omit it and the
 * filter chain skips drawtext entirely rather than failing. The label is
 * escaped via `escapeAvfilterValue` (a proven filter-injection fence, not
 * cosmetics — `label` can be a burned-in timestamp built from
 * caller-controlled data) and the filter carries `expansion=none` so
 * drawtext's own post-parse `%{...}` expansion — a separate mechanism the
 * value-level escaping above cannot reach — is disabled too.
 */
export function buildFrameArgs(o: {
  input: string;
  output: string;
  time: number;
  height: number;
  quality: number;
  label?: string;
}): string[] {
  const filters = [`scale=-2:${o.height}`];
  if (o.label !== undefined) {
    const text = escapeAvfilterValue(o.label);
    filters.push(
      `drawtext=text=${text}:expansion=none:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16`,
    );
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
    o.output,
  ];
}

/**
 * Tile `count` numbered cells (`pattern` is a literal glob like
 * `cell-%03d.jpg`, not an `{out:}` placeholder — both executors spawn with
 * cwd = the scratch dir, so scratch cells are addressed by bare
 * scratch-relative filenames, ruling R75) into one sheet. `columns` is the
 * cell's ACTUAL grid width, not the planner's `columns` config knob — pass
 * `sheet.cols` from `planContactSheet`'s output, not the caller's `columns`
 * option, since they differ on a short final sheet (e.g. 2 cells under a
 * `columns: 3` config planned as `cols: 2`, not 3). Rows grow to fit.
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

/** Finest spacing we sample at — closer just yields near-duplicate frames. Drives density on SHORT clips so they aren't needlessly sparse. */
export const MIN_INTERVAL_SECONDS = 5;
/** Coarsest spacing we tolerate as a FIXED coverage floor (not one of the overridable knobs — see `ContactSheetPlanOptions.minInterval`) — beyond it too much is skipped, until the frame budget caps out and forces it wider. */
export const MAX_INTERVAL_SECONDS = 30;
/** Hard cap on images sent to the caller in one call. */
export const MAX_SHEETS = 10;
/** Default columns per sheet. Few columns ⇒ wide cells ⇒ legible after any downstream resize. */
export const TILE_COLUMNS = 3;
/** Cells per sheet we aim for once the budget forces multiple sheets — fixed, NOT one of the overridable knobs (a caller's lower `cellsPerSheet` cap still wins over it). */
export const PREFERRED_CELLS_PER_SHEET = 9;
/** Default most cells we'll pack before per-frame detail suffers. */
export const MAX_CELLS_PER_SHEET = 12;

export interface ContactSheetPlanOptions {
  /**
   * Sampling density floor in seconds (config `interval`). Default
   * `MIN_INTERVAL_SECONDS`. This only raises or lowers the DENSE end of the
   * range — `MAX_INTERVAL_SECONDS` (30s) stays a fixed, non-overridable
   * coverage floor underneath it. Asking for looser sampling than that
   * (e.g. `minInterval: 60` on a clip where 30s coverage alone already
   * needs more frames than that would produce) does not widen the spacing
   * past 30s: `planContactSheet(600, { minInterval: 60 })` still samples
   * every 30s (20 frames), not every 60s (10 frames), because coverage
   * wins whenever it demands more frames than the requested density does.
   */
  minInterval?: number;
  /** Columns per tiled sheet (config `columns`). Default `TILE_COLUMNS`. Clamped to at least 1. */
  columns?: number;
  /** Cap on cells per sheet (config `cellsPerSheet`). Default `MAX_CELLS_PER_SHEET`. Clamped to at least 1. */
  cellsPerSheet?: number;
  /** Cap on number of sheets (config `maxSheets`). Default `MAX_SHEETS`. Clamped to at least 1. */
  maxSheets?: number;
}

export interface ContactSheetPlan {
  /** Actual seconds between sampled frames (`duration / times.length`) — widens past `MAX_INTERVAL_SECONDS` once the frame budget caps out. */
  interval: number;
  /** All capture timestamps in seconds, evenly spread and bucket-centred. */
  times: number[];
  /** Cells per composed sheet — `times` is chunked by this into ≤ `maxSheets` tiles. */
  perSheet: number;
  /** One entry per tiled sheet: its slice of `times`, the 1-based index of its first cell in `times`, and its grid shape. */
  sheets: Array<{
    index: number;
    start: number;
    count: number;
    times: number[];
    cols: number;
    rows: number;
  }>;
}

/**
 * duration<=0 or non-finite ⇒ 0; else the frame count at `minInterval`
 * density, uncapped by the sheet/cell budget. `minInterval` itself falls
 * back to `MIN_INTERVAL_SECONDS` when it isn't a usable positive number
 * (Studio's `step` guard) — `planContactSheet(d, { minInterval: NaN })` or
 * a negative override must fall back to the default density, not cascade
 * NaN/garbage into the plan.
 */
function frameCount(duration: number, minInterval: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const step = minInterval > 0 ? minInterval : MIN_INTERVAL_SECONDS;
  return Math.max(1, Math.ceil(duration / step));
}

/** `count` capture timestamps spread evenly across the clip, each centred in its bucket and kept just shy of `duration` so the seek always lands on real footage. */
function sampleTimes(duration: number, count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) =>
    Math.min(duration - 0.05, (i + 0.5) * (duration / count)),
  );
}

/** `value` if it's a usable positive number, else `fallback` — guards every overridable knob (`columns`/`cellsPerSheet`/`maxSheets`) against 0, negative, `NaN`/`Infinity`, so a bad pipeline config can never make the planner divide by zero or emit a non-finite grid dimension. */
function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The clip-wide plan: how many frames to sample, their timestamps, and how
 * to tile them into sheets — a port of Studio's `planContactSheet`
 * (repos/apps: `apps/studio/src/lib/contactSheet.ts`). CE and Studio are
 * separate deploy units (this runs server-side in the backend bundle;
 * Studio's runs client-side against wasm ffmpeg), so the algorithm is
 * deliberately duplicated here rather than shared — that duplication, plus
 * this doc comment, is how the two copies stay findable when one changes.
 *
 * Same constraints Studio's version balances: sample as densely as
 * `minInterval` allows on short clips (closer just yields near-duplicate
 * frames), never sparser than `MAX_INTERVAL_SECONDS` on long ones (until
 * the frame budget forces it wider), prefer `PREFERRED_CELLS_PER_SHEET`
 * cells per sheet for per-frame legibility (up to the `cellsPerSheet` cap),
 * and never exceed `maxSheets` images. Unlike Studio, CE's `contact_sheet`
 * operation lets a pipeline override `minInterval`/`columns`/`cellsPerSheet`/
 * `maxSheets` per call (Studio hardcodes its module constants) — but
 * `PREFERRED_CELLS_PER_SHEET` is NOT one of those knobs: it stays fixed at
 * 9, and `perSheet`'s `min(cellsPerSheet, …)` still enforces a caller's
 * lower cap over it. (Ruling R74: this is a straight port of Studio's real
 * algorithm, not the plan's prose formula, which contradicts its own test
 * expectations.)
 *
 * `duration <= 0` or non-finite yields the empty plan
 * (`{ interval: 0, times: [], perSheet: 0, sheets: [] }`); every overridable
 * knob falls back to its default rather than propagating `NaN`/`Infinity`
 * or dividing by zero when a caller passes a bad value (Ruling: a pure
 * function that cannot itself emit an unrunnable plan is the better seam —
 * 17b shouldn't have to pre-validate pipeline config).
 */
export function planContactSheet(
  duration: number,
  opts: ContactSheetPlanOptions = {},
): ContactSheetPlan {
  const minInterval = opts.minInterval ?? MIN_INTERVAL_SECONDS;
  const columns = positiveOr(opts.columns, TILE_COLUMNS);
  const cellsPerSheetCap = positiveOr(opts.cellsPerSheet, MAX_CELLS_PER_SHEET);
  const maxSheets = positiveOr(opts.maxSheets, MAX_SHEETS);

  const dense = frameCount(duration, minInterval);
  if (dense === 0) return { interval: 0, times: [], perSheet: 0, sheets: [] };

  // Aim for `minInterval` density, never sparser than MAX_INTERVAL_SECONDS, never
  // over the maxSheets*cellsPerSheet budget (dense >= coverage whenever
  // minInterval < MAX_INTERVAL_SECONDS, so the coverage floor is belt-and-braces).
  const coverage = Math.ceil(duration / MAX_INTERVAL_SECONDS);
  const maxFrames = maxSheets * cellsPerSheetCap;
  const total = Math.min(maxFrames, Math.max(coverage, dense));
  if (total <= 0) return { interval: 0, times: [], perSheet: 0, sheets: [] };
  const times = sampleTimes(duration, total);
  const perSheet = Math.min(
    cellsPerSheetCap,
    total,
    Math.max(PREFERRED_CELLS_PER_SHEET, Math.ceil(total / maxSheets)),
  );

  const sheets: ContactSheetPlan['sheets'] = [];
  for (let i = 0; i < times.length; i += perSheet) {
    const slice = times.slice(i, i + perSheet);
    const cols = Math.min(slice.length, columns);
    sheets.push({
      index: sheets.length,
      start: i + 1,
      count: slice.length,
      times: slice,
      cols,
      rows: Math.ceil(slice.length / cols),
    });
  }

  return { interval: duration / total, times, perSheet, sheets };
}

/**
 * Clock label burned onto each frame by `buildFrameArgs`'s `label`: plain
 * wall-clock `m:ss`, promoting to `h:mm:ss` once the clip passes an hour (no
 * tenths, so it stays readable at thumbnail size). Negative or non-finite
 * input clamps to `0:00` rather than throwing or emitting `NaN`.
 */
export function clockLabel(seconds: number): string {
  const clamped = !Number.isFinite(seconds) || seconds < 0 ? 0 : seconds;
  const total = Math.floor(clamped);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = (total % 60).toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
