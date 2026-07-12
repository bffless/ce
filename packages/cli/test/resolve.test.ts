import { describe, it, expect } from 'vitest';
import { ApiClient } from '../src/api/client.js';
import { resolveProjectId, resolveRuleSetId, findRuleSetByName, requireProject } from '../src/api/resolve.js';
import { API_URL, PROJECT_UUID, SET_UUID, stubFetch } from './live-helpers.js';

function clientWith(routes: Parameters<typeof stubFetch>[0]): ApiClient {
  const { fetchImpl } = stubFetch(routes);
  return new ApiClient({ apiUrl: API_URL, apiKey: 'k', fetchImpl });
}

describe('resolveProjectId', () => {
  const twoProjects = {
    [`GET ${API_URL}/api/projects`]: {
      body: [
        { id: PROJECT_UUID, owner: 'me', name: 'proj' },
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', owner: 'other', name: 'demo' },
      ],
    },
  };

  it('a UUID is used directly without hitting the list endpoint', async () => {
    const { fetchImpl, calls } = stubFetch({});
    const client = new ApiClient({ apiUrl: API_URL, apiKey: 'k', fetchImpl });
    expect(await resolveProjectId(client, PROJECT_UUID)).toBe(PROJECT_UUID);
    expect(calls).toHaveLength(0);
  });

  it('a bare name resolves via GET /api/projects', async () => {
    expect(await resolveProjectId(clientWith(twoProjects), 'proj')).toBe(PROJECT_UUID);
  });

  it('an owner/name pair resolves', async () => {
    expect(await resolveProjectId(clientWith(twoProjects), 'other/demo')).toBe(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
  });

  it('a miss errors with what was tried (name + URL) and the available names', async () => {
    await expect(resolveProjectId(clientWith(twoProjects), 'nope')).rejects.toThrow(
      /project "nope" via GET https:\/\/api\.test\/api\/projects: no match\. Available projects: me\/proj, other\/demo/,
    );
  });

  it('an ambiguous bare name errors listing the owner/name candidates', async () => {
    const dup = {
      [`GET ${API_URL}/api/projects`]: {
        body: [
          { id: PROJECT_UUID, owner: 'me', name: 'proj' },
          { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', owner: 'other', name: 'proj' },
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
