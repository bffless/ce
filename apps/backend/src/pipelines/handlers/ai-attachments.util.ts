import type { FilePart, ImagePart } from 'ai';

/**
 * Attachment entry on an ai_handler step config (completion mode only).
 */
export interface AIAttachmentConfig {
  /** 'image' for vision inputs; 'file' for other media (requires mediaType). */
  type: 'image' | 'file';
  /**
   * Expression resolving to a URL string or an array of URL strings
   * (e.g. "steps.collect.images"). Arrays fan out into one part per element.
   */
  source: string;
  /** MIME type for 'file' attachments (e.g. "audio/mpeg"). */
  mediaType?: string;
}

/**
 * Resolve ai_handler attachment configs into AI SDK message parts.
 *
 * Empty, null, and non-string resolved values are skipped silently so
 * conditional attachments (e.g. optional signed-url steps) just work.
 * URLs are passed through for the provider to fetch — no bytes move
 * through CE.
 */
export function buildAttachmentParts(
  attachments: AIAttachmentConfig[],
  resolveSource: (expression: string) => unknown,
): Array<ImagePart | FilePart> {
  const parts: Array<ImagePart | FilePart> = [];

  for (const attachment of attachments) {
    const resolved = resolveSource(attachment.source);
    const values = Array.isArray(resolved) ? resolved : [resolved];

    for (const value of values) {
      if (typeof value !== 'string' || value.trim() === '') {
        continue;
      }

      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(
          `Attachment source '${attachment.source}' resolved to an invalid URL: ${value}`,
        );
      }

      if (attachment.type === 'image') {
        parts.push({ type: 'image', image: url });
      } else {
        parts.push({ type: 'file', data: url, mediaType: attachment.mediaType ?? '' });
      }
    }
  }

  return parts;
}
