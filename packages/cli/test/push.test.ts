import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPushOne, formatSyncReport, applyNameSuffix } from '../src/commands/push.js';
import type { PushDeps } from '../src/commands/push.js';
import type { SyncResponse, SyncRequestBody } from '../src/api/sync-types.js';
import { API_URL, PROJECT_UUID, SET_UUID, basicSrcDir, stubFetch } from './live-helpers.js';

const SYNC_URL = `${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}/sync`;
const config = { apiUrl: API_URL, project: PROJECT_UUID };
const env = { BFFLESS_API_KEY: 'k-test' };
const noGit: PushDeps['execGit'] = () => {
  throw new Error('git unavailable');
};

function syncResponse(overrides?: Partial<SyncResponse>): SyncResponse {
  return {
    ruleSetId: SET_UUID,
    created: [],
    updated: [],
    deleted: [],
    unchanged: [],
    pruneCandidates: [],
    schemaResolutions: [],
    missingSecrets: [],
    warnings: [],
    dryRun: false,
    setCreated: false,
    ...overrides,
  };
}

function pushDeps(
  response: SyncResponse | { status: number; body?: unknown },
  extra?: Partial<PushDeps>,
): PushDeps & { sentBody: () => SyncRequestBody } {
  const route = 'status' in response ? response : { body: response };
  const { fetchImpl, calls } = stubFetch({ [`PUT ${SYNC_URL}`]: route });
  return {
    fetchImpl,
    env,
    config,
    execGit: noGit,
    ...extra,
    sentBody: () => JSON.parse(calls[0].init?.body as string) as SyncRequestBody,
  };
}

