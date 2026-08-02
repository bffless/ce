import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { AppDetailsDialog } from '../AppDetailsDialog';
import { hasAppDetails } from '../catalogEntry';
import type { CatalogEntry } from '@/services/appCatalogApi';

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
};

describe('hasAppDetails', () => {
  it('is true when there is a description or screenshots, false otherwise', () => {
    expect(hasAppDetails(baseEntry)).toBe(true);
    expect(hasAppDetails({ ...baseEntry, description: undefined })).toBe(true);
    expect(hasAppDetails({ ...baseEntry, screenshots: [] })).toBe(true);
    expect(hasAppDetails({ ...baseEntry, description: undefined, screenshots: [] })).toBe(false);
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
      />,
    );

    expect(screen.queryByAltText('')).toBeNull();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it('hands off to the install wizard when Install is clicked', () => {
    const onInstall = vi.fn();
    render(
      <AppDetailsDialog entry={baseEntry} open onOpenChange={vi.fn()} onInstall={onInstall} />,
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

    render(<AppDetailsDialog entry={entry} open onOpenChange={vi.fn()} onInstall={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /requires bucket storage/i })).toBeDisabled();
  });

  it('shows Open instead of Install for an installed app', () => {
    const entry: CatalogEntry = {
      ...baseEntry,
      installed: {
        installedAppId: 'installed-1',
        version: '1.0.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: false,
        manualSteps: [],
      },
    };

    render(<AppDetailsDialog entry={entry} open onOpenChange={vi.fn()} onInstall={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute(
      'href',
      'https://handoff.example.com',
    );
    expect(screen.getByText('Installed · v1.0.0')).toBeInTheDocument();
  });
});
