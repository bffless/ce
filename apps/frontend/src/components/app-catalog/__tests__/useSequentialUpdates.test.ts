import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useSequentialUpdates } from '../useSequentialUpdates';
import type { InstallJob, InstalledSummary } from '@/services/appCatalogApi';

/**
 * The hook talks to the store through `useUpdateAppMutation` (start a job) and
 * `appCatalogApi.endpoints.getInstallJob.initiate` (poll it). Both are stubbed
 * so the test controls exactly when each job starts and how it ends; the
 * assertions are about ORDER and about what each failure mode does to the
 * rest of the batch.
 */
const updateTrigger = vi.fn();
const initiate = vi.fn();
const dispatch = vi.fn((action: unknown) => action);
const invalidateTags = vi.fn((tags: string[]) => ({ type: 'invalidate', tags }));

vi.mock('@/services/appCatalogApi', () => ({
  useUpdateAppMutation: () => [updateTrigger],
  appCatalogApi: {
    endpoints: { getInstallJob: { initiate: (...args: unknown[]) => initiate(...args) } },
  },
}));
vi.mock('@/store/hooks', () => ({ useAppDispatch: () => dispatch }));
vi.mock('@/services/api', () => ({
  api: { util: { invalidateTags: (tags: string[]) => invalidateTags(tags) } },
}));

const install = (id: string): InstalledSummary => ({
  installedAppId: id,
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: '1.0.0',
  projectId: `proj-${id}`,
  projectName: `acme/${id}`,
  alias: 'app',
  status: 'installed',
  updateAvailable: true,
  manualSteps: [],
});

const job = (
  id: string,
  status: InstallJob['status'],
  extra: Partial<InstallJob> = {},
): InstallJob =>
  ({
    id,
    kind: 'update',
    appId: 'app',
    projectId: null,
    status,
    steps: [],
    createdAt: '',
    ...extra,
  }) as InstallJob;

/** Queue of job snapshots per jobId; each poll shifts one (last one sticks). */
let jobFeeds: Record<string, InstallJob[]>;

beforeEach(() => {
  vi.useFakeTimers();
  updateTrigger.mockReset();
  initiate.mockReset();
  dispatch.mockClear();
  invalidateTags.mockClear();
  jobFeeds = {};
  initiate.mockImplementation((jobId: string) => ({
    unwrap: () => {
      const feed = jobFeeds[jobId] ?? [];
      const next = feed.length > 1 ? feed.shift()! : feed[0];
      return next ? Promise.resolve(next) : Promise.reject({ data: { message: 'no such job' } });
    },
    unsubscribe: vi.fn(),
  }));
  updateTrigger.mockImplementation(({ id }: { id: string }) => ({
    unwrap: () => Promise.resolve({ jobId: `job-${id}` }),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  // Let pending promises settle, then advance past one poll interval, repeatedly.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe('useSequentialUpdates', () => {
  it('runs installs one at a time, in order, and refetches the catalog at the end', async () => {
    jobFeeds['job-a'] = [job('job-a', 'running'), job('job-a', 'succeeded')];
    jobFeeds['job-b'] = [job('job-b', 'succeeded')];
    const { result } = renderHook(() => useSequentialUpdates());

    act(() => result.current.start([install('a'), install('b')], false));
    expect(result.current.running).toBe(true);
    // The first install starts synchronously; the second waits its turn.
    expect(result.current.states).toEqual({ a: { status: 'running' }, b: { status: 'queued' } });

    await flush();

    // b's update was only fired after a's job reached a terminal status.
    expect(updateTrigger.mock.calls.map((c) => c[0])).toEqual([
      { id: 'a', prune: false },
      { id: 'b', prune: false },
    ]);
    const firstBStart = updateTrigger.mock.invocationCallOrder[1];
    const lastAPoll = initiate.mock.invocationCallOrder
      .filter((_, i) => initiate.mock.calls[i][0] === 'job-a')
      .at(-1)!;
    expect(firstBStart).toBeGreaterThan(lastAPoll);

    expect(result.current.running).toBe(false);
    expect(result.current.states).toEqual({
      a: { status: 'succeeded', jobId: 'job-a' },
      b: { status: 'succeeded', jobId: 'job-b' },
    });
    expect(invalidateTags).toHaveBeenCalledWith(['AppCatalog', 'InstalledApp']);
  });

  it('passes prune through and flags a succeeded job with conflicts', async () => {
    jobFeeds['job-a'] = [job('job-a', 'succeeded', { conflicts: [{} as never] })];
    const { result } = renderHook(() => useSequentialUpdates());

    act(() => result.current.start([install('a')], true));
    await flush();

    expect(updateTrigger).toHaveBeenCalledWith({ id: 'a', prune: true });
    expect(result.current.states.a).toEqual({ status: 'conflicts', jobId: 'job-a' });
  });

  it('a failed job does not stop the batch — the next install still runs', async () => {
    jobFeeds['job-a'] = [job('job-a', 'failed', { error: 'deploy exploded' })];
    jobFeeds['job-b'] = [job('job-b', 'succeeded')];
    const { result } = renderHook(() => useSequentialUpdates());

    act(() => result.current.start([install('a'), install('b')], false));
    await flush();

    expect(result.current.states).toEqual({
      a: { status: 'failed', jobId: 'job-a', error: 'deploy exploded' },
      b: { status: 'succeeded', jobId: 'job-b' },
    });
  });

  it('a REJECTED start stops the batch — later installs are marked skipped, not attempted', async () => {
    updateTrigger.mockImplementation(({ id }: { id: string }) => ({
      unwrap: () =>
        id === 'a'
          ? Promise.reject({ data: { message: 'Another install job is already running' } })
          : Promise.resolve({ jobId: `job-${id}` }),
    }));
    const { result } = renderHook(() => useSequentialUpdates());

    act(() => result.current.start([install('a'), install('b')], false));
    await flush();

    expect(updateTrigger).toHaveBeenCalledTimes(1);
    expect(result.current.states.a).toEqual({
      status: 'failed',
      error: 'Another install job is already running',
    });
    expect(result.current.states.b.status).toBe('failed');
    expect(result.current.states.b.error).toMatch(/skipped/i);
    expect(result.current.running).toBe(false);
  });

  it('ignores start while a batch is running', async () => {
    jobFeeds['job-a'] = [job('job-a', 'running')]; // never finishes
    const { result } = renderHook(() => useSequentialUpdates());

    act(() => result.current.start([install('a')], false));
    act(() => result.current.start([install('b')], false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(updateTrigger).toHaveBeenCalledTimes(1);
    expect(result.current.states.b).toBeUndefined();
  });
});
