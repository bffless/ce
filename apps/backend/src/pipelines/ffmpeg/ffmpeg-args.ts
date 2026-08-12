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
