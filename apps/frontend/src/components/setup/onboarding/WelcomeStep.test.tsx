import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeStep } from './WelcomeStep';
import { APP_STORE_URL, DOCS } from '@/lib/docsLinks';

const DOCS_URL = DOCS.gettingStarted.firstDeployment;

function renderStep(overrides: Partial<Parameters<typeof WelcomeStep>[0]> = {}) {
  const props = {
    onNext: vi.fn(),
    onSkip: vi.fn(),
    onInstallApps: vi.fn(),
    showAppsPath: false,
    ...overrides,
  };
  render(<WelcomeStep {...props} />);
  return props;
}

describe('WelcomeStep', () => {
  afterEach(cleanup);

  it('links to the first-deployment guide in a new tab', () => {
    renderStep();

    const link = screen.getByRole('link', { name: /first-deployment guide/i });
    expect(link).toHaveAttribute('href', DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('does not embed the YouTube iframe until play is pressed', async () => {
    renderStep();

    // Facade only — no third-party frame on first render.
    expect(document.querySelector('iframe')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /play video/i }));

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    // youtube-nocookie keeps a self-hosted install off Google's cookie domain.
    expect(iframe?.getAttribute('src')).toContain(
      'https://www.youtube-nocookie.com/embed/cNqh02HyD0s',
    );
  });

  it('advances on Get Started and dismisses on Skip for now', async () => {
    const { onNext, onSkip } = renderStep();

    await userEvent.click(screen.getByRole('button', { name: 'Get Started' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('drops the thumbnail image when it fails to load, keeping the play control', () => {
    renderStep();

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    // A locked-down network (or blocked i.ytimg.com) must not leave a broken image.
    fireEvent.error(img!);

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /play video/i })).toBeInTheDocument();
  });

  it('hides the apps path entirely for non-admins', () => {
    renderStep({ showAppsPath: false });

    expect(screen.queryByRole('button', { name: 'Browse apps' })).toBeNull();
    expect(screen.queryByText(/ready-made app/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument();
  });

  it('shows both path cards for admins, with the apps card wired to onInstallApps', async () => {
    const { onInstallApps, onNext } = renderStep({ showAppsPath: true });

    expect(screen.getByText('Install a ready-made app')).toBeInTheDocument();
    expect(screen.getByText('Deploy your own site')).toBeInTheDocument();
    // The single-path CTA is replaced by the two cards' own buttons.
    expect(screen.queryByRole('button', { name: 'Get Started' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Browse apps' }));
    expect(onInstallApps).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Create a repository' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('links the apps card to the public store in a new tab', () => {
    renderStep({ showAppsPath: true });

    const link = screen.getByRole('link', { name: /see what.s available/i });
    expect(link).toHaveAttribute('href', APP_STORE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('keeps Skip for now available on the two-path layout', async () => {
    const { onSkip } = renderStep({ showAppsPath: true });

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
