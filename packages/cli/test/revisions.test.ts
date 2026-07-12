import { describe, it, expect } from 'vitest';
import { runRevisionsList, formatRevisionsTable } from '../src/commands/revisions.js';
import type { RevisionListItem } from '../src/api/sync-types.js';
import { API_URL, PROJECT_UUID, SET_UUID, stubFetch } from './live-helpers.js';

const config = { apiUrl: API_URL, project: PROJECT_UUID };
const env = { BFFLESS_API_KEY: 'k-test' };
const LIST_URL = `${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`;
const REVISIONS_URL = `${API_URL}/api/proxy-rule-sets/${SET_UUID}/revisions`;

function setListRoute() {
  return { [`GET ${LIST_URL}`]: { body: { ruleSets: [{ id: SET_UUID, name: 'basic' }] } } };
}

function revision(overrides: Partial<RevisionListItem>): RevisionListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-07-10T00:00:00.000Z',
    trigger: 'sync',
    contentHash: 'deadbeef',
    ruleCount: 3,
    current: false,
    ...overrides,
  };
}

describe('rules revisions', () => {
  it('resolves the set by name, then lists revisions verbatim (newest first, as the server sends them)', async () => {
    const revisions = [
      revision({ id: 'aaaa1111-1111-4111-8111-111111111111', current: true }),
      revision({ id: 'bbbb2222-2222-4222-8222-222222222222', current: false }),
    ];
    const { fetchImpl } = stubFetch({
      ...setListRoute(),
      [`GET ${REVISIONS_URL}`]: { body: { revisions } },
    });
    const result = await runRevisionsList('basic', {}, '/nowhere', { fetchImpl, env, config });
    expect(result.ok, result.error).toBe(true);
    expect(result.revisions).toEqual(revisions);
  });

  it('a set that does not exist errors with the names that DO exist (client-side resolution, no HTTP to /revisions)', async () => {
    const { fetchImpl, calls } = stubFetch(setListRoute());
    const result = await runRevisionsList('nope', {}, '/nowhere', { fetchImpl, env, config });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rule set "nope" not found.*Available rule sets: basic/s);
    expect(calls.some((c) => c.url === REVISIONS_URL)).toBe(false);
  });

  it('a server-side 404 on the revisions endpoint surfaces the server message', async () => {
    const { fetchImpl } = stubFetch({
      ...setListRoute(),
      [`GET ${REVISIONS_URL}`]: { status: 404, body: { message: 'rule set not found' } },
    });
    const result = await runRevisionsList('basic', {}, '/nowhere', { fetchImpl, env, config });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rule set not found');
  });
});

describe('formatRevisionsTable', () => {
  it('renders short id (8 chars), age, trigger, rule count, current marker, and repo@shortSha', () => {
    const revisions: RevisionListItem[] = [
      revision({
        id: 'aaaa1111-1111-4111-8111-111111111111',
        trigger: 'sync',
        ruleCount: 5,
        current: true,
        createdAt: new Date(Date.now() - 3600_000).toISOString(), // ~1h ago
        source: {
          repo: 'me/proj',
          gitSha: 'abcdef1234567890',
          syncedAt: '2026-07-10T00:00:00.000Z',
          contentHash: 'x',
        },
      }),
      revision({
        id: 'bbbb2222-2222-4222-8222-222222222222',
        trigger: 'rule_edit',
        ruleCount: 4,
        current: false,
      }),
    ];
    const lines = formatRevisionsTable(revisions).split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows

    const [row1, row2] = [lines[1], lines[2]];
    expect(row1).toContain('aaaa1111'); // exactly the first 8 chars of the uuid
    expect(row1).not.toContain('aaaa1111-'); // truncated, not the full uuid
    expect(row1).toMatch(/1h/);
    expect(row1).toContain('sync');
    expect(row1).toContain('5');
    expect(row1).toMatch(/current/);
    expect(row1).toContain('me/proj@abcdef1'); // short sha (7 chars)

    expect(row2).toContain('bbbb2222');
    expect(row2).toContain('rule_edit');
    expect(row2).toContain('4');
    expect(row2).not.toMatch(/current/);
  });

  it('an empty revision list renders a helpful placeholder, not an empty string', () => {
    expect(formatRevisionsTable([])).toMatch(/no revisions/i);
  });
});
