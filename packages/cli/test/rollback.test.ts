import { describe, it, expect } from 'vitest';
import { runRollback } from '../src/commands/rollback.js';
import { formatSyncReport } from '../src/commands/push.js';
import type { SyncResponse } from '../src/api/sync-types.js';
import { API_URL, PROJECT_UUID, SET_UUID, stubFetch } from './live-helpers.js';

const config = { apiUrl: API_URL, project: PROJECT_UUID };
const env = { BFFLESS_API_KEY: 'k-test' };
const LIST_URL = `${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`;
const REVISIONS_URL = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/revisions`;

const REV_CURRENT = 'aaaa1111-1111-4111-8111-111111111111';
const REV_NEWEST_NONCURRENT = 'bbbb2222-2222-4222-8222-222222222222';
const REV_OLDER_NONCURRENT = 'cccc3333-3333-4333-8333-333333333333';

function threeRevisions() {
  return [
    {
      id: REV_CURRENT,
      createdAt: '2026-07-12T00:00:00.000Z',
      trigger: 'sync',
      contentHash: 'h1',
      ruleCount: 3,
      current: true,
    },
    {
      id: REV_NEWEST_NONCURRENT,
      createdAt: '2026-07-10T00:00:00.000Z',
      trigger: 'rule_edit',
      contentHash: 'h2',
      ruleCount: 3,
      current: false,
    },
    {
      id: REV_OLDER_NONCURRENT,
      createdAt: '2026-07-01T00:00:00.000Z',
      trigger: 'sync',
      contentHash: 'h3',
      ruleCount: 2,
      current: false,
    },
  ];
}

function setListRoute() {
  return { [`GET ${LIST_URL}`]: { body: { ruleSets: [{ id: SET_UUID, name: 'basic' }] } } };
}

function syncResponse(overrides?: Partial<SyncResponse>): SyncResponse {
  return {
    ruleSetId: SET_UUID,
    created: [],
    updated: [],
    deleted: [],
    unchanged: [{ pathPattern: '/api/items', method: 'GET' }],
    pruneCandidates: [],
    schemaResolutions: [],
    missingSecrets: [],
    warnings: [],
    dryRun: false,
    setCreated: false,
    ...overrides,
  };
}

describe('rules rollback', () => {
  it('defaults to the newest revision with current: false', async () => {
    const rollbackUrl = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/rollback/${REV_NEWEST_NONCURRENT}`;
    const { fetchImpl, calls } = stubFetch({
      ...setListRoute(),
      [`GET ${REVISIONS_URL}`]: { body: { revisions: threeRevisions() } },
      [`POST ${rollbackUrl}`]: { body: syncResponse() },
    });
    const result = await runRollback('basic', {}, '/nowhere', { fetchImpl, env, config });
    expect(result.ok, result.error).toBe(true);
    expect(result.revisionId).toBe(REV_NEWEST_NONCURRENT);
    const postCall = calls.find((c) => c.url === rollbackUrl);
    expect(postCall).toBeDefined();
    expect(JSON.parse(postCall!.init?.body as string)).toEqual({ dryRun: false });
  });

  it('--to <revisionId> wins over the default, and skips the list lookup entirely', async () => {
    const rollbackUrl = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/rollback/${REV_OLDER_NONCURRENT}`;
    const { fetchImpl, calls } = stubFetch({
      ...setListRoute(),
      [`POST ${rollbackUrl}`]: { body: syncResponse() },
    });
    const result = await runRollback('basic', { to: REV_OLDER_NONCURRENT }, '/nowhere', { fetchImpl, env, config });
    expect(result.ok, result.error).toBe(true);
    expect(result.revisionId).toBe(REV_OLDER_NONCURRENT);
    expect(calls.some((c) => c.url === REVISIONS_URL)).toBe(false);
  });

  it('no non-current revision exists: ok false with a helpful message, and no rollback POST is made', async () => {
    const { fetchImpl, calls } = stubFetch({
      ...setListRoute(),
      [`GET ${REVISIONS_URL}`]: { body: { revisions: [{ ...threeRevisions()[0], current: true }] } },
    });
    const result = await runRollback('basic', {}, '/nowhere', { fetchImpl, env, config });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no non-current revision/i);
    expect(result.error).toMatch(/--to/);
    expect(calls.some((c) => (c.init?.method ?? 'GET') === 'POST')).toBe(false);
  });

  it('a server 404 (e.g. bad/foreign revision id) surfaces the server message', async () => {
    const rollbackUrl = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/rollback/${REV_OLDER_NONCURRENT}`;
    const { fetchImpl } = stubFetch({
      ...setListRoute(),
      [`POST ${rollbackUrl}`]: { status: 404, body: { message: 'revision not found' } },
    });
    const result = await runRollback('basic', { to: REV_OLDER_NONCURRENT }, '/nowhere', { fetchImpl, env, config });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('revision not found');
  });

  it('--dry-run sends the exact body {"dryRun":true} and does not otherwise change target selection', async () => {
    const rollbackUrl = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/rollback/${REV_NEWEST_NONCURRENT}`;
    const { fetchImpl, calls } = stubFetch({
      ...setListRoute(),
      [`GET ${REVISIONS_URL}`]: { body: { revisions: threeRevisions() } },
      [`POST ${rollbackUrl}`]: { body: syncResponse({ dryRun: true }) },
    });
    const result = await runRollback('basic', { dryRun: true }, '/nowhere', { fetchImpl, env, config });
    expect(result.ok, result.error).toBe(true);
    const postCall = calls.find((c) => c.url === rollbackUrl);
    expect(postCall!.init?.body).toBe('{"dryRun":true}');
    expect(result.response?.dryRun).toBe(true);
  });

  it('the response renders through the existing formatSyncReport (rollback IS a sync)', async () => {
    const rollbackUrl = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/rollback/${REV_NEWEST_NONCURRENT}`;
    const { fetchImpl } = stubFetch({
      ...setListRoute(),
      [`GET ${REVISIONS_URL}`]: { body: { revisions: threeRevisions() } },
      [`POST ${rollbackUrl}`]: {
        body: syncResponse({ updated: [{ pathPattern: '/api/items', method: 'GET' }], unchanged: [] }),
      },
    });
    const result = await runRollback('basic', {}, '/nowhere', { fetchImpl, env, config });
    expect(result.ok, result.error).toBe(true);
    const report = formatSyncReport('basic', result.response!);
    expect(report).toContain('basic: 0 created, 1 updated, 0 deleted, 0 unchanged');
    expect(report).toContain('~ GET /api/items');
  });
});
