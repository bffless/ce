/**
 * Shared helpers for the live-command tests (pull/push/diff/resolve): a recording fetch
 * stub and the canonical fixture constants. Not a test file itself (no `.test.ts`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FetchLike } from '../src/api/client.js';
import type { RuleSetExport } from '../src/format/types.js';

export const API_URL = 'https://api.test';
export const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SET_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const basicSrcDir = path.resolve('test/fixtures/synthetic/basic');

export function readBasicExpected(): RuleSetExport {
  return JSON.parse(readFileSync(path.join(basicSrcDir, 'expected.json'), 'utf8')) as RuleSetExport;
}

export interface RecordedCall {
  url: string;
  init?: RequestInit;
}

export interface StubRoute {
  status?: number;
  body?: unknown;
}

/** A fetch stub answering from a `METHOD url` → response map, recording every call. */
export function stubFetch(routes: Record<string, StubRoute>): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`stubFetch: no route for ${key}`);
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

/** Standard happy-path routes: project list, rule-set list, export. */
export function happyRoutes(exportBody: unknown): Record<string, StubRoute> {
  return {
    [`GET ${API_URL}/api/projects`]: {
      body: [{ id: PROJECT_UUID, owner: 'me', name: 'proj' }],
    },
    [`GET ${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`]: {
      body: { ruleSets: [{ id: SET_UUID, name: 'basic' }] },
    },
    [`GET ${API_URL}/api/proxy-rule-sets/${SET_UUID}/export`]: { body: exportBody },
  };
}
