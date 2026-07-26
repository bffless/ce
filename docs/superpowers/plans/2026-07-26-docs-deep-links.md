# Docs Deep Links in Onboarding and Day 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a link to the matching `docs.bffless.dev` page (and, for Cloudflare, a timestamped video link) at the exact moment the setup wizard or `/admin/settings/infrastructure` asks them to configure storage or domain/SSL.

**Architecture:** One registry module (`lib/docsLinks.ts`) owns every docs URL and video reference; one component module (`components/common/DocsLink.tsx`) owns the three presentations (bordered row, inline anchor, watch link). Nine call sites consume them. No component writes a `docs.bffless.dev` literal.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + `@testing-library/react`, Tailwind, lucide-react icons, shadcn-style `@/components/ui/*` primitives.

**Spec:** `docs/superpowers/specs/2026-07-26-docs-deep-links-onboarding-day2-design.md`

## Global Constraints

- **Worktree:** all work happens in `repos/ce/.claude/worktrees/docs-deep-links` on branch `feat/docs-deep-links`. Never commit to the shared `repos/ce` checkout on `main`.
- **Frontend only.** No backend, schema, or migration changes. All paths below are relative to `apps/frontend/`.
- **No docs-site literals outside the registry.** After this change, `grep -rn "docs\.bffless" apps/frontend/src --include='*.tsx' --include='*.ts'` must match only `src/lib/docsLinks.ts` and test files.
- **The local `repos/docs-public` checkout is stale.** Anchors below were verified against the *live* site on 2026-07-26. Do not "correct" them against local markdown headings.
- **Every external link** renders `target="_blank"` and `rel="noopener noreferrer"`.
- **Brand accent is `#d96459`**, used as an arbitrary Tailwind value exactly as `WelcomeStep.tsx` does today (`text-[#d96459]`, `hover:border-[#d96459]/50`).
- **Test commands** (run from `apps/frontend/`): single file `pnpm test:run <pattern>`; full suite `pnpm test`; types `pnpm exec tsc --noEmit`; lint `pnpm lint`.
- **`pnpm lint` ALREADY FAILS on `main`** — 58 pre-existing problems (30 errors, 28 warnings), verified on the `main` checkout at e779c38. A non-zero lint exit is therefore NOT a signal you broke something. The check that matters: `pnpm lint 2>&1 | grep -E "<files you changed>"` must produce **no output**. Do not attempt to fix the pre-existing failures — they are out of scope for this plan.
- **`pnpm exec tsc --noEmit` IS clean on `main`** and must stay clean. A type error is yours.
- **`StorageProvider`** is `'local' | 'minio' | 's3' | 'gcs' | 'azure' | 'managed'`, exported from `@/services/setupApi`.

---

### Task 1: The docs link registry

Creates the single source of truth for URLs, the provider→docs mapping, and the two URL/format helpers. Nothing renders yet; this task is pure data plus functions, fully covered by tests.

**Files:**
- Create: `apps/frontend/src/lib/docsLinks.ts`
- Test: `apps/frontend/src/lib/docsLinks.test.ts`

**Interfaces:**
- Consumes: `StorageProvider` from `@/services/setupApi`.
- Produces:
  - `DOCS` — nested readonly object of absolute URLs (shape in Step 3).
  - `VIDEOS` — readonly object; `VIDEOS.cloudflareSetup = { id, dnsStart, certStart }`, `VIDEOS.firstDeployment = { id, title }`.
  - `storageDocsFor(provider: StorageProvider): { href: string; label: string } | null`
  - `youtubeUrl(id: string, startSeconds?: number): string`
  - `formatTimestamp(seconds: number): string`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/docsLinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { StorageProvider } from '@/services/setupApi';
