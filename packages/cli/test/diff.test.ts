import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runDiffOne } from '../src/commands/diff.js';
import type { DiffDeps } from '../src/commands/diff.js';
import { buildRuleSet, uuidv5, SCHEMA_NAMESPACE } from '../src/compile/build.js';
import { API_URL, PROJECT_UUID, SET_UUID, basicSrcDir, happyRoutes, readBasicExpected, stubFetch } from './live-helpers.js';
import type { RuleSetExport } from '../src/format/types.js';

const config = { apiUrl: API_URL, project: PROJECT_UUID };
const env = { BFFLESS_API_KEY: 'k-test' };

function deps(routes: Parameters<typeof stubFetch>[0]): DiffDeps {
  const { fetchImpl } = stubFetch(routes);
  return { fetchImpl, env, config };
}

describe('rules diff', () => {
  it('clean: local compile matches the live export → status clean ("in sync", exit 0 contract)', async () => {
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(readBasicExpected())));
    expect(result.status).toBe('clean');
    expect(result.message).toBe('basic: in sync');
  });

  it('drift: a live rule differs → status drift with populated diffs (exit 1 contract)', async () => {
    const live = readBasicExpected();
    (live.rules[0] as { timeout?: number }).timeout = 12345;
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(live)));
    expect(result.status).toBe('drift');
    expect(result.message).toContain('drift detected');
    expect(result.diffs && result.diffs.length).toBeGreaterThan(0);
    expect(result.diffs!.join('\n')).toContain('timeout');
  });

  it('set missing on the server is drift (exit 1), with a clear push hint', async () => {
    const routes = happyRoutes(readBasicExpected());
    routes[`GET ${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`] = { body: { ruleSets: [] } };
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(routes));
    expect(result.status).toBe('drift');
    expect(result.message).toMatch(/rule set "basic" does not exist on the server .*rules push/);
    expect(result.diffs).toBeUndefined();
  });

  it('an equivalent live export with elided defaults still compares clean (defaults-normalized)', async () => {
    // Strip a default-valued key from a live rule; exportsEquivalent must not call it drift.
    const live = readBasicExpected() as RuleSetExport;
    const rule = live.rules.find((r) => r.timeout === 30000);
    if (rule) delete (rule as { timeout?: number }).timeout;
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(live)));
    expect(result.status).toBe('clean');
  });

  it('auth failure is an error (exit 2 contract), not drift', async () => {
    const routes = happyRoutes(readBasicExpected());
    routes[`GET ${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`] = { status: 401, body: {} };
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(routes));
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/X-API-Key/);
  });

  it('a compile failure is an error (exit 2 contract)', async () => {
    const result = await runDiffOne('/not/a/rule-set', {}, '/nowhere', deps({}));
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/no ruleset\.yaml/);
  });
});

// ==================== schema-id alignment (server remaps refs by NAME on push) ====================

const LOCAL_SCHEMA_ID = '11111111-2222-4333-8444-555555555555'; // explicit id in basic's items.schema.yaml
const DB_SCHEMA_ID = '99999999-8888-4777-a666-555544443333'; // a made-up target-project DB id

/** Simulate what the server exports after a clean push: DB schema ids, refs remapped. */
function liveWithDbSchemaIds(fromId: string, toId: string): RuleSetExport {
  const live = readBasicExpected();
  return JSON.parse(JSON.stringify(live).replaceAll(fromId, toId)) as RuleSetExport;
}

