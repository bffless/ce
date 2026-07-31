/**
 * Reduce an arbitrary value to a filename safe to interpolate into a
 * `Content-Disposition` header value. THE choke point: every adapter trusts
 * that `SignedUrlOptions.downloadFilename` came through here.
 *
 * Strips path separators (basename only), then control characters, double
 * quotes and backslashes — the characters that could break out of the quoted
 * header value or inject a second header. Returns `undefined` when nothing
 * usable survives, which makes callers omit the disposition entirely.
 *
 * Lives in `common/` rather than beside the `signed_url` pipeline handler that
 * originally owned it because the local-filesystem download route
 * (`storage/local-presigned-download.controller.ts`) is the other side of the
 * same contract: it re-sanitizes the `dl` query param before writing the
 * header, since a signed URL is minted once but replayed by an untrusted
 * client. A `storage/` → `pipelines/` import would invert the dependency
 * direction for a five-line pure function.
 */
export function sanitizeDownloadFilename(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const basename = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = basename
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .trim()
    .slice(0, 200);

  return cleaned || undefined;
}

/**
 * Percent-encode a filename for the RFC 5987 `ext-value` production used by
 * `filename*`.
 *
 * `encodeURIComponent` leaves `!'()*` unescaped, but RFC 5987's `attr-char`
 * set excludes them, so they are escaped here too.
 */
function encodeExtValue(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Build a `Content-Disposition: attachment` header value that is safe to hand
 * to `res.setHeader` for ANY filename, including non-ASCII ones.
 *
 * Node validates header values against `[\t\x20-\x7e\x80-\xff]` and throws
 * `ERR_INVALID_CHAR` on anything outside it — so a filename containing U+202F
 * (every macOS screenshot carries one between the time and AM/PM) or CJK text
 * turns a signed download into a 500. Latin-1 characters don't throw but are
 * mis-decoded by browsers, which is the same class of bug one step quieter.
 *
 * So: anything non-ASCII gets the RFC 6266 dual form — a folded ASCII
 * `filename="..."` that legacy clients can still read, plus the real name in
 * `filename*=UTF-8''...` which every current browser prefers. A purely ASCII
 * filename is emitted in the plain quoted form alone, byte-identical to what
 * a client saw before this existed.
 *
 * @param filename MUST already be through {@link sanitizeDownloadFilename} —
 *                 quotes, backslashes and control characters are assumed gone.
 */
export function formatAttachmentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const nonAscii = /[^\x20-\x7e]/;
  if (!nonAscii.test(filename)) {
    return `attachment; filename="${filename}"`;
  }

  // Fold every run of non-ASCII to a single `_` so the fallback stays
  // recognisable (`Screenshot 7.44.31_AM.png`) rather than becoming a
  // run-together mess.
  const stripped = filename
    .replace(new RegExp(nonAscii.source, 'g'), '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();

  // A wholly non-ASCII name leaves nothing (`文件` → ``) or a bare extension
  // (`文件.png` → `.png`). Neither is a filename a client should be offered,
  // so give the fallback a real stem while keeping any extension.
  const folded = !stripped || stripped.startsWith('.') ? `download${stripped}` : stripped;

  return `attachment; filename="${folded}"; filename*=UTF-8''${encodeExtValue(filename)}`;
}
