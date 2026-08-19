import { describe, it, expect } from 'vitest';
import type { StorageProvider } from '@/services/setupApi';
import {
  DOCS,
  VIDEOS,
  CLOUDFLARE_DOCS,
  storageDocsFor,
  youtubeUrl,
  formatTimestamp,
} from './docsLinks';

/** Depth-first walk of the DOCS tree, yielding [dottedPath, url] for every leaf. */
function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === 'string') return [[path.join('.'), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, [...path, k]),
  );
}

describe('DOCS registry', () => {
  const entries = leaves(DOCS);

  it('has entries to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s is an absolute docs.bffless.dev URL', (_path, url) => {
    expect(url.startsWith('https://docs.bffless.dev/')).toBe(true);
  });

  it.each(entries)('%s path ends in a trailing slash before any anchor', (_path, url) => {
    // Docusaurus redirects a slash-less path, and the redirect drops the
    // fragment — so a missing trailing slash silently breaks a deep link.
    const [pathname] = url.split('#');
    expect(pathname.endsWith('/')).toBe(true);
  });

  it.each(entries)('%s uses a lowercase-kebab anchor if it has one', (_path, url) => {
    const [, fragment] = url.split('#');
    if (fragment === undefined) return;
    expect(`#${fragment}`).toMatch(/^#[a-z0-9-]+$/);
  });

  it('pins the Cloudflare anchors verified against the live site', () => {
    expect(DOCS.cloudflare.dns).toBe(
      'https://docs.bffless.dev/getting-started/cloudflare-setup/#step-5-create-dns-records',
    );
    expect(DOCS.cloudflare.cert).toBe(
      'https://docs.bffless.dev/getting-started/cloudflare-setup/#step-6-generate-an-origin-certificate',
    );
  });
});

describe('storageDocsFor', () => {
  const storageUrls = Object.values(DOCS.storage);

  it.each(['s3', 'gcs', 'azure', 'minio'] as StorageProvider[])(
    'returns a registry URL and a label for %s',
    (provider) => {
      const entry = storageDocsFor(provider);
      expect(entry).not.toBeNull();
      expect(storageUrls).toContain(entry!.href);
      expect(entry!.label.length).toBeGreaterThan(0);
    },
  );

  it.each(['local', 'managed'] as StorageProvider[])(
    'returns null for %s, which has no dedicated setup guide',
    (provider) => {
      expect(storageDocsFor(provider)).toBeNull();
    },
  );
});

describe('CLOUDFLARE_DOCS', () => {
  it.each(['dns', 'cert'] as const)(
    '%s pairs a DOCS.cloudflare href with a non-empty label',
    (key) => {
      expect(CLOUDFLARE_DOCS[key].href).toBe(DOCS.cloudflare[key]);
      expect(CLOUDFLARE_DOCS[key].label.length).toBeGreaterThan(0);
    },
  );
});

describe('youtubeUrl', () => {
  it('appends the start time as a t= query param', () => {
    expect(youtubeUrl('zTGi5M0mcCo', 249)).toBe('https://youtu.be/zTGi5M0mcCo?t=249');
  });

  it('omits the query string entirely when no start is given', () => {
    expect(youtubeUrl('zTGi5M0mcCo')).toBe('https://youtu.be/zTGi5M0mcCo');
  });

  it('omits the query string for a zero start', () => {
    expect(youtubeUrl('zTGi5M0mcCo', 0)).toBe('https://youtu.be/zTGi5M0mcCo');
  });
});

describe('formatTimestamp', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatTimestamp(249)).toBe('4:09');
  });

  it('formats a sub-minute value with a zero minutes part', () => {
    expect(formatTimestamp(59)).toBe('0:59');
  });

  it('rolls past an hour into minutes rather than an hours field', () => {
    expect(formatTimestamp(3600)).toBe('60:00');
  });
});

describe('VIDEOS', () => {
  it('carries the Cloudflare walkthrough with per-step start times', () => {
    expect(VIDEOS.cloudflareSetup.id).toBe('zTGi5M0mcCo');
    expect(VIDEOS.cloudflareSetup.dnsStart).toBe(249);
    expect(VIDEOS.cloudflareSetup.certStart).toBeGreaterThanOrEqual(249);
  });
});
