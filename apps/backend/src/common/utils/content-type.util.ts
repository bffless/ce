import path from 'path';

import * as mime from 'mime-types';

/** What both storage and HTTP mean by "I don't know what this is". */
const UNKNOWN_TYPE = 'application/octet-stream';

/**
 * Append `charset=utf-8` when the type is text-ish and carries no charset of
 * its own.
 *
 * Without it a browser falls back to windows-1252 for `text/*` and mangles
 * every non-ASCII byte (`·` → `Â·`). A charset already on the value is
 * preserved verbatim — the object may genuinely not be UTF-8.
 */
function withCharset(contentType: string): string {
  if (/;\s*charset=/i.test(contentType)) {
    return contentType;
  }
  const base = contentType.split(';')[0].trim();
  return mime.charsets.lookup(base) ? `${contentType}; charset=utf-8` : contentType;
}

/**
 * Resolve the `Content-Type` to serve an object with.
 *
 * Prefers the type storage recorded for the object, falling back to the key's
 * extension. A stored `application/octet-stream` counts as "unknown" rather
 * than as an answer, so a known extension still wins over it — that value is
 * what an adapter reports when the uploader sent nothing useful.
 *
 * @param key         Storage key or filename the object is served under.
 * @param storedType  Content type storage reports for the object, if any.
 */
export function resolveContentType(key: string, storedType?: string | null): string {
  const stored = storedType?.trim();
  if (stored && stored.split(';')[0].trim().toLowerCase() !== UNKNOWN_TYPE) {
    return withCharset(stored);
  }

  // Look the extension up, never the whole key: `mime.contentType()` treats any
  // string containing a `/` as a MIME type rather than a path, and storage keys
  // always contain slashes.
  const fromExtension = mime.contentType(path.extname(key));
  return fromExtension ? withCharset(fromExtension) : UNKNOWN_TYPE;
}
