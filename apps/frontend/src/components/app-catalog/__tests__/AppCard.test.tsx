import { render, screen, fireEvent } from '@testing-library/react';
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
};

beforeEach(() => {
  updateTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
});

describe('AppCard', () => {
  it('renders an enabled Install button when installable', () => {
    render(<AppCard entry={baseEntry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />);

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

    render(<AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />);

    expect(screen.getByText('Requires bucket storage')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /requires bucket storage/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: /why\?/i })).toBeInTheDocument();
  });

  it('shows the Installed badge and an Open link when installed', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      installed: {
        installedAppId: 'installed-1',
        version: '1.2.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: false,
        manualSteps: [],
        manualStepsAcked: [],
      },
    };

    render(<AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />);

    expect(screen.getByText('Installed · v1.2.0')).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: /open/i });
    expect(openLink).toHaveAttribute('href', 'https://handoff.example.com');
  });

  it('shows the Update CTA when an update is available', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      registryVersion: '2.0.0',
      installed: {
        installedAppId: 'installed-1',
        version: '1.2.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: true,
        manualSteps: [],
        manualStepsAcked: [],
      },
    };

    render(<AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />);

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
      installed: {
        installedAppId: 'installed-1',
        version: '1.2.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: true,
        manualSteps: [],
        manualStepsAcked: [],
      },
    };

    render(<AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />);

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
      installed: {
        installedAppId: 'installed-1',
        version: '1.2.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: true,
        manualSteps: [],
        manualStepsAcked: [],
      },
    };

    render(<AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={onUpdateStarted} />);

    fireEvent.click(screen.getByRole('button', { name: /update to v2\.0\.0/i }));

    const pruneToggle = screen.getByRole('switch', { name: /reset to the app's shipped rules \(prune\)/i });
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
      <AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />,
    );

    expect(screen.getByText('files')).toBeInTheDocument();
    expect(container.querySelector(`img[src="${entry.thumbnailUrl}"]`)).toBeInTheDocument();
  });

  it('offers no Details affordance when the entry carries no store metadata', () => {
    // A de-listed installed app renders from its stored manifest, which never
    // carries description/screenshots — a Details button would open nothing.
    render(
      <AppCard entry={baseEntry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={vi.fn()} />,
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
      <AppCard entry={entry} onInstall={vi.fn()} onDetails={onDetails} onUpdateStarted={vi.fn()} />,
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
      installed: {
        installedAppId: 'installed-1',
        version: '1.2.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: true,
        manualSteps: [],
        manualStepsAcked: [],
      },
    };

    render(<AppCard entry={entry} onInstall={vi.fn()} onDetails={vi.fn()} onUpdateStarted={onUpdateStarted} />);

    fireEvent.click(screen.getByRole('button', { name: /update to v2\.0\.0/i }));
    fireEvent.click(screen.getByRole('switch', { name: /reset to the app's shipped rules \(prune\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm update/i }));

    expect(updateTrigger).toHaveBeenCalledWith({ id: 'installed-1', prune: true });
  });
});
