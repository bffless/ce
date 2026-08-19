import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppCard } from '../AppCard';
import type { CatalogEntry } from '@/services/appCatalogApi';

const updateTrigger = vi.fn();

vi.mock('@/services/appCatalogApi', () => ({
  useUpdateAppMutation: () => [updateTrigger, { isLoading: false }],
  useUninstallAppMutation: () => [vi.fn(), { isLoading: false }],
  useGetUninstallPreviewQuery: () => ({ data: undefined }),
  useGetEjectPayloadQuery: () => ({ data: undefined, isFetching: false }),
}));

vi.mock('@/services/apiKeysApi', () => ({
  useCreateApiKeyMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const baseEntry: CatalogEntry = {
  id: 'handoff',
  name: 'Handoff',
  summary: 'Share files with clients',
  gates: [],
  installable: true,
  installs: [],
};

const installA: CatalogEntry['installs'][number] = {
  installedAppId: 'installed-1',
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: '1.2.0',
  projectId: 'proj-1',
  projectName: 'acme/handoff',
  alias: 'production',
  appUrl: 'https://handoff.example.com',
  status: 'installed',
  updateAvailable: true,
  manualSteps: [],
};
const installB: CatalogEntry['installs'][number] = {
  ...installA,
  installedAppId: 'installed-2',
  projectId: 'proj-2',
  projectName: 'acme/blog',
  appUrl: 'https://handoff-blog.example.com',
  version: '2.0.0',
  updateAvailable: false,
};

function renderCard(entry: CatalogEntry, overrides: Partial<Parameters<typeof AppCard>[0]> = {}) {
  const props = {
    entry,
    onInstall: vi.fn(),
    onDetails: vi.fn(),
    onUpdateStarted: vi.fn(),
    onUpdateAll: vi.fn(),
    ...overrides,
  };
  render(<AppCard {...props} />);
  return props;
}

beforeEach(() => {
  updateTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
});

describe('AppCard', () => {
  it('renders an enabled Install button when installable', () => {
    render(
      <AppCard
        entry={baseEntry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: /install/i });
    expect(button).toBeEnabled();
  });

  it('disables the CTA with the failing gate message when a gate fails', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      installable: false,
      gates: [
        {
          id: 'storage',
          status: 'fail',
          message: 'Requires bucket storage',
          remediation: 'Switch to S3/MinIO/GCS/Azure storage in Admin Settings.',
          deepLink: '/admin/settings/infrastructure',
        },
      ],
    };

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    expect(screen.getByText('Requires bucket storage')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /requires bucket storage/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: /why\?/i })).toBeInTheDocument();
  });

  it('shows the Installed badge and an Open link when installed', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
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

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    expect(screen.getByText('Installed · v1.2.0')).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: /open/i });
    expect(openLink).toHaveAttribute('href', 'https://handoff.example.com');
  });

  it('shows the Update CTA when an update is available', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      registryVersion: '2.0.0',
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
          updateAvailable: true,
          manualSteps: [],
        },
      ],
    };

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /update to v2\.0\.0/i })).toBeInTheDocument();
  });

  it('disables the Update CTA with the gate message when an instance gate fails', () => {
    // An update re-runs the instance gates server-side and would refuse at
    // its preflight step, so the CTA must not look actionable.
    const entry: CatalogEntry = {
      ...baseEntry,
      installable: false,
      registryVersion: '2.0.0',
      gates: [
        {
          id: 'ce-version',
          status: 'fail',
          message: 'Requires CE v0.4.0 or later',
          remediation: 'Upgrade this BFFless CE instance to v0.4.0 or later.',
        },
      ],
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
          updateAvailable: true,
          manualSteps: [],
        },
      ],
    };

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /update to v2\.0\.0/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /requires ce v0\.4\.0 or later/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /why\?/i })).toBeInTheDocument();
    expect(updateTrigger).not.toHaveBeenCalled();
  });

  it('opens a confirm popover with the prune toggle defaulted off, and fires the update with prune: false', async () => {
    const onUpdateStarted = vi.fn();
    const entry: CatalogEntry = {
      ...baseEntry,
      registryVersion: '2.0.0',
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
          updateAvailable: true,
          manualSteps: [],
        },
      ],
    };

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={onUpdateStarted}
        onUpdateAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /update to v2\.0\.0/i }));

    const pruneToggle = screen.getByRole('switch', {
      name: /reset to the app's shipped rules \(prune\)/i,
    });
    expect(pruneToggle).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /confirm update/i }));

    expect(updateTrigger).toHaveBeenCalledWith({ id: 'installed-1', prune: false });
    await vi.waitFor(() => {
      expect(onUpdateStarted).toHaveBeenCalledWith(entry, 'job-1');
    });
  });

  it('renders the registry thumbnail and category badge', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      category: 'files',
      thumbnailUrl: 'https://apps.example.com/assets/handoff/thumbnail.png',
    };

    const { container } = render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    expect(screen.getByText('files')).toBeInTheDocument();
    expect(container.querySelector(`img[src="${entry.thumbnailUrl}"]`)).toBeInTheDocument();
  });

  it('offers no Details affordance when the entry carries no store metadata', () => {
    // A de-listed installed app renders from its stored manifest, which never
    // carries description/screenshots — a Details button would open nothing.
    render(
      <AppCard
        entry={baseEntry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /^details$/i })).not.toBeInTheDocument();
  });

  it('opens details from the footer button and from the thumbnail', () => {
    const onDetails = vi.fn();
    const entry: CatalogEntry = {
      ...baseEntry,
      description: '## Handoff\n\nShare files.',
      thumbnailUrl: 'https://apps.example.com/assets/handoff/thumbnail.png',
    };

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={onDetails}
        onUpdateStarted={vi.fn()}
        onUpdateAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^details$/i }));
    expect(onDetails).toHaveBeenCalledWith(entry);

    fireEvent.click(screen.getByRole('button', { name: /handoff details/i }));
    expect(onDetails).toHaveBeenCalledTimes(2);
  });

  it('fires the update with prune: true when the toggle is switched on', async () => {
    const onUpdateStarted = vi.fn();
    const entry: CatalogEntry = {
      ...baseEntry,
      registryVersion: '2.0.0',
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
          updateAvailable: true,
          manualSteps: [],
        },
      ],
    };

    render(
      <AppCard
        entry={entry}
        onInstall={vi.fn()}
        onDetails={vi.fn()}
        onUpdateStarted={onUpdateStarted}
        onUpdateAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /update to v2\.0\.0/i }));
    fireEvent.click(
      screen.getByRole('switch', { name: /reset to the app's shipped rules \(prune\)/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /confirm update/i }));

    expect(updateTrigger).toHaveBeenCalledWith({ id: 'installed-1', prune: true });
  });

  describe('setup notes', () => {
    const installedWithNotes: CatalogEntry = {
      ...baseEntry,
      installs: [
        {
          installedAppId: 'installed-1',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          version: '1.0.0',
          projectId: 'proj-1',
          projectName: 'acme/site',
          alias: 'reader',
          appUrl: 'https://reader.example.com',
          status: 'installed',
          updateAvailable: false,
          manualSteps: [
            {
              id: 'grant-access',
              title: 'Give other people access',
              body: 'Rivulet is private. Add each person as a guest.',
              deepLink: '/repo/acme/site/settings?tab=members',
            },
          ],
        },
      ],
    };

    it('shows the note title on an installed card', () => {
      render(
        <AppCard
          entry={installedWithNotes}
          onInstall={vi.fn()}
          onDetails={vi.fn()}
          onUpdateStarted={vi.fn()}
          onUpdateAll={vi.fn()}
        />,
      );

      expect(screen.getByText('Give other people access')).toBeInTheDocument();
      expect(screen.queryByText(/Rivulet is private/)).not.toBeInTheDocument();
    });

    it('expands the body in place', async () => {
      render(
        <AppCard
          entry={installedWithNotes}
          onInstall={vi.fn()}
          onDetails={vi.fn()}
          onUpdateStarted={vi.fn()}
          onUpdateAll={vi.fn()}
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

      expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
    });

    it('renders no setup notes block when the app has none', () => {
      const entry: CatalogEntry = {
        ...installedWithNotes,
        installs: [{ ...installedWithNotes.installs[0], manualSteps: [] }],
      };
      render(
        <AppCard
          entry={entry}
          onInstall={vi.fn()}
          onDetails={vi.fn()}
          onUpdateStarted={vi.fn()}
          onUpdateAll={vi.fn()}
        />,
      );

      expect(screen.queryByText(/Setup notes/)).not.toBeInTheDocument();
    });

    it('renders no setup notes block when the app is not installed', () => {
      render(
        <AppCard
          entry={baseEntry}
          onInstall={vi.fn()}
          onDetails={vi.fn()}
          onUpdateStarted={vi.fn()}
          onUpdateAll={vi.fn()}
        />,
      );

      expect(screen.queryByText(/Setup notes/)).not.toBeInTheDocument();
    });
  });

  describe('one install', () => {
    it('offers "Install in another project" in the overflow menu, wired to onInstall', async () => {
      const entry: CatalogEntry = {
        ...baseEntry,
        installs: [{ ...installA, updateAvailable: false }],
      };
      const props = renderCard(entry);

      // No primary Install CTA next to "Installed" — installing again is in the overflow.
      expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /more actions/i }));
      await userEvent.click(
        await screen.findByRole('menuitem', { name: /install in another project/i }),
      );

      expect(props.onInstall).toHaveBeenCalledWith(entry);
    });
  });

  describe('several installs', () => {
    const twoInstalls: CatalogEntry = {
      ...baseEntry,
      registryVersion: '2.0.0',
      installs: [installA, installB],
    };

    it('summarises the installs and the pending updates instead of acting on one', () => {
      renderCard(twoInstalls);

      expect(screen.getByText('Installed in 2 projects · 1 update available')).toBeInTheDocument();
      // Per-install actions live in the details dialog, not on the card.
      expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /update to v2\.0\.0/i })).not.toBeInTheDocument();
    });

    it('"Update all (k)" hands off to onUpdateAll and "Manage installs" to onDetails', () => {
      const props = renderCard(twoInstalls);

      fireEvent.click(screen.getByRole('button', { name: /update all \(1\)/i }));
      expect(props.onUpdateAll).toHaveBeenCalledWith(twoInstalls);

      fireEvent.click(screen.getByRole('button', { name: /manage installs/i }));
      expect(props.onDetails).toHaveBeenCalledWith(twoInstalls);
    });

    it('hides "Update all" when no install has an update, keeps Manage installs', () => {
      renderCard({ ...twoInstalls, installs: [{ ...installA, updateAvailable: false }, installB] });

      expect(screen.queryByRole('button', { name: /update all/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /manage installs/i })).toBeInTheDocument();
      expect(screen.getByText('Installed in 2 projects')).toBeInTheDocument();
    });

    it('still offers "Install in another project" in the overflow', async () => {
      const props = renderCard(twoInstalls);

      await userEvent.click(screen.getByRole('button', { name: /more actions/i }));
      await userEvent.click(
        await screen.findByRole('menuitem', { name: /install in another project/i }),
      );

      expect(props.onInstall).toHaveBeenCalledWith(twoInstalls);
    });
  });
});
