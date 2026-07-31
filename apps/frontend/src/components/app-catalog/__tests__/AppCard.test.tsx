import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AppCard } from '../AppCard';
import type { CatalogEntry } from '@/services/appCatalogApi';

vi.mock('@/services/appCatalogApi', () => ({
  useUpdateAppMutation: () => [vi.fn(), { isLoading: false }],
  useUninstallAppMutation: () => [vi.fn(), { isLoading: false }],
  useGetUninstallPreviewQuery: () => ({ data: undefined, isLoading: false }),
  useLazyGetEjectPayloadQuery: () => [vi.fn(), { data: undefined, isLoading: false }],
}));

const baseEntry: CatalogEntry = {
  id: 'handoff',
  name: 'Handoff',
  summary: 'Share files with clients',
  gates: [],
  installable: true,
};

describe('AppCard', () => {
  it('renders an enabled Install button when installable', () => {
    render(<AppCard entry={baseEntry} onInstall={vi.fn()} />);

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

    render(<AppCard entry={entry} onInstall={vi.fn()} />);

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

    render(<AppCard entry={entry} onInstall={vi.fn()} />);

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

    render(<AppCard entry={entry} onInstall={vi.fn()} />);

    expect(screen.getByRole('button', { name: /update to v2\.0\.0/i })).toBeInTheDocument();
  });
});
