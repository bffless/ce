import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { AppsPage } from './AppsPage';
import type {
  AppManualStep,
  CatalogEntry,
  CatalogListResult,
  InstallJob,
} from '@/services/appCatalogApi';

// --- appCatalogApi -----------------------------------------------------
// `catalogResult` is reassigned between renders to simulate the RTK Query
// cache refreshing after a mutation invalidates the `AppCatalog` tag (e.g.
// updateApp). Because it's read fresh on every call, re-rendering AppsPage
// after reassigning it is equivalent to a real refetch.
let catalogResult: { data?: CatalogListResult; isLoading: boolean; isError: boolean };
const refetchMock = vi.fn();
const updateTrigger = vi.fn();
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

function makeEntry(manualSteps: AppManualStep[]): CatalogEntry {
  return {
    id: 'handoff',
    name: 'Handoff',
    summary: 'Share files with clients',
    gates: [],
    installable: true,
    registryVersion: '2.0.0',
    installs: [
      {
        installedAppId: 'installed-1',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: '1.0.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff-site',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: true,
        manualSteps,
      },
    ],
  };
}

const BUCKET_CORS_STEP: AppManualStep = {
  id: 'bucket-cors',
  title: 'Configure bucket CORS',
  body: 'Allow PUT from your app origin.',
};

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
  catalogResult = {
    data: { data: [makeEntry([BUCKET_CORS_STEP])] },
    isLoading: false,
    isError: false,
  };
  refetchMock.mockReset();
  updateTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
  jobQueryResult = { data: makeJob() };
  getInstallJobQueryMock.mockReset().mockImplementation(() => jobQueryResult);
});

describe('AppsPage — details dialog', () => {
  it('opens details from a card and swaps to the install wizard on Install', async () => {
    catalogResult = {
      data: {
        data: [
          {
            id: 'handoff',
            name: 'Handoff',
            summary: 'Share files with clients',
            description: '## Highlights\n\n- Per-folder access control',
            category: 'files',
            screenshots: ['https://apps.example.com/assets/handoff/screenshots/01.png'],
            gates: [],
            installs: [],
            installable: true,
            registryVersion: '1.0.0',
          },
        ],
      },
      isLoading: false,
      isError: false,
    };

    render(<AppsPage />);

    fireEvent.click(screen.getByRole('button', { name: /^details$/i }));
    expect(await screen.findByRole('heading', { name: 'Highlights' })).toBeInTheDocument();
    expect(screen.getByAltText('Handoff screenshot')).toBeInTheDocument();

    // Only one modal at a time: details closes, the install wizard opens.
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Highlights' })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/review what will change/i)).toBeInTheDocument();
  });
});

describe('AppsPage — Done-screen setup notes stay live (regression)', () => {
  it('re-derives the InstallDialog entry from the current catalog query, so a changed manual-steps list shows up once the catalog refetches', async () => {
    const { rerender } = render(<AppsPage />);

    // Open the update dialog straight onto the Done screen (job already succeeded).
    fireEvent.click(screen.getByRole('button', { name: /update to v2\.0\.0/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm update/i }));

    // The installed card behind the dialog now carries its own SetupNotes
    // block too (this task), so once the dialog reaches the Done screen the
    // same note title exists twice in the DOM (card + dialog) — scope to the
    // dialog to keep asserting on what this regression test actually cares
    // about: the Done screen's live-derived content.
    const dialog = await screen.findByRole('dialog', { name: /handoff updated/i });
    expect(within(dialog).getByText('Configure bucket CORS')).toBeInTheDocument();
    expect(within(dialog).queryByText('Rotate the signing secret')).not.toBeInTheDocument();

    // Simulate the update finishing server-side (e.g. a manual step's manifest
    // definition changed) and `updateApp`'s `invalidatesTags` causing
    // `useGetAppCatalogQuery` to refetch with a different manual-steps list,
    // then force AppsPage to re-render against that new query result
    // (mirroring the re-render RTK Query itself triggers on a real cache
    // update). If AppsPage were still holding a point-in-time snapshot of
    // `entry` (the bug), this new catalog data would never reach
    // InstallDialog and the stale step would stay on screen forever.
    catalogResult = {
      data: {
        data: [
          makeEntry([
            { id: 'rotate-secret', title: 'Rotate the signing secret', body: 'Do it in Settings.' },
          ]),
        ],
      },
      isLoading: false,
      isError: false,
    };
    rerender(<AppsPage />);

    await waitFor(() => {
      expect(within(dialog).getByText('Rotate the signing secret')).toBeInTheDocument();
    });
    expect(within(dialog).queryByText('Configure bucket CORS')).not.toBeInTheDocument();
  });
});