import { DOCS, VIDEOS, storageDocsFor, youtubeUrl, formatTimestamp } from './docsLinks';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && pnpm test:run docsLinks`
Expected: FAIL — `Failed to resolve import "./docsLinks"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/lib/docsLinks.ts`:

```ts
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
  cloudflareSetup: { id: 'zTGi5M0mcCo', dnsStart: 249, certStart: 249 },
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && pnpm test:run docsLinks`
Expected: PASS, all cases green.

- [ ] **Step 5: Verify types and lint**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: `tsc` clean (a type error is yours). `pnpm lint` exits non-zero from 58 pre-existing problems on `main` — that is the baseline, not your regression. Confirm you added none: `pnpm lint 2>&1 | grep -E "<files you changed>"` must print nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/docsLinks.ts apps/frontend/src/lib/docsLinks.test.ts
git commit -m "feat(frontend): add docs link registry with provider mapping and video helpers"
```

---

### Task 2: The three link presentations, and WelcomeStep refactor

Extracts `WelcomeStep`'s bordered row into a reusable component and adds the inline + watch variants. `WelcomeStep` becomes the first consumer, which proves the extraction is faithful — its existing tests must keep passing unchanged.

**Files:**
- Create: `apps/frontend/src/components/common/DocsLink.tsx`
- Create: `apps/frontend/src/components/common/DocsLink.test.tsx`
- Modify: `apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx`
- Modify: `apps/frontend/src/components/setup/onboarding/WelcomeStep.test.tsx`

**Interfaces:**
- Consumes: `youtubeUrl`, `formatTimestamp` from `@/lib/docsLinks` (Task 1); `DOCS`, `VIDEOS` in the `WelcomeStep` refactor.
- Produces:
  - `<DocsLink href={string} label={string} />` — bordered row.
  - `<DocsInlineLink href={string}>{children}</DocsInlineLink>` — inline anchor.
  - `<WatchLink videoId={string} start={number} />` — compact play link, label `Watch this step (M:SS)`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/common/DocsLink.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DocsLink, DocsInlineLink, WatchLink } from './DocsLink';

