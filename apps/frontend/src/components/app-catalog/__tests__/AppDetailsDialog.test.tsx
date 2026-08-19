import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppDetailsDialog } from '../AppDetailsDialog';
import { hasAppDetails } from '../catalogEntry';
import type { CatalogEntry } from '@/services/appCatalogApi';
import type { SequentialUpdates } from '../useSequentialUpdates';

const updateTrigger = vi.fn();
const batch: SequentialUpdates = { states: {}, running: false, start: vi.fn() };

vi.mock('@/services/appCatalogApi', () => ({
  useUpdateAppMutation: () => [updateTrigger, { isLoading: false }],
  useUninstallAppMutation: () => [vi.fn(), { isLoading: false }],
  useGetUninstallPreviewQuery: () => ({ data: undefined }),
  useGetEjectPayloadQuery: () => ({ data: undefined, isFetching: false }),
}));
vi.mock('@/services/apiKeysApi', () => ({
  useCreateApiKeyMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The batch runner talks to the store; its sequencing is covered in
// useSequentialUpdates.test.ts. Here it's a stub whose calls/state we control.
vi.mock('../useSequentialUpdates', () => ({ useSequentialUpdates: () => batch }));

beforeEach(() => {
  updateTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
  (batch.start as ReturnType<typeof vi.fn>).mockReset();
  batch.states = {};
  batch.running = false;
});

const baseEntry: CatalogEntry = {
  id: 'handoff',
  name: 'Handoff',
  summary: 'Share files with clients',
  category: 'files',
  registryVersion: '1.0.0',
  description: '## Highlights\n\n- **Per-folder access control**\n- Share links\n',
  screenshots: [
    'https://apps.example.com/assets/handoff/screenshots/01.png',
    'https://apps.example.com/assets/handoff/screenshots/02.png',
  ],
  docsUrl: 'https://example.com/docs',
  sourceUrl: 'https://github.com/bffless/apps',
  gates: [],
  installable: true,
  installs: [],
};

const installA: CatalogEntry['installs'][number] = {
  installedAppId: 'installed-1',
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: '1.0.0',
  projectId: 'proj-1',
  projectName: 'acme/handoff',
  alias: 'production',
  appUrl: 'https://handoff.example.com',
  status: 'installed',
  updateAvailable: false,
  manualSteps: [],
};
const installB: CatalogEntry['installs'][number] = {
  ...installA,
  installedAppId: 'installed-2',
  projectId: 'proj-2',
  projectName: 'acme/blog',
  appUrl: 'https://handoff-blog.example.com',
  version: '0.9.0',
  updateAvailable: true,
  manualSteps: [{ id: 'cors', title: 'Configure CORS', body: 'Allow the app origin.' }],
};

/** Direct rows of the installs list (setup notes and markdown render nested <li>s of their own). */
function installRows(): HTMLElement[] {
  const list = screen.getByRole('list', { name: /installed projects/i });
  return Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
}

function renderDialog(
  entry: CatalogEntry,
  overrides: Partial<Parameters<typeof AppDetailsDialog>[0]> = {},
) {
  const props = {
    entry,
    open: true,
    onOpenChange: vi.fn(),
    onInstall: vi.fn(),
    onUpdateStarted: vi.fn(),
    ...overrides,
  };
  render(<AppDetailsDialog {...props} />);
  return props;
}

describe('hasAppDetails', () => {
  it('is true when there is a description, screenshots, or at least one install', () => {
    expect(hasAppDetails(baseEntry)).toBe(true);
    expect(hasAppDetails({ ...baseEntry, description: undefined })).toBe(true);
    expect(hasAppDetails({ ...baseEntry, screenshots: [] })).toBe(true);
    expect(hasAppDetails({ ...baseEntry, description: undefined, screenshots: [] })).toBe(false);
    // An installed app always has a details view: that's where its installs are managed.
    expect(
      hasAppDetails({
        ...baseEntry,
        description: undefined,
        screenshots: [],
        installs: [installA],
      }),
    ).toBe(true);
  });
});

describe('AppDetailsDialog', () => {
  it('renders the markdown description, screenshots, category and links', () => {
    const { container } = render(
      <AppDetailsDialog
        entry={baseEntry}
        open
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        onUpdateStarted={vi.fn()}
      />,
    );

    // Markdown is rendered as markup, not printed as source.
    expect(screen.getByRole('heading', { name: 'Highlights' })).toBeInTheDocument();
    expect(screen.getByText('Per-folder access control')).toBeInTheDocument();
    expect(screen.queryByText(/^## Highlights/)).not.toBeInTheDocument();

    expect(screen.getAllByAltText('Handoff screenshot')).toHaveLength(2);
    expect(screen.getByText('files')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /documentation/i })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('does not render raw HTML embedded in the description', () => {
    // The description comes from whatever registry the instance points at —
    // react-markdown must stay without rehype-raw so HTML stays inert text.
    render(
      <AppDetailsDialog
        entry={{ ...baseEntry, description: '<img src="x" onerror="alert(1)">hello' }}
        open
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        onUpdateStarted={vi.fn()}
      />,
    );

    expect(screen.queryByAltText('')).toBeNull();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it('hands off to the install wizard when Install is clicked', () => {
    const onInstall = vi.fn();
    render(
      <AppDetailsDialog
        entry={baseEntry}
        open
        onOpenChange={vi.fn()}
        onInstall={onInstall}
        onUpdateStarted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    expect(onInstall).toHaveBeenCalledWith(baseEntry);
  });

  it('blocks Install behind a failing instance gate', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      installable: false,
      gates: [
        {
          id: 'storage',
          status: 'fail',
          message: 'Requires bucket storage',
          remediation: 'Switch to S3/MinIO/GCS/Azure storage in Admin Settings.',
        },
      ],
    };

    render(
      <AppDetailsDialog
        entry={entry}
        open
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        onUpdateStarted={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /requires bucket storage/i })).toBeDisabled();
  });

  it('shows Open and "Install in another project" for a single-install app', () => {
    const entry: CatalogEntry = { ...baseEntry, installs: [installA] };
    const props = renderDialog(entry);

    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
    // Footer Open (the sole install) plus the row's Open — both point at the same host.
    for (const link of screen.getAllByRole('link', { name: /open/i })) {
      expect(link).toHaveAttribute('href', 'https://handoff.example.com');
    }
    expect(screen.getByText('Installed · v1.0.0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /install in another project/i }));
    expect(props.onInstall).toHaveBeenCalledWith(entry);
  });

  describe('installs section', () => {
    const twoInstalls: CatalogEntry = {
      ...baseEntry,
      registryVersion: '1.0.0',
      installs: [installA, installB],
    };

    it('lists every install with project, host, version and per-install actions', () => {
      renderDialog(twoInstalls);

      const section = screen.getByRole('region', { name: /installs/i });
      expect(within(section).getByText('Installed in 2 projects')).toBeInTheDocument();
      const rows = installRows();
      expect(rows).toHaveLength(2);

      expect(within(rows[0]).getByText('acme/handoff')).toBeInTheDocument();
      expect(within(rows[0]).getByText('v1.0.0')).toBeInTheDocument();
      expect(within(rows[0]).getByText(/handoff\.example\.com/)).toBeInTheDocument();
      expect(within(rows[0]).queryByRole('button', { name: /update to/i })).not.toBeInTheDocument();

      expect(within(rows[1]).getByText('acme/blog')).toBeInTheDocument();
      expect(within(rows[1]).getByText('v0.9.0')).toBeInTheDocument();
      expect(
        within(rows[1]).getByRole('button', { name: /update to v1\.0\.0/i }),
      ).toBeInTheDocument();
      expect(within(rows[1]).getByRole('link', { name: /open/i })).toHaveAttribute(
        'href',
        'https://handoff-blog.example.com',
      );
      // Setup notes are per install.
      expect(within(rows[1]).getByText('Configure CORS')).toBeInTheDocument();
      expect(within(rows[0]).queryByText('Configure CORS')).not.toBeInTheDocument();
      // No single footer Open when the dialog can't know which install is meant.
      expect(screen.getAllByRole('link', { name: /open/i })).toHaveLength(2);
    });

    it('fires a per-install update for the right row and hands the job to onUpdateStarted', async () => {
      const props = renderDialog(twoInstalls);
      const rows = installRows();

      fireEvent.click(within(rows[1]).getByRole('button', { name: /update to v1\.0\.0/i }));
      fireEvent.click(await screen.findByRole('button', { name: /confirm update/i }));

      expect(updateTrigger).toHaveBeenCalledWith({ id: 'installed-2', prune: false });
      await vi.waitFor(() =>
        expect(props.onUpdateStarted).toHaveBeenCalledWith(twoInstalls, 'job-1'),
      );
    });

    it('offers "Update all" only when two or more installs have an update, and starts the batch with them', () => {
      const bothUpdatable: CatalogEntry = {
        ...twoInstalls,
        installs: [{ ...installA, updateAvailable: true }, installB],
      };
      renderDialog(bothUpdatable);

      fireEvent.click(screen.getByRole('button', { name: /update all \(2\)/i }));
      expect(batch.start).toHaveBeenCalledWith(bothUpdatable.installs, false);
    });

    it('arms the batch on mount when autoUpdateAll is set', () => {
      const bothUpdatable: CatalogEntry = {
        ...twoInstalls,
        installs: [{ ...installA, updateAvailable: true }, installB],
      };
      renderDialog(bothUpdatable, { autoUpdateAll: true });

      expect(batch.start).toHaveBeenCalledTimes(1);
      expect(batch.start).toHaveBeenCalledWith(bothUpdatable.installs, false);
    });

    it('renders batch progress inline and swaps Update for View / Review conflicts', () => {
      batch.running = true;
      batch.states = {
        'installed-1': { status: 'running', jobId: 'job-a' },
        'installed-2': { status: 'queued' },
      };
      const bothUpdatable: CatalogEntry = {
        ...twoInstalls,
        installs: [{ ...installA, updateAvailable: true }, installB],
      };
      const { rerender } = render(
        <AppDetailsDialog
          entry={bothUpdatable}
          open
          onOpenChange={vi.fn()}
          onInstall={vi.fn()}
          onUpdateStarted={vi.fn()}
        />,
      );
      let rows = installRows();
      expect(within(rows[0]).getByText('Updating')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Queued')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /updating…/i })).toBeDisabled();

      batch.running = false;
      batch.states = {
        'installed-1': { status: 'succeeded', jobId: 'job-a' },
        'installed-2': { status: 'conflicts', jobId: 'job-b' },
      };
      const onUpdateStarted = vi.fn();
      rerender(
        <AppDetailsDialog
          entry={bothUpdatable}
          open
          onOpenChange={vi.fn()}
          onInstall={vi.fn()}
          onUpdateStarted={onUpdateStarted}
        />,
      );
      rows = installRows();
      expect(within(rows[0]).getByText('Updated')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Updated · conflicts')).toBeInTheDocument();
      fireEvent.click(within(rows[1]).getByRole('button', { name: /review conflicts/i }));
      expect(onUpdateStarted).toHaveBeenCalledWith(bothUpdatable, 'job-b');
    });

    it('uninstall from a row targets that install', async () => {
      renderDialog(twoInstalls);
      const rows = installRows();

      await userEvent.click(
        within(rows[1]).getByRole('button', { name: /more actions for acme\/blog/i }),
      );
      await userEvent.click(await screen.findByRole('menuitem', { name: /uninstall/i }));

      expect(await screen.findByText(/from acme\/blog\./)).toBeInTheDocument();
    });
  });
});
