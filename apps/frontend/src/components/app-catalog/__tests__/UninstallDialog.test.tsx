import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { UninstallDialog } from '../UninstallDialog';
import type { CatalogEntry, UninstallPreview, UninstallSummary } from '@/services/appCatalogApi';

const uninstallTrigger = vi.fn();
const getUninstallPreviewQueryMock = vi.fn<
  (id: string, options?: { skip?: boolean }) => { data?: UninstallPreview }
>(() => previewState);

let previewState: { data?: UninstallPreview } = { data: undefined };
let uninstallState: { isLoading: boolean } = { isLoading: false };
const toastMock = vi.fn();

vi.mock('@/services/appCatalogApi', () => ({
  useGetUninstallPreviewQuery: (id: string, options?: { skip?: boolean }) =>
    getUninstallPreviewQueryMock(id, options),
  useUninstallAppMutation: () => [uninstallTrigger, uninstallState],
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const baseSummary: UninstallSummary = {
  removed: { ruleSets: 1, alias: true, domain: true, deployment: true, schedules: 0 },
  dataTables: { kept: [], deleted: [], deletedRecordCounts: {} },
  note: 'Handoff was uninstalled.',
};

const entry: CatalogEntry = {
  id: 'handoff',
  name: 'Handoff',
  gates: [],
  installable: true,
  installs: [
    {
      installedAppId: 'installed-1',
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: '1.2.0',
      projectId: 'proj-1',
      projectName: 'acme/handoff',
      alias: 'production',
      appUrl: 'https://handoff.example.com',
      status: 'installed',
      updateAvailable: false,
      manualSteps: [],
    },
  ],
};
const install = entry.installs[0];

function makePreview(overrides: Partial<UninstallPreview> = {}): UninstallPreview {
  return {
    dataTables: [
      { name: 'files', recordCount: 42, createdByInstall: true },
      { name: 'shares', recordCount: 7, createdByInstall: true },
      { name: 'users', recordCount: 100, createdByInstall: false },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  uninstallTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve(baseSummary) });
  getUninstallPreviewQueryMock.mockClear();
  previewState = { data: makePreview() };
  uninstallState = { isLoading: false };
  toastMock.mockReset();
});

describe('UninstallDialog', () => {
  it('shows the default keeps-data copy without the checkbox checked', () => {
    render(<UninstallDialog entry={entry} install={install} open onOpenChange={vi.fn()} />);

    expect(
      screen.getByText(
        "Removes the app's rule sets, alias, domain, and deployment from acme/handoff. Your data tables and uploaded files are kept.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /also delete the app's data tables/i }),
    ).not.toBeChecked();
    expect(screen.queryByText(/this deletes/i)).not.toBeInTheDocument();
  });

  it('reveals the real record counts only after the checkbox is checked', () => {
    render(<UninstallDialog entry={entry} install={install} open onOpenChange={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox', { name: /also delete the app's data tables/i });
    fireEvent.click(checkbox);

    // 42 + 7 = 49 records across the 2 tables createdByInstall: true
    expect(screen.getByText('this deletes 49 records across 2 tables')).toBeInTheDocument();
  });

  it('lists reused tables as kept regardless of the checkbox', () => {
    render(<UninstallDialog entry={entry} install={install} open onOpenChange={vi.fn()} />);

    expect(screen.getByText(/users/)).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', { name: /also delete the app's data tables/i });
    fireEvent.click(checkbox);

    expect(screen.getByText(/users/)).toBeInTheDocument();
  });

  it('confirms uninstall with deleteData: false by default', () => {
    render(<UninstallDialog entry={entry} install={install} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^uninstall$/i }));

    expect(uninstallTrigger).toHaveBeenCalledWith({ id: 'installed-1', deleteData: false });
  });

  it('confirms uninstall with deleteData: true when the checkbox is checked', () => {
    render(<UninstallDialog entry={entry} install={install} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /also delete the app's data tables/i }));
    fireEvent.click(screen.getByRole('button', { name: /^uninstall$/i }));

    expect(uninstallTrigger).toHaveBeenCalledWith({ id: 'installed-1', deleteData: true });
  });

  it('shows a summary toast and closes the dialog on success', async () => {
    const onOpenChange = vi.fn();
    render(<UninstallDialog entry={entry} install={install} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^uninstall$/i }));

    await vi.waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('surfaces partial-failure uninstall as a destructive toast, keeps the dialog open, and lets retry re-fire the mutation', async () => {
    const onOpenChange = vi.fn();
    const partialSummary: UninstallSummary = {
      ...baseSummary,
      failures: ['ruleSet:handoff-api', 'domain:handoff.example.com'],
    };
    uninstallTrigger.mockReturnValue({ unwrap: () => Promise.resolve(partialSummary) });

    render(<UninstallDialog entry={entry} install={install} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^uninstall$/i }));

    await vi.waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Uninstall incomplete',
          variant: 'destructive',
        }),
      );
    });

    // Dialog stays open — onOpenChange is never told to close.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Failures are surfaced in the dialog body too.
    expect(screen.getByText(/ruleSet:handoff-api/)).toBeInTheDocument();
    expect(screen.getByText(/domain:handoff\.example\.com/)).toBeInTheDocument();

    // Retrying re-fires the same mutation.
    uninstallTrigger.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /retry uninstall/i }));
    expect(uninstallTrigger).toHaveBeenCalledWith({ id: 'installed-1', deleteData: false });
  });
});
