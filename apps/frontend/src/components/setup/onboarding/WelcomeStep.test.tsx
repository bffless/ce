import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeStep } from './WelcomeStep';

const DOCS_URL = 'https://docs.bffless.dev/getting-started/first-deployment/';

describe('WelcomeStep', () => {
  afterEach(cleanup);

  it('links to the first-deployment guide in a new tab', () => {
    render(<WelcomeStep onNext={vi.fn()} onSkip={vi.fn()} />);

    const link = screen.getByRole('link', { name: /first-deployment guide/i });
    expect(link).toHaveAttribute('href', DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('does not embed the YouTube iframe until play is pressed', async () => {
    render(<WelcomeStep onNext={vi.fn()} onSkip={vi.fn()} />);

    // Facade only — no third-party frame on first render.
    expect(document.querySelector('iframe')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /play video/i }));

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    // youtube-nocookie keeps a self-hosted install off Google's cookie domain.
    expect(iframe?.getAttribute('src')).toContain(
      'https://www.youtube-nocookie.com/embed/cNqh02HyD0s'
    );
  });

  it('advances on Get Started and dismisses on Skip for now', async () => {
    const onNext = vi.fn();
    const onSkip = vi.fn();
    render(<WelcomeStep onNext={onNext} onSkip={onSkip} />);

    await userEvent.click(screen.getByRole('button', { name: 'Get Started' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('drops the thumbnail image when it fails to load, keeping the play control', () => {
    render(<WelcomeStep onNext={vi.fn()} onSkip={vi.fn()} />);

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    // A locked-down network (or blocked i.ytimg.com) must not leave a broken image.
    fireEvent.error(img!);

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /play video/i })).toBeInTheDocument();
  });
});
