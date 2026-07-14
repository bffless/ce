import { describe, it, expect } from 'vitest';
import { ApiClient } from '../src/api/client.js';
import { resolveProjectId, resolveRuleSetId, findRuleSetByName, requireProject } from '../src/api/resolve.js';
import { API_URL, PROJECT_UUID, SET_UUID, stubFetch } from './live-helpers.js';

function clientWith(routes: Parameters<typeof stubFetch>[0]): ApiClient {
  const { fetchImpl } = stubFetch(routes);
  return new ApiClient({ apiUrl: API_URL, apiKey: 'k', fetchImpl });
}

describe('resolveProjectId', () => {
  const OTHER_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const twoProjects = {
    [`GET ${API_URL}/api/projects`]: {
      body: [
        { id: PROJECT_UUID, owner: 'me', name: 'proj' },
        { id: OTHER_UUID, owner: 'other', name: 'demo' },
      ],
    },
    [`GET ${API_URL}/api/projects/other/demo`]: {
      body: { id: OTHER_UUID, owner: 'other', name: 'demo' },
    },
  };

  it('a UUID is used directly without hitting the API', async () => {
    const { fetchImpl, calls } = stubFetch({});
    const client = new ApiClient({ apiUrl: API_URL, apiKey: 'k', fetchImpl });
    expect(await resolveProjectId(client, PROJECT_UUID)).toBe(PROJECT_UUID);
    expect(calls).toHaveLength(0);
  });

  it('a bare name resolves via GET /api/projects', async () => {
    expect(await resolveProjectId(clientWith(twoProjects), 'proj')).toBe(PROJECT_UUID);
  });

  it('an owner/name pair resolves via the access-scoped GET /api/projects/:owner/:name', async () => {
    const { fetchImpl, calls } = stubFetch(twoProjects);
    const client = new ApiClient({ apiUrl: API_URL, apiKey: 'k', fetchImpl });
    expect(await resolveProjectId(client, 'other/demo')).toBe(OTHER_UUID);
    expect(calls.map((c) => c.url)).toEqual([`${API_URL}/api/projects/other/demo`]);
  });

  // The bug this endpoint switch fixes: GET /api/projects is creator-scoped, so a key whose
  // user was granted a role on a project they did NOT create lists nothing — yet owner/name
  // must still resolve.
  it('an owner/name pair resolves for a project absent from the creator-scoped list', async () => {
    const notCreatedByMe = {
      [`GET ${API_URL}/api/projects`]: { body: [] },
      [`GET ${API_URL}/api/projects/other/demo`]: { body: { id: OTHER_UUID, owner: 'other', name: 'demo' } },
    };
    expect(await resolveProjectId(clientWith(notCreatedByMe), 'other/demo')).toBe(OTHER_UUID);
  });

  // A project that doesn't exist trips ProjectPermissionGuard's "Project not found", which is
  // a 400 — not the 404 you'd expect. Both must read as "no match".
  it.each([400, 404])('an owner/name miss (HTTP %i) errors with the URL tried and near-misses', async (status) => {
    const routes = { ...twoProjects, [`GET ${API_URL}/api/projects/me/typo`]: { status, body: {} } };
    await expect(resolveProjectId(clientWith(routes), 'me/typo')).rejects.toThrow(
      /project "me\/typo" via GET https:\/\/api\.test\/api\/projects\/me\/typo: no match .*Projects created by the API key's user: me\/proj, other\/demo/s,
    );
  });

  it('an owner/name 403 surfaces as the access failure it is, not as "no match"', async () => {
    const routes = { ...twoProjects, [`GET ${API_URL}/api/projects/other/demo`]: { status: 403, body: {} } };
    await expect(resolveProjectId(clientWith(routes), 'other/demo')).rejects.toThrow(
      /HTTP 403 .*authentication failed/,
    );
  });

  it('a bare-name miss errors with the available names and points at owner/name', async () => {
    await expect(resolveProjectId(clientWith(twoProjects), 'nope')).rejects.toThrow(
      /project "nope" via GET https:\/\/api\.test\/api\/projects: no match\..*use owner\/name.*Available projects: me\/proj, other\/demo/s,
    );
  });

  it('an ambiguous bare name errors listing the owner/name candidates', async () => {
    const dup = {
      [`GET ${API_URL}/api/projects`]: {
        body: [
          { id: PROJECT_UUID, owner: 'me', name: 'proj' },
          { id: OTHER_UUID, owner: 'other', name: 'proj' },
        ],
      },
    };
    await expect(resolveProjectId(clientWith(dup), 'proj')).rejects.toThrow(
      /ambiguous — matches me\/proj, other\/proj/,
    );
  });
});

describe('resolveRuleSetId / findRuleSetByName', () => {
  const routes = {
    [`GET ${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`]: {
      body: { ruleSets: [{ id: SET_UUID, name: 'basic' }] },
    },
  };

  it('resolves an existing set name to its id', async () => {
    expect(await resolveRuleSetId(clientWith(routes), PROJECT_UUID, 'basic')).toBe(SET_UUID);
  });

  it('a miss errors with the URL tried and the sets that DO exist', async () => {
    await expect(resolveRuleSetId(clientWith(routes), PROJECT_UUID, 'nope')).rejects.toThrow(
      /rule set "nope" not found via GET https:\/\/api\.test\/api\/proxy-rule-sets\/project\/.*Available rule sets: basic/,
    );
  });

  it('findRuleSetByName returns null (not an error) when absent', async () => {
    expect(await findRuleSetByName(clientWith(routes), PROJECT_UUID, 'nope')).toBeNull();
  });
});

describe('requireProject', () => {
  it('flag beats config; missing both is a clear error', () => {
    expect(requireProject('flag-p', 'cfg-p')).toBe('flag-p');
    expect(requireProject(undefined, 'cfg-p')).toBe('cfg-p');
    expect(() => requireProject(undefined, undefined)).toThrow(/--project.*\.bffless\/config\.json/s);
  });
});
