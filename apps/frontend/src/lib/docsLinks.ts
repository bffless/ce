import type { StorageProvider } from '@/services/setupApi';

const DOCS_BASE = 'https://docs.bffless.dev';

/**
 * Every docs.bffless.dev URL used by the admin portal.
 *
 * Deep-link anchors are Docusaurus heading slugs and DO drift: the Cloudflare
 * DNS step moved from Step 4 to Step 5 when the web-bootstrap step was added.
 * Keeping them here makes a docs restructure a one-file audit. All anchors
 * below were verified against the live site on 2026-07-26 — note that a local
 * `docs-public` checkout may be behind and disagree.
 *
 * Trailing slashes are required: Docusaurus redirects a slash-less path and
 * the redirect drops the fragment, silently landing the reader at the top of
 * the page. `docsLinks.test.ts` enforces this.
 */
export const DOCS = {
  storage: {
    overview: `${DOCS_BASE}/storage/overview/`,
    gcs: `${DOCS_BASE}/storage/google-cloud-storage/`,
    s3: `${DOCS_BASE}/storage/aws-s3/`,
    azure: `${DOCS_BASE}/storage/azure-blob-storage/`,
    minio: `${DOCS_BASE}/storage/minio/`,
    migration: `${DOCS_BASE}/storage/migration-guide/`,
  },
  cloudflare: {
    dns: `${DOCS_BASE}/getting-started/cloudflare-setup/#step-5-create-dns-records`,
    cert: `${DOCS_BASE}/getting-started/cloudflare-setup/#step-6-generate-an-origin-certificate`,
  },
  letsencrypt: {
    dns: `${DOCS_BASE}/getting-started/letsencrypt-setup/#step-2-configure-dns-records`,
  },
  gettingStarted: {
    firstDeployment: `${DOCS_BASE}/getting-started/first-deployment/`,
  },
} as const;

/**
 * YouTube walkthroughs referenced from the portal.
 *
 * `dnsStart` and `certStart` are separate fields on purpose: they currently
 * share a value (the start of the Cloudflare section) but point at different
 * moments in the walkthrough, so the certificate one can be refined without
 * touching any component.
 */
export const VIDEOS = {
  cloudflareSetup: { id: 'zTGi5M0mcCo', dnsStart: 249, certStart: 293 },
  firstDeployment: { id: 'cNqh02HyD0s', title: 'BFFless: your first deployment' },
} as const;

/**
 * Docs entry for a storage provider, or null when the provider has no
 * dedicated setup guide.
 *
 * The exhaustive Record — rather than a lookup with a default — means adding a
 * member to the StorageProvider union fails type-checking here until someone
 * decides what it should link to.
 */
const STORAGE_DOCS: Record<StorageProvider, { href: string; label: string } | null> = {
  gcs: { href: DOCS.storage.gcs, label: 'Google Cloud Storage setup guide' },
  s3: { href: DOCS.storage.s3, label: 'S3 setup guide' },
  azure: { href: DOCS.storage.azure, label: 'Azure Blob Storage setup guide' },
  minio: { href: DOCS.storage.minio, label: 'MinIO setup guide' },
  // Local filesystem is a paragraph inside the storage overview, not a setup
  // guide — there are no credentials to go and fetch. Managed storage is
  // configured by the platform and has nothing for an operator to read.
  local: null,
  managed: null,
};

export function storageDocsFor(
  provider: StorageProvider,
): { href: string; label: string } | null {
  return STORAGE_DOCS[provider] ?? null;
}

/**
 * Cloudflare doc links, paired with their label.
 *
 * A sibling export rather than nesting `{ href, label }` objects under `DOCS`
 * itself: `docsLinks.test.ts` walks every string leaf under `DOCS` and asserts
 * it's an absolute `docs.bffless.dev` URL, so a label string living inside
 * that tree would fail the walk. Shaped like `STORAGE_DOCS` above, minus the
 * per-provider lookup function since there are only the two fixed keys.
 */
export const CLOUDFLARE_DOCS = {
  dns: { href: DOCS.cloudflare.dns, label: 'Creating your Cloudflare DNS records' },
  cert: { href: DOCS.cloudflare.cert, label: 'Generating a Cloudflare Origin Certificate' },
} as const;

/** Share-style watch URL, optionally seeked to `startSeconds`. */
export function youtubeUrl(id: string, startSeconds?: number): string {
  const base = `https://youtu.be/${id}`;
  return startSeconds ? `${base}?t=${startSeconds}` : base;
}

/** 249 -> "4:09". Minutes are not rolled into hours; our clips are short. */
export function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
