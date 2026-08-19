import { createHash } from 'crypto';
import { zipSync } from 'fflate';
import type { AppManifest } from '../app-manifest.types';

/**
 * `makeFixtureBundle` — builds a real, valid app bundle zip in memory (via
 * `zipSync`, the same library the installer itself uses to build deploy
 * zips). Committed as CODE, not a binary fixture, so it stays readable/diffable
 * and the two versions stay obviously in sync with each other.
 *
 * This is the fixture behind `app-catalog.e2e-ish.spec.ts` (Task 11's
 * orchestration spec): the bytes returned here are fed through the REAL
 * `AppBundleService` (real unzip + real `validateAppManifest`) and the
 * installer's REAL rule-set DTO validation — only the network fetch and the
 * downstream side-effecting services (sync/deploy/domains/projects/schedules)
 * are mocked by the spec.
 *
 * Two rule sets, two rules, two distinct schemas total:
 *  - `fixture-a.json`: 1 rule, declares schema `fixture_items`.
 *  - `fixture-b.json`: 1 rule (2 in v2 — "adds a rule"), declares the SAME
 *    `fixture_items` schema again (same id — the shared-name reuse path) PLUS
 *    a second, distinct schema `fixture_notes`.
 *
 * v2 vs v1: version bump, `fixture-b.json` gains a second rule, and `dist/`
 * changes (different `index.html` content + a new `assets/app.js`) — the
 * "same alias redeployed" case for the update orchestration test.
 */

// Valid v4-shaped UUIDs (version nibble '4', variant nibble '8') — class-validator's
// @IsUUID() default ('all') still checks the version/variant nibbles, so an
// all-same-digit string like '1111...-1111...' fails validation.
const FIXTURE_ITEMS_SCHEMA_ID = '11111111-1111-4111-8111-111111111111';
const FIXTURE_NOTES_SCHEMA_ID = '22222222-2222-4222-8222-222222222222';

export interface FixtureBundle {
  buf: Uint8Array;
  sha256: string;
  manifest: AppManifest;
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function manifestFor(version: '1.0.0' | '2.0.0'): AppManifest {
  return {
    schemaVersion: 1,
    id: 'fixture-app',
    name: 'Fixture App',
    version,
    summary: 'Orchestration-spec fixture app',
    install: {
      alias: 'fixture-app',
      deployment: { path: 'dist', basePath: '/apps/fixture-app/dist' },
      ruleSets: [{ file: 'rulesets/fixture-a.json' }, { file: 'rulesets/fixture-b.json' }],
    },
  };
}

function ruleSetA(): unknown {
  return {
    version: 2,
    kind: 'proxy-rule-set',
    ruleSet: { name: 'fixture-app-a', description: 'Fixture rule set A' },
    rules: [
      { pathPattern: '/api/items', method: 'GET', targetUrl: 'https://api.example.com/items' },
    ],
    schemas: [
      {
        id: FIXTURE_ITEMS_SCHEMA_ID,
        name: 'fixture_items',
        fields: [{ name: 'title', type: 'string', required: true }],
      },
    ],
  };
}

function ruleSetB(version: '1.0.0' | '2.0.0'): unknown {
  const rules = [
    { pathPattern: '/api/notes', method: 'GET', targetUrl: 'https://api.example.com/notes' },
  ];
  if (version === '2.0.0') {
    rules.push({
      pathPattern: '/api/notes',
      method: 'POST',
      targetUrl: 'https://api.example.com/notes',
    });
  }
  return {
    version: 2,
    kind: 'proxy-rule-set',
    ruleSet: { name: 'fixture-app-b', description: 'Fixture rule set B' },
    rules,
    schemas: [
      {
        id: FIXTURE_ITEMS_SCHEMA_ID,
        name: 'fixture_items',
        fields: [{ name: 'title', type: 'string', required: true }],
      },
      {
        id: FIXTURE_NOTES_SCHEMA_ID,
        name: 'fixture_notes',
        fields: [{ name: 'body', type: 'text', required: false }],
      },
    ],
  };
}

export function makeFixtureBundle(version: '1.0.0' | '2.0.0'): FixtureBundle {
  const manifest = manifestFor(version);

  const files: Record<string, Uint8Array> = {
    'bffless-app.json': encode(JSON.stringify(manifest)),
    'rulesets/fixture-a.json': encode(JSON.stringify(ruleSetA())),
    'rulesets/fixture-b.json': encode(JSON.stringify(ruleSetB(version))),
    'dist/index.html': encode(`<!doctype html><title>Fixture App</title>fixture app v${version}`),
  };
  if (version === '2.0.0') {
    files['dist/assets/app.js'] = encode('console.log("fixture app v2")');
  }

  const buf = zipSync(files);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { buf, sha256, manifest };
}
