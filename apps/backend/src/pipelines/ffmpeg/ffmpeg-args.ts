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
 * One still: fast-seek (`-ss` before `-i`, keyframe-accurate enough for a
 * contact sheet, not frame-exact) to `time`, scale to `height` (width kept
 * even via `-2`), optionally burn in a corner label. `label` is only ever
 * passed when the caller intends to try `drawtext`, which needs libfreetype
 * in the ffmpeg build — omit it and the filter chain skips drawtext
 * entirely rather than failing. The label is escaped against ffmpeg filter
 * syntax (backslash, then `:`, then `'`, in that order) before being
 * wrapped in the filter's own quotes — this is a filter-injection fence,
 * not cosmetics, since `label` can be a burned-in timestamp built from
 * caller-controlled data.
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
    const text = o.label.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    filters.push(
      `drawtext=text='${text}':fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=h-th-16`,
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
 * scratch-relative filenames, ruling R75) into one sheet, `columns` wide.
 * Rows grow to fit; a short last sheet (fewer than a full grid of cells) is
 * padded by the `tile` filter itself, not by this builder.
 */
export function buildTileArgs(o: {
  pattern: string;
  start: number;
  count: number;
  columns: number;
  output: string;
}): string[] {
  const rows = Math.ceil(o.count / o.columns);
  return [
    '-start_number',
    String(o.start),
    '-i',
    o.pattern,
    '-frames:v',
    '1',
    '-vf',
    `tile=${o.columns}x${rows}:padding=2:margin=2:color=0x111111`,
    '-q:v',
    '3',
    o.output,
  ];
}

/**
 * Contact-sheet planning — a port of Studio's `planContactSheet`
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
 */
export const MIN_INTERVAL_SECONDS = 5;
export const MAX_INTERVAL_SECONDS = 30;
export const MAX_SHEETS = 10;
export const TILE_COLUMNS = 3;
export const PREFERRED_CELLS_PER_SHEET = 9;
export const MAX_CELLS_PER_SHEET = 12;

export interface ContactSheetPlanOptions {
  /** Sampling density floor in seconds (config `interval`). Default `MIN_INTERVAL_SECONDS`. */
  minInterval?: number;
  /** Columns per tiled sheet (config `columns`). Default `TILE_COLUMNS`. */
  columns?: number;
  /** Cap on cells per sheet (config `cellsPerSheet`). Default `MAX_CELLS_PER_SHEET`. */
  cellsPerSheet?: number;
  /** Cap on number of sheets (config `maxSheets`). Default `MAX_SHEETS`. */
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

/** duration<=0 or non-finite ⇒ 0; else the frame count at `minInterval` density, uncapped by the sheet/cell budget. */
function frameCount(duration: number, minInterval: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(1, Math.ceil(duration / minInterval));
}

/** `count` capture timestamps spread evenly across the clip, each centred in its bucket and kept just shy of `duration` so the seek always lands on real footage. */
function sampleTimes(duration: number, count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) =>
    Math.min(duration - 0.05, (i + 0.5) * (duration / count)),
  );
}

/**
 * The clip-wide plan: how many frames to sample, their timestamps, and how
 * to tile them into sheets. `duration <= 0` or non-finite yields the empty
 * plan (`{ interval: 0, times: [], perSheet: 0, sheets: [] }`).
 */
export function planContactSheet(
  duration: number,
  opts: ContactSheetPlanOptions = {},
): ContactSheetPlan {
  const minInterval = opts.minInterval ?? MIN_INTERVAL_SECONDS;
  const columns = opts.columns ?? TILE_COLUMNS;
  const cellsPerSheetCap = opts.cellsPerSheet ?? MAX_CELLS_PER_SHEET;
  const maxSheets = opts.maxSheets ?? MAX_SHEETS;

  const dense = frameCount(duration, minInterval);
  if (dense === 0) return { interval: 0, times: [], perSheet: 0, sheets: [] };

  // Aim for `minInterval` density, never sparser than MAX_INTERVAL_SECONDS, never
  // over the maxSheets*cellsPerSheet budget (dense >= coverage whenever
  // minInterval < MAX_INTERVAL_SECONDS, so the coverage floor is belt-and-braces).
  const coverage = Math.ceil(duration / MAX_INTERVAL_SECONDS);
  const maxFrames = maxSheets * cellsPerSheetCap;
  const total = Math.min(maxFrames, Math.max(coverage, dense));
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