describe('rules push', () => {
  it('dry run: sends options.dryRun, exits ok, and renders the change report with METHOD /path refs', async () => {
    const d = pushDeps(
      syncResponse({
        ruleSetId: null,
        created: [
          { pathPattern: '/api/items', method: 'GET' },
          { pathPattern: '/api/items/*', method: null },
        ],
        updated: [{ pathPattern: '/api/feeds/remove', method: 'POST' }],
        unchanged: [],
        dryRun: true,
        setCreated: true,
      }),
    );
    const result = await runPushOne(basicSrcDir, { dryRun: true }, '/nowhere', d);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);

    const body = d.sentBody();
    expect(body.options).toEqual({ prune: false, dryRun: true, strictSchemas: false });
    expect(body.ruleSet.name).toBe('basic');
    expect(Array.isArray(body.rules)).toBe(true);
    expect(body.rules.length).toBeGreaterThan(0);
    expect(body.schemas?.map((s) => s.name)).toContain('items');
    expect(body.source).toBeUndefined(); // env has no GITHUB_*, git unavailable

    expect(result.report).toContain('basic: 2 created, 1 updated, 0 deleted, 0 unchanged');
    expect(result.report).toContain('[set would be created]');
    expect(result.report).toContain('(dry run — nothing was written)');
    expect(result.report).toContain('+ GET /api/items');
    expect(result.report).toContain('+ ANY /api/items/*'); // null method renders as ANY
    expect(result.report).toContain('~ POST /api/feeds/remove');
  });

  it('--prune and --strict-schemas are forwarded in options', async () => {
    const d = pushDeps(syncResponse({ deleted: [{ pathPattern: '/api/old', method: null }] }));
    const result = await runPushOne(basicSrcDir, { prune: true, strictSchemas: true }, '/nowhere', d);
    expect(result.ok, result.error).toBe(true);
    expect(d.sentBody().options).toEqual({ prune: true, dryRun: false, strictSchemas: true });
    expect(result.report).toContain('- ANY /api/old');
  });

  it('--name-suffix renames the set in the payload and the report', async () => {
    const d = pushDeps(syncResponse({ setCreated: true }));
    const result = await runPushOne(basicSrcDir, { nameSuffix: 'pr-42' }, '/nowhere', d);
    expect(result.ok, result.error).toBe(true);
    expect(d.sentBody().ruleSet.name).toBe('basic-pr-42');
    expect(result.report).toContain('basic-pr-42:');
    expect(result.report).toContain('[set created]');
  });

  it('outcome.name carries the synced name, suffix applied — no second build needed to learn it', async () => {
    const plain = await runPushOne(basicSrcDir, {}, '/nowhere', pushDeps(syncResponse()));
    expect(plain.name).toBe('basic');

    const suffixed = pushDeps(syncResponse());
    const result = await runPushOne(basicSrcDir, { nameSuffix: 'pr-42' }, '/nowhere', suffixed);
    expect(result.name).toBe('basic-pr-42');
    expect(result.name).toBe(suffixed.sentBody().ruleSet.name); // exactly what was synced
  });

  it('outcome.name survives a failed sync (the set compiled; only the HTTP call failed)', async () => {
    const d = pushDeps({ status: 500, body: { message: 'boom' } });
    const result = await runPushOne(basicSrcDir, { nameSuffix: 'pr-9' }, '/nowhere', d);
    expect(result.ok).toBe(false);
    expect(result.name).toBe('basic-pr-9');
  });

  it('remediation overrides re-word the auth and project errors for a non-CLI embedder', async () => {
    const auth = pushDeps({ status: 401, body: { message: 'Unauthorized' } }, {
      remediation: { auth: 'Check the `api-key` input on the action.' },
    });
    const authResult = await runPushOne(basicSrcDir, {}, '/nowhere', auth);
    expect(authResult.error).toContain('Check the `api-key` input on the action.');
    expect(authResult.error).not.toContain('--api-key');

    const noProject = pushDeps(syncResponse(), {
      config: { apiUrl: API_URL }, // no project in config, none in opts
      remediation: { project: 'Set the `project` input on the action.' },
    });
    const projectResult = await runPushOne(basicSrcDir, {}, '/nowhere', noProject);
    expect(projectResult.ok).toBe(false);
    expect(projectResult.error).toBe('no project configured — Set the `project` input on the action.');
  });

  it('pruneCandidates are called out as would-prune hints', async () => {
    const d = pushDeps(syncResponse({ pruneCandidates: [{ pathPattern: '/api/legacy', method: 'DELETE' }] }));
    const result = await runPushOne(basicSrcDir, {}, '/nowhere', d);
    expect(result.ok, result.error).toBe(true);
    expect(result.report).toMatch(/would prune .*--prune/);
    expect(result.report).toContain('! DELETE /api/legacy');
  });

  it('missingSecrets alone is a WARNING: ok stays true, report calls them out prominently', async () => {
    const d = pushDeps(syncResponse({ missingSecrets: ['OPENAI_API_KEY'], warnings: ['schema "items" fields differ'] }));
    const result = await runPushOne(basicSrcDir, {}, '/nowhere', d);
    expect(result.ok).toBe(true); // exit 0 semantics
    expect(result.report).toContain('MISSING SECRETS (1)');
    expect(result.report).toContain('OPENAI_API_KEY');
    expect(result.report).toContain('warning: schema "items" fields differ');
  });

  it('HTTP 403 fails with the auth hint (nonzero exit path)', async () => {
    const d = pushDeps({ status: 403, body: { message: 'Forbidden' } });
    const result = await runPushOne(basicSrcDir, {}, '/nowhere', d);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 403 .*X-API-Key.*BFFLESS_API_KEY/s);
  });

  it('HTTP 400 (e.g. strict schema failure) fails with the server message', async () => {
    const d = pushDeps({ status: 400, body: { message: 'schema "items" field mismatch (strictSchemas)' } });
    const result = await runPushOne(basicSrcDir, { strictSchemas: true }, '/nowhere', d);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('schema "items" field mismatch');
  });

  it('a compile error fails before any HTTP call', async () => {
    const { fetchImpl, calls } = stubFetch({});
    const result = await runPushOne('/definitely/not/a/rule-set', {}, '/nowhere', {
      fetchImpl,
      env,
      config,
      execGit: noGit,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no ruleset\.yaml/);
    expect(result.name).toBeUndefined(); // nothing compiled, so there is no name to report
    expect(calls).toHaveLength(0);
  });

  it('source metadata: GitHub Actions env wins; path comes from the git repo root', async () => {
    const d = pushDeps(syncResponse(), {
      env: { ...env, GITHUB_REPOSITORY: 'bffless/ce', GITHUB_SHA: 'abc123' },
      execGit: (args) => {
        if (args.join(' ') === 'rev-parse --show-toplevel') return '/repo';
        throw new Error('unexpected git call');
      },
    });
    // basicSrcDir is not under /repo, so path degrades away while repo/gitSha survive.
    const result = await runPushOne(basicSrcDir, {}, '/nowhere', d);
    expect(result.ok, result.error).toBe(true);
    expect(d.sentBody().source).toEqual({ repo: 'bffless/ce', gitSha: 'abc123' });
  });

  it('source metadata: falls back to git commands, and to nothing when git is unavailable', async () => {
    const withGit = pushDeps(syncResponse(), {
      execGit: (args) => {
        const cmd = args.join(' ');
        if (cmd === 'remote get-url origin') return 'git@github.com:me/proj.git';
        if (cmd === 'rev-parse HEAD') return 'deadbeef';
        if (cmd === 'rev-parse --show-toplevel') return basicSrcDir; // set dir == repo root → no path
        throw new Error('unexpected');
      },
    });
    const ok = await runPushOne(basicSrcDir, {}, '/nowhere', withGit);
    expect(ok.ok, ok.error).toBe(true);
    expect(withGit.sentBody().source).toEqual({ repo: 'me/proj', gitSha: 'deadbeef' });

    const without = pushDeps(syncResponse());
    const stillOk = await runPushOne(basicSrcDir, {}, '/nowhere', without);
    expect(stillOk.ok, stillOk.error).toBe(true); // push proceeds without provenance
    expect(without.sentBody().source).toBeUndefined();
  });

  it('a validator authored without config is sent on the wire with config: {} (backend DTO requires config)', async () => {
    // PipelineValidatorDto.config is @IsObject() without @IsOptional (apps/backend
    // dto/create-proxy-rule.dto.ts): omitting it 400s the whole sync.
    const dir = mkdtempSync(path.join(tmpdir(), 'bffless-push-test-'));
    mkdirSync(path.join(dir, 'rules/api/x'), { recursive: true });
    writeFileSync(path.join(dir, 'ruleset.yaml'), 'name: v\n', 'utf8');
    writeFileSync(
      path.join(dir, 'rules/api/x/post.rule.yaml'),
      'pipeline:\n  steps:\n    - name: fn\n      handler: function_handler\n      config: { code: "x" }\n  validators:\n    - type: auth_required\n',
      'utf8',
    );
    const d = pushDeps(syncResponse());
    const result = await runPushOne(dir, {}, '/nowhere', d);
    expect(result.ok, result.error).toBe(true);
    expect(d.sentBody().rules[0].pipelineConfig?.validators).toEqual([{ type: 'auth_required', config: {} }]);
  });

  it('sends prefixed pathPatterns in the sync body when pathPrefix is set', async () => {
    const d = pushDeps(syncResponse());
    const result = await runPushOne(
      path.resolve('test/fixtures/synthetic/plain'),
      { pathPrefix: '/api/hello' },
      '/nowhere',
      d,
    );
    expect(result.ok, result.error).toBe(true);
    const body = d.sentBody();
    expect(body.rules.map((r) => r.pathPattern).sort()).toEqual(['/api/hello/echo', '/api/hello/job', '/w/hello/*']);
  });
});

describe('applyNameSuffix', () => {
  it('appends the suffix, and is a no-op for every falsy suffix', () => {
    expect(applyNameSuffix('basic', 'pr-42')).toBe('basic-pr-42');
    expect(applyNameSuffix('basic')).toBe('basic');
    // '' is "unset", not an empty suffix — it must never yield the trailing-dash name "basic-".
    expect(applyNameSuffix('basic', '')).toBe('basic');
  });
});

describe('formatSyncReport', () => {
  it('an all-unchanged sync is a single summary line', () => {
    const report = formatSyncReport(
      'basic',
      syncResponse({ unchanged: [{ pathPattern: '/api/items', method: 'GET' }] }),
    );
    expect(report).toBe('basic: 0 created, 0 updated, 0 deleted, 1 unchanged');
  });
});