describe('DocsLink', () => {
  afterEach(cleanup);

  it('renders the label as a new-tab link to href', () => {
    render(<DocsLink href="https://docs.bffless.dev/storage/aws-s3/" label="S3 setup guide" />);

    const link = screen.getByRole('link', { name: /S3 setup guide/ });
    expect(link).toHaveAttribute('href', 'https://docs.bffless.dev/storage/aws-s3/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('DocsInlineLink', () => {
  afterEach(cleanup);

  it('renders its children as a new-tab link', () => {
    render(
      <DocsInlineLink href="https://docs.bffless.dev/storage/minio/">
        View the MinIO setup guide
      </DocsInlineLink>,
    );

    const link = screen.getByRole('link', { name: /View the MinIO setup guide/ });
    expect(link).toHaveAttribute('href', 'https://docs.bffless.dev/storage/minio/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('WatchLink', () => {
  afterEach(cleanup);

  it('links to the seeked share URL and labels itself with the timestamp', () => {
    render(<WatchLink videoId="zTGi5M0mcCo" start={249} />);

    const link = screen.getByRole('link', { name: /Watch this step \(4:09\)/ });
    expect(link).toHaveAttribute('href', 'https://youtu.be/zTGi5M0mcCo?t=249');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does not mount an iframe — it is a text link, not an embed', () => {
    const { container } = render(<WatchLink videoId="zTGi5M0mcCo" start={249} />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && pnpm test:run DocsLink`
Expected: FAIL — `Failed to resolve import "./DocsLink"`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/components/common/DocsLink.tsx`:

```tsx
import type { ReactNode } from 'react';
import { BookOpen, ExternalLink, Play } from 'lucide-react';
import { formatTimestamp, youtubeUrl } from '@/lib/docsLinks';

interface DocsLinkProps {
  href: string;
  label: string;
}

/**
 * Prominent bordered row pointing at a docs page.
 *
 * Reserved for the setup wizard, where the operator is mid-task and may be
 * blocked: the link has to be unmissable. Day-2 settings pages use
 * DocsInlineLink instead — the reader there already succeeded once and the
 * pages are dense.
 */
export function DocsLink({ href, label }: DocsLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:border-[#d96459]/50 hover:bg-muted/50"
    >
      <BookOpen className="h-4 w-4 flex-shrink-0 text-[#d96459]" />
      <span className="font-medium">{label}</span>
      <ExternalLink className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
    </a>
  );
}

interface DocsInlineLinkProps {
  href: string;
  children: ReactNode;
}

/** Quiet inline anchor, sized to flow inside body copy or a CardDescription. */
export function DocsInlineLink({ href, children }: DocsInlineLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
    >
      {children}
      <ExternalLink className="h-3 w-3 flex-shrink-0" />
    </a>
  );
}

interface WatchLinkProps {
  videoId: string;
  start: number;
}

/**
 * Compact link opening the walkthrough at a given moment.
 *
 * Deliberately not an embed: on a wizard step the operator is already
 * alt-tabbing to a third-party dashboard, and a 16:9 player inside the form
 * competes with the fields it is meant to explain. WelcomeStep keeps its
 * facade embed because there, watching IS the task.
 */
export function WatchLink({ videoId, start }: WatchLinkProps) {
  return (
    <a
      href={youtubeUrl(videoId, start)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <Play className="h-3.5 w-3.5 flex-shrink-0 fill-current" />
      <span>Watch this step ({formatTimestamp(start)})</span>
    </a>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && pnpm test:run DocsLink`
Expected: PASS.

- [ ] **Step 5: Refactor WelcomeStep onto the shared row and registry**

In `apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx`:

Replace the import block and the three module consts:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsLink } from '@/components/common/DocsLink';

const VIDEO_ID = VIDEOS.firstDeployment.id;
const VIDEO_TITLE = VIDEOS.firstDeployment.title;
const DOCS_URL = DOCS.gettingStarted.firstDeployment;
```

Note `BookOpen` and `ExternalLink` are no longer imported here — they moved into `DocsLink`. `Play` is still used by the facade's play button.

Then replace the whole `<a href={DOCS_URL} …>…</a>` element (currently the block between the video `</div>` and `<div className="flex justify-between pt-4">`) with:

```tsx
      <DocsLink href={DOCS_URL} label="Read the first-deployment guide" />
```

Leave the facade embed, its `useState` hooks, and the button row untouched.

- [ ] **Step 6: Run WelcomeStep's existing tests unchanged**

Run: `cd apps/frontend && pnpm test:run WelcomeStep`
Expected: PASS, all four cases. The suite is unmodified at this point on purpose — it is the proof that the extraction preserved behaviour (href, target, rel, accessible name, and the facade).

If the "links to the first-deployment guide" case fails on the accessible name, the extraction changed the label text — fix `DocsLink`'s usage, not the test.

- [ ] **Step 7: Point WelcomeStep's test at the registry**

In `apps/frontend/src/components/setup/onboarding/WelcomeStep.test.tsx`, replace the hardcoded const with the registry value so the test tracks a future docs move:

```tsx
import { DOCS } from '@/lib/docsLinks';

const DOCS_URL = DOCS.gettingStarted.firstDeployment;
```

Delete the old `const DOCS_URL = 'https://docs.bffless.dev/getting-started/first-deployment/';` line. Leave every `it(...)` block as-is — `docsLinks.test.ts` is what pins the literal URL now.

- [ ] **Step 8: Run the tests again**

Run: `cd apps/frontend && pnpm test:run WelcomeStep DocsLink docsLinks`
Expected: PASS.

- [ ] **Step 9: Verify types and lint**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: `tsc` clean (a type error is yours). `pnpm lint` exits non-zero from 58 pre-existing problems on `main` — that is the baseline, not your regression. Confirm you added none: `pnpm lint 2>&1 | grep -E "<files you changed>"` must print nothing. Watch for an unused `BookOpen`/`ExternalLink` import left in `WelcomeStep.tsx`.

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/components/common/DocsLink.tsx apps/frontend/src/components/common/DocsLink.test.tsx apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx apps/frontend/src/components/setup/onboarding/WelcomeStep.test.tsx
git commit -m "feat(frontend): extract DocsLink row, add inline and watch link variants"
```

---

### Task 3: Storage step in the setup wizard

The first real payoff: picking GCS in the wizard now offers the guide that explains where a Project ID and service-account JSON come from.

**Files:**
- Modify: `apps/frontend/src/components/setup/StorageStep.tsx` (import block at top; render, immediately after the provider `Select` block that ends around line 358)

**Interfaces:**
- Consumes: `storageDocsFor` from `@/lib/docsLinks`, `DocsLink` from `@/components/common/DocsLink` (Tasks 1–2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the imports**

In `apps/frontend/src/components/setup/StorageStep.tsx`, after the existing `@/components/ui/*` imports, add:

```tsx
import { storageDocsFor } from '@/lib/docsLinks';
import { DocsLink } from '@/components/common/DocsLink';
```

- [ ] **Step 2: Derive the docs entry**

Inside `StorageStep`, after the existing `const minioAvailable = …` derivation, add:

```tsx
  // Null for local/managed — neither has a setup guide worth interrupting the
  // form for, and storageDocsFor encodes that decision once.
  const providerDocs = storageProvider ? storageDocsFor(storageProvider) : null;
```

- [ ] **Step 3: Render the row under the provider select**

Find the provider selection block — the `<div>` containing `<Label>Storage Provider</Label>` and the `<Select>`, which closes with `</Select>` then `</div>` just before the `{/* Managed Storage (Platform-provided) */}` comment. Immediately after that closing `</div>` and before the Managed Storage comment, insert:

```tsx
      {providerDocs && <DocsLink href={providerDocs.href} label={providerDocs.label} />}
```

- [ ] **Step 4: Verify it renders and nothing regressed**

Run: `cd apps/frontend && pnpm test:run StorageStep`
Expected: PASS (existing suite; no new assertions added — the links are static markup and `docsLinks.test.ts` covers the mapping).

- [ ] **Step 5: Verify types and lint**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: `tsc` clean (a type error is yours). `pnpm lint` exits non-zero from 58 pre-existing problems on `main` — that is the baseline, not your regression. Confirm you added none: `pnpm lint 2>&1 | grep -E "<files you changed>"` must print nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/setup/StorageStep.tsx
git commit -m "feat(setup): link the storage step to the selected provider's setup guide"
```

---

### Task 4: Cloudflare DNS and origin-certificate steps

The two wizard phases that describe work inside somebody else's dashboard. Both get a docs deep link; both get the timestamped video link.

**Files:**
- Modify: `apps/frontend/src/components/setup/domain-ssl/DomainDnsPhase.tsx`
- Modify: `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx`

**Interfaces:**
- Consumes: `DOCS`, `VIDEOS` from `@/lib/docsLinks`; `DocsLink`, `WatchLink` from `@/components/common/DocsLink`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add imports to DomainDnsPhase**

In `apps/frontend/src/components/setup/domain-ssl/DomainDnsPhase.tsx`, after the `lucide-react` import, add:

```tsx
import { DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsLink, WatchLink } from '@/components/common/DocsLink';
```

- [ ] **Step 2: Render the links under the per-mode description**

The component's first child is a `<div>` holding the `<h3>` and the three `{servingMode === …}` paragraphs, closing with `</div>` just before the `<div>` containing `<Label htmlFor="bootstrap-domain">`. Insert this immediately after the `{servingMode === 'none' && (…)}` block, still inside that first `<div>`:

```tsx
        {servingMode === 'cloudflare' && (
          <div className="mt-3">
            <DocsLink href={DOCS.cloudflare.dns} label="Creating your Cloudflare DNS records" />
            <WatchLink
              videoId={VIDEOS.cloudflareSetup.id}
              start={VIDEOS.cloudflareSetup.dnsStart}
            />
          </div>
        )}
        {isLetsEncrypt && (
          <div className="mt-3">
            <DocsLink href={DOCS.letsencrypt.dns} label="Configuring DNS for Let's Encrypt" />
          </div>
        )}
```

`isLetsEncrypt` is already computed at the top of the component as `servingMode === 'none' && bootstrapSslMode === 'letsencrypt'`. Note what is deliberately absent: `servingMode === 'proxy'` gets no link, because the work happens in the operator's own CDN dashboard and our docs cannot describe it.

- [ ] **Step 3: Verify DomainDnsPhase**

Run: `cd apps/frontend && pnpm test:run DomainDnsPhase`
Expected: PASS if a suite exists for it; "No test files found" is an acceptable result — proceed.

- [ ] **Step 4: Widen the PasteCertificateForm COPY record**

In `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx`, add the imports after the existing `PasteCertificateFields` import:

```tsx
import { DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsLink, WatchLink } from '@/components/common/DocsLink';
```

Then change the `COPY` type annotation from:

```tsx
const COPY: Record<ServingMode, { title: string; certLabel: string; body: JSX.Element }> = {
```

to:

```tsx
// docs/video are optional: only the Cloudflare path has a guide of ours to
// point at. A CDN's or a public CA's issuance flow is theirs to document, and
// omitting the fields keeps that decision visible next to the copy it applies to.
const COPY: Record<
  ServingMode,
  {
    title: string;
    certLabel: string;
    body: JSX.Element;
    docs?: { href: string; label: string };
    video?: { id: string; start: number };
  }
> = {
```

- [ ] **Step 5: Populate the cloudflare entry**

Inside the `cloudflare:` entry of `COPY`, after its `body` property, add:

```tsx
    docs: { href: DOCS.cloudflare.cert, label: 'Generating a Cloudflare Origin Certificate' },
    video: { id: VIDEOS.cloudflareSetup.id, start: VIDEOS.cloudflareSetup.certStart },
```

Leave the `proxy` and `none` entries untouched — they opt out by omission.

- [ ] **Step 6: Render them beneath the body copy**

In the JSX, find where `copy.body` is rendered (inside the paragraph under the `copy.title` heading). Immediately after that paragraph's closing tag, insert:

```tsx
        {copy.docs && (
          <div className="mt-3">
            <DocsLink href={copy.docs.href} label={copy.docs.label} />
            {copy.video && <WatchLink videoId={copy.video.id} start={copy.video.start} />}
          </div>
        )}
```

- [ ] **Step 7: Verify the SSL wizard suites still pass**

Run: `cd apps/frontend && pnpm test:run PasteCertificate DomainSsl`
Expected: PASS, or "No test files found" for a pattern with no suite.

- [ ] **Step 8: Verify types and lint**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: `tsc` clean (a type error is yours). `pnpm lint` exits non-zero from 58 pre-existing problems on `main` — that is the baseline, not your regression. Confirm you added none: `pnpm lint 2>&1 | grep -E "<files you changed>"` must print nothing.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/components/setup/domain-ssl/DomainDnsPhase.tsx apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx
git commit -m "feat(setup): link Cloudflare DNS and origin-cert steps to docs and walkthrough"
```

---

### Task 5: Day-2 storage surfaces

Three inline links on `/admin/settings/infrastructure`: the storage card, the credential editor, and the migration wizard's configure step.

**Files:**
- Modify: `apps/frontend/src/components/settings/StorageSettings.tsx`
- Modify: `apps/frontend/src/components/storage/EditStorageCredentials.tsx`
- Modify: `apps/frontend/src/components/storage/MigrationWizard.tsx`

**Interfaces:**
- Consumes: `storageDocsFor` from `@/lib/docsLinks`, `DocsInlineLink` from `@/components/common/DocsLink`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: StorageSettings — imports and derivation**

In `apps/frontend/src/components/settings/StorageSettings.tsx`, add after the existing `@/components/…` imports:

```tsx
import { storageDocsFor } from '@/lib/docsLinks';
import { DocsInlineLink } from '@/components/common/DocsLink';
```

Then, next to the existing `const providerName = getProviderDisplayName(currentProvider, isS3Compatible);` (around line 113), add:

```tsx
  // currentProvider is a string off the status response, so it may be
  // 'unknown' before the query settles — narrow through storageDocsFor, which
  // returns null for anything without a guide.
  const providerDocs = storageDocsFor(currentProvider as StorageProvider);
```

`StorageProvider` is already imported in this file; if it is not, add it to the existing `@/services/setupApi` import.

- [ ] **Step 2: StorageSettings — render the link under the provider name**

In the "Current Provider" block, find:

```tsx
                <p className="text-sm text-muted-foreground">{providerName}</p>
```

Replace it with:

```tsx
                <p className="text-sm text-muted-foreground">{providerName}</p>
                {providerDocs && (
                  <p className="text-sm text-muted-foreground">
                    <DocsInlineLink href={providerDocs.href}>
                      View the {providerName} setup guide
                    </DocsInlineLink>
                  </p>
                )}
```

- [ ] **Step 3: EditStorageCredentials — imports and link**

In `apps/frontend/src/components/storage/EditStorageCredentials.tsx`, add after the `lucide-react` import:

```tsx
import { storageDocsFor } from '@/lib/docsLinks';
import { DocsInlineLink } from '@/components/common/DocsLink';
```

Next to the existing `const providerLabel = providerLabels[currentProvider] || currentProvider;` (around line 96), add:

```tsx
  const providerDocs = storageDocsFor(currentProvider);
```

Then extend the `CardDescription` (around line 402) from:

```tsx
        <CardDescription>
          Update the connection details for your current storage provider — for example, rotating an
          access key — without migrating any files.
        </CardDescription>
```

to:

```tsx
        <CardDescription>
          Update the connection details for your current storage provider — for example, rotating an
          access key — without migrating any files.
          {providerDocs && (
            <>
              {' '}
              <DocsInlineLink href={providerDocs.href}>
                Where to find these values
              </DocsInlineLink>
            </>
          )}
        </CardDescription>
```

- [ ] **Step 4: MigrationWizard — imports and link on the configure step**

In `apps/frontend/src/components/storage/MigrationWizard.tsx`, add after the existing `@/services/…` imports:

```tsx
import { storageDocsFor } from '@/lib/docsLinks';
import { DocsInlineLink } from '@/components/common/DocsLink';
```

Find the Step 2 block (around line 832):

```tsx
      {step === 'configure' && targetProvider && (
        <Card>
          <CardHeader>
            <CardTitle>Configure {storageProviders.find((p) => p.value === targetProvider)?.label}</CardTitle>
            <CardDescription>Enter your storage credentials</CardDescription>
          </CardHeader>
```

Replace that `CardDescription` line with:

```tsx
            <CardDescription>
              Enter your storage credentials.
              {storageDocsFor(targetProvider) && (
                <>
                  {' '}
                  <DocsInlineLink href={storageDocsFor(targetProvider)!.href}>
                    {storageDocsFor(targetProvider)!.label}
                  </DocsInlineLink>
                </>
              )}
            </CardDescription>
```

This is the one moment an operator deliberately picks a backend they have not used before, which is why it earns a link at all.

- [ ] **Step 5: Run the storage-related suites**

Run: `cd apps/frontend && pnpm test:run StorageSettings MigrationWizard EditStorageCredentials MySitesSection`
Expected: PASS, or "No test files found" for patterns without a suite.

- [ ] **Step 6: Verify types and lint**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: `tsc` clean (a type error is yours). `pnpm lint` exits non-zero from 58 pre-existing problems on `main` — that is the baseline, not your regression. Confirm you added none: `pnpm lint 2>&1 | grep -E "<files you changed>"` must print nothing. A type error on `storageDocsFor(currentProvider as StorageProvider)` means the `StorageProvider` import is missing in `StorageSettings.tsx` — add it to the `@/services/setupApi` import.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/settings/StorageSettings.tsx apps/frontend/src/components/storage/EditStorageCredentials.tsx apps/frontend/src/components/storage/MigrationWizard.tsx
git commit -m "feat(settings): link day-2 storage surfaces to provider setup guides"
```

---

### Task 6: Day-2 SSL editor, and full verification

The last wire-up, plus the whole-suite and browser checks that close out the change.

**Files:**
- Modify: `apps/frontend/src/components/settings/primary-ssl/ServingModelEditor.tsx`

**Interfaces:**
- Consumes: `DOCS`, `VIDEOS` from `@/lib/docsLinks`; `DocsInlineLink`, `WatchLink` from `@/components/common/DocsLink`.
- Produces: nothing.

- [ ] **Step 1: Add the imports**

In `apps/frontend/src/components/settings/primary-ssl/ServingModelEditor.tsx`, after the existing `@/components/ssl-leaves/…` imports, add:

```tsx
import { DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsInlineLink, WatchLink } from '@/components/common/DocsLink';
```

- [ ] **Step 2: Render the Cloudflare links beside the paste fields**

Find the `{value.sslMode === 'paste' && (` block (around line 202) and insert this as the first child of its `<div className="space-y-4">`, above `<PasteCertificateFields …>`:

```tsx
          {value.servingMode === 'cloudflare' && (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Need a certificate?{' '}
                <DocsInlineLink href={DOCS.cloudflare.cert}>
                  Generating a Cloudflare Origin Certificate
                </DocsInlineLink>
                {' · '}
                <DocsInlineLink href={DOCS.cloudflare.dns}>
                  Creating DNS records
                </DocsInlineLink>
              </p>
              <WatchLink
                videoId={VIDEOS.cloudflareSetup.id}
                start={VIDEOS.cloudflareSetup.certStart}
              />
            </div>
          )}
```

Inline treatment here, not a bordered row: this is a settings page, and the operator reaching it already stood the instance up once.

- [ ] **Step 3: Run the SSL suites**

Run: `cd apps/frontend && pnpm test:run ServingModelEditor PrimarySsl ssl-leaves`
Expected: PASS, or "No test files found" for patterns without a suite.

- [ ] **Step 4: Confirm no docs literal escaped the registry**

Run:

```bash
grep -rn "docs\.bffless" apps/frontend/src --include='*.tsx' --include='*.ts'
```

Expected: matches ONLY in `apps/frontend/src/lib/docsLinks.ts` and `apps/frontend/src/lib/docsLinks.test.ts`. Any other hit is a literal that should be a registry reference.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd apps/frontend && pnpm test`
Expected: PASS. Do not proceed to the browser check with a red suite.

- [ ] **Step 6: Verify types and lint one final time**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: `tsc` clean (a type error is yours). `pnpm lint` exits non-zero from 58 pre-existing problems on `main` — that is the baseline, not your regression. Confirm you added none: `pnpm lint 2>&1 | grep -E "<files you changed>"` must print nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/settings/primary-ssl/ServingModelEditor.tsx
git commit -m "feat(settings): link day-2 Cloudflare SSL editor to cert and DNS docs"
```

- [ ] **Step 8: Browser check**

Per `localdev-tools/README.md`, start the CE frontend and screenshot the three changed wizard surfaces — storage step with GCS selected, the Cloudflare DNS phase, and the certificate paste form:

```bash
cd /home/rico/bffless/localdev-tools
node shot.mjs http://localhost:5173/setup --out /tmp/claude-1000/-home-rico-bffless/9db3051b-84f5-4a3c-93b2-afcfd263fd08/scratchpad/setup.png --full
```

Expected: `consoleErrors:0, failedRequests:0`, and the bordered rows visible in the intended positions. A cold headless session cannot reach gated `/api`, so a "couldn't reach server" fallback on authed views is expected, not a regression — report what rendered rather than treating the fallback as a failure.

- [ ] **Step 9: Report and hand off**

Summarize: files changed, suite result, screenshot findings. Do NOT push or open a PR — pushing is the operator's call.

---

## Notes for the implementer

- **Do not add a component test per wire-up site.** The links are static markup with no logic; `docsLinks.test.ts` covers the mapping and URL shape, `DocsLink.test.tsx` covers the presentations, and the existing suites cover the surrounding components. Extra render tests here would assert that JSX renders JSX.
- **If an insertion point does not match** the snippet quoted in a step, the file has moved on since 2026-07-26. Find the equivalent location by the surrounding comment or heading text rather than by line number, and note the drift in your report.
- **`servingMode === 'proxy'` intentionally gets no links** anywhere in this change. If that looks like an omission, it is the design decision recorded in the spec's Non-goals.
