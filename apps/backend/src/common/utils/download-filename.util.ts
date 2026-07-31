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
