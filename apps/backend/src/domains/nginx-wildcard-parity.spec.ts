import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * The wildcard `*.<primary>` server block exists TWICE, hand-written, in two
 * files that must stay in step:
 *
 *   - `docker/nginx/sites-available/main.conf.template` — the compose/CE stack
 *   - `umbrel/nginx.conf.template`                      — the Umbrel package
 *
 * Both rewrite EVERY path into the subdomain-alias handler, so any route that
 * must reach the backend unrewritten needs an explicit exception in BOTH. The
 * Umbrel copy silently lacked them, which is why every Handoff upload on
 * Umbrel 404'd: `PUT /api/storage/presigned/local` was rewritten into
 * `/public/subdomain-alias/handoff/api/storage/presigned/local` and answered
 * by the backend's 404 (confirmed live from a HAR — `X-Powered-By: Express`).
 *
 * This is a drift fence, not a rendering test: it asserts the exception list
 * matches, so adding one to the CE template without the Umbrel one fails here.
 */
const REPO_ROOT = path.join(__dirname, '../../../..');
const CE_TEMPLATE = path.join(REPO_ROOT, 'docker/nginx/sites-available/main.conf.template');
const UMBREL_TEMPLATE = path.join(REPO_ROOT, 'umbrel/nginx.conf.template');

/** Locations that must reach the backend unrewritten on an app subdomain. */
const REQUIRED_EXCEPTIONS = [
  // Cross-domain auth relay used by apps served on their own subdomain.
  'location /_bffless/auth/',
  // Presigned local-filesystem uploads AND their signed GET downloads —
  // both controllers share the `api/storage/presigned` + `local` route.
  'location = /api/storage/presigned/local',
];

/** The `*.<domain>` server block, from its server_name to the block's end. */
function wildcardBlock(file: string): string {
  const text = readFileSync(file, 'utf-8');
  const start = text.search(/server_name\s+\*\./);
  expect(start).toBeGreaterThan(-1);
  // The next `server {` (or EOF) bounds this block well enough for a
  // substring check — both files declare one wildcard block.
  const rest = text.slice(start);
  const next = rest.search(/\nserver\s*\{/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('wildcard subdomain block parity: CE vs Umbrel nginx templates', () => {
  it.each(REQUIRED_EXCEPTIONS)('CE template excepts "%s" from the alias rewrite', (location) => {
    expect(wildcardBlock(CE_TEMPLATE)).toContain(location);
  });

  it.each(REQUIRED_EXCEPTIONS)('Umbrel template excepts "%s" from the alias rewrite', (location) => {
    expect(wildcardBlock(UMBREL_TEMPLATE)).toContain(location);
  });

  it('declares the presigned exception as an EXACT match in both, so it beats "location /"', () => {
    for (const file of [CE_TEMPLATE, UMBREL_TEMPLATE]) {
      const block = wildcardBlock(file);
      expect(block).toContain('location = /api/storage/presigned/local');
      // A prefix match would lose to nothing, but an exact match is what makes
      // ordering irrelevant — nginx always prefers `location =`.
      expect(block).not.toMatch(/location\s+\/api\/storage\/presigned\/local\s*\{/);
    }
  });

  it('still rewrites everything else into the subdomain-alias handler', () => {
    for (const file of [CE_TEMPLATE, UMBREL_TEMPLATE]) {
      expect(wildcardBlock(file)).toContain('/public/subdomain-alias/');
    }
  });
});