describe('rules diff — schema-id alignment by name', () => {
  it('live export with DB schema ids (refs remapped by the server) is clean, not permanent drift', async () => {
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(liveWithDbSchemaIds(LOCAL_SCHEMA_ID, DB_SCHEMA_ID))));
    expect(result.status).toBe('clean');
  });

  it('a genuinely different schema field is still drift even when ids differ', async () => {
    const live = liveWithDbSchemaIds(LOCAL_SCHEMA_ID, DB_SCHEMA_ID);
    live.schemas![0].fields[0].type = 'number'; // was string
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(live)));
    expect(result.status).toBe('drift');
    expect(result.diffs!.join('\n')).toContain('fields');
  });

  it('a schema name mismatch is drift (no alignment without a name match)', async () => {
    const live = liveWithDbSchemaIds(LOCAL_SCHEMA_ID, DB_SCHEMA_ID);
    live.schemas![0].name = 'items-renamed';
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(live)));
    expect(result.status).toBe('drift');
  });

  it('a schema missing from the live export is drift', async () => {
    const live = readBasicExpected();
    delete (live as { schemas?: unknown }).schemas;
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(live)));
    expect(result.status).toBe('drift');
  });

  it('a schema present live but not locally is drift', async () => {
    const live = readBasicExpected();
    live.schemas!.push({ id: DB_SCHEMA_ID, name: 'extra', fields: [{ name: 'x', type: 'string' }] });
    const result = await runDiffOne(basicSrcDir, {}, '/nowhere', deps(happyRoutes(live)));
    expect(result.status).toBe('drift');
  });
});

// ==================== uuidv5-derived ids + email rule without targetUrl (end-to-end) ====================

/** A rule set whose schema manifest has NO explicit id (compiler derives uuidv5(name)) plus an
 *  email_form_handler rule authored without targetUrl (server stores/export the DB default ''). */
function scratchEmailSet(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-diff-test-'));
  const files: Record<string, string> = {
    'ruleset.yaml': 'name: mail\n',
    'schemas/leads.schema.yaml': 'name: leads\nfields:\n  - name: email\n    type: string\n',
    'rules/api/leads/get.rule.yaml':
      'pipeline:\n  steps:\n    - name: query\n      handler: data_query\n      config:\n        schemaId: "$schema:leads"\n',
    'rules/api/contact/post.rule.yaml':
      'emailHandlerConfig:\n  to: team@example.com\n',
  };
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

function routesFor(setName: string, exportBody: unknown): Record<string, { status?: number; body?: unknown }> {
  return {
    [`GET ${API_URL}/api/projects`]: { body: [{ id: PROJECT_UUID, owner: 'me', name: 'proj' }] },
    [`GET ${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`]: {
      body: { ruleSets: [{ id: SET_UUID, name: setName }] },
    },
    [`GET ${API_URL}/api/proxy-rule-sets/${SET_UUID}/export`]: { body: exportBody },
  };
}

describe('rules diff — uuidv5 local ids and DB-default targetUrl', () => {
  it('uuidv5(name) local schema id vs live DB id + email rule without targetUrl vs live "" → clean', async () => {
    const dir = scratchEmailSet();
    const localId = uuidv5('leads', SCHEMA_NAMESPACE);
    const built = (await buildRuleSet(dir)).export;
    expect(JSON.stringify(built)).toContain(localId); // precondition: id really is uuidv5-derived

    // Live counterpart, exactly as the server would export it after a clean push:
    // schema refs/ids remapped to the DB id, absent targetUrl stored as ''.
    const live = JSON.parse(JSON.stringify(built).replaceAll(localId, DB_SCHEMA_ID)) as RuleSetExport;
    const emailRule = live.rules.find((r) => r.proxyType === 'email_form_handler')!;
    expect(emailRule.targetUrl).toBeUndefined(); // precondition: local build emits no targetUrl
    emailRule.targetUrl = '';

    const result = await runDiffOne(dir, {}, '/nowhere', deps(routesFor('mail', live)));
    expect(result.status).toBe('clean');
  });

  it('a real targetUrl change on the email rule is still drift', async () => {
    const dir = scratchEmailSet();
    const built = (await buildRuleSet(dir)).export;
    const live = structuredClone(built);
    const emailRule = live.rules.find((r) => r.proxyType === 'email_form_handler')!;
    emailRule.targetUrl = 'https://mailer.example.com';

    const result = await runDiffOne(dir, {}, '/nowhere', deps(routesFor('mail', live)));
    expect(result.status).toBe('drift');
    expect(result.diffs!.join('\n')).toContain('targetUrl');
  });
});
