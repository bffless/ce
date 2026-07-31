import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AppsPage } from './AppsPage';
import type { CatalogEntry, CatalogListResult, InstallJob } from '@/services/appCatalogApi';

// --- appCatalogApi -----------------------------------------------------
// `catalogResult` is reassigned between renders to simulate the RTK Query
// cache refreshing after a mutation invalidates the `AppCatalog` tag (e.g.
// ackManualStep). Because it's read fresh on every call, re-rendering
// AppsPage after reassigning it is equivalent to a real refetch.
let catalogResult: { data?: CatalogListResult; isLoading: boolean; isError: boolean };
const refetchMock = vi.fn();
const updateTrigger = vi.fn();
const ackTrigger = vi.fn();
const getInstallJobQueryMock = vi.fn<
  (jobId: string, options?: { pollingInterval?: number; skip?: boolean }) => { data?: InstallJob }
>();
let jobQueryResult: { data?: InstallJob };

vi.mock('@/services/appCatalogApi', () => ({
  useGetAppCatalogQuery: () => ({ ...catalogResult, refetch: refetchMock }),
  useUpdateAppMutation: () => [updateTrigger, { isLoading: false }],
  useUninstallAppMutation: () => [vi.fn(), { isLoading: false }],
  useGetUninstallPreviewQuery: () => ({ data: undefined }),
  useGetEjectPayloadQuery: () => ({ data: undefined, isFetching: false }),
  usePreflightAppMutation: () => [vi.fn(), { data: undefined, isLoading: false, reset: vi.fn() }],
  useInstallAppMutation: () => [vi.fn(), { isLoading: false }],
  useGetInstallJobQuery: (
    jobId: string,
    options?: { pollingInterval?: number; skip?: boolean },
  ) => getInstallJobQueryMock(jobId, options),
  useUndoJobMutation: () => [vi.fn(), { isLoading: false }],
  useAckManualStepMutation: () => [ackTrigger, { isLoading: false }],
}));

vi.mock('@/services/apiKeysApi', () => ({
  useCreateApiKeyMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/services/repositoriesApi', () => ({
  useGetMyRepositoriesQuery: () => ({ data: { total: 0, repositories: [] }, isLoading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// InstallDialog dispatches `api.util.invalidateTags` directly (via
// `useAppDispatch`) once a polled job reaches a terminal status — this page
// isn't wrapped in a redux <Provider>, so stub the hook the same way
// InstallDialog.test.tsx does.
vi.mock('@/store/hooks', () => ({
  useAppDispatch: () => vi.fn(),
}));

function makeEntry(manualStepsAcked: string[]): CatalogEntry {
  return {
    id: 'handoff',
    name: 'Handoff',
    summary: 'Share files with clients',
    gates: [],
    installable: true,
    registryVersion: '2.0.0',
    installed: {
      installedAppId: 'installed-1',
      version: '1.0.0',
      projectId: 'proj-1',
      projectName: 'acme/handoff-site',
      alias: 'production',
      appUrl: 'https://handoff.example.com',
      status: 'installed',
      updateAvailable: true,
      manualSteps: [
        { id: 'bucket-cors', title: 'Configure bucket CORS', body: 'Allow PUT from your app origin.' },
      ],
      manualStepsAcked,
    },
  };
}

function makeJob(): InstallJob {
  return {
    id: 'job-1',
    kind: 'update',
    appId: 'handoff',
    projectId: 'proj-1',
    status: 'succeeded',
    steps: [],
    installedAppId: 'installed-1',
    appUrl: 'https://handoff.example.com',
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}

beforeEach(() => {
  catalogResult = { data: { data: [makeEntry([])] }, isLoading: false, isError: false };
  refetchMock.mockReset();
  updateTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
  ackTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ acked: ['bucket-cors'] }) });
  jobQueryResult = { data: makeJob() };
  getInstallJobQueryMock.mockReset().mockImplementation(() => jobQueryResult);
});

describe('AppsPage — Done-screen ack checkbox stays live (regression)', () => {
  it('re-derives the InstallDialog entry from the current catalog query, so acking a manual step checks the box once the catalog refetches', async () => {
    const { rerender } = render(<AppsPage />);

    // Open the update dialog straight onto the Done screen (job already succeeded).
    fireEvent.click(screen.getByRole('button', { name: /update to v2\.0\.0/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm update/i }));

    const checkbox = await screen.findByRole('checkbox', { name: /configure bucket cors/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(ackTrigger).toHaveBeenCalledWith({ id: 'installed-1', stepId: 'bucket-cors' });

    // Simulate the server ack completing and ackManualStep's `invalidatesTags`
    // causing `useGetAppCatalogQuery` to refetch with the updated entry, then
    // force AppsPage to re-render against that new query result (mirroring
    // the re-render RTK Query itself triggers on a real cache update). If
    // AppsPage were still holding a point-in-time snapshot of `entry` (the
    // bug), this new catalog data would never reach InstallDialog and the
    // checkbox would stay unchecked forever.
    catalogResult = { data: { data: [makeEntry(['bucket-cors'])] }, isLoading: false, isError: false };
    rerender(<AppsPage />);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /configure bucket cors/i })).toBeChecked();
    });
  });
});
