import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { SetupNotes } from '../SetupNotes';

const STEPS = [
  {
    id: 'grant-access',
    title: 'Give other people access',
    body: 'Rivulet is private. Add each person as a guest.',
    deepLink: '/repo/acme/site/settings?tab=members',
  },
  { id: 'provision-wildcard-cert', title: 'Turn on HTTPS for this app', body: 'Over HTTP now.' },
  {
    id: 'add-hf-token',
    title: 'Optional: HF_TOKEN for speaker diarization',
    body: 'Create a secret named HF_TOKEN.',
    deepLink: '/repo/acme/site/settings?tab=ai',
    externalLink: {
      label: 'Get a Hugging Face token',
      url: 'https://huggingface.co/settings/tokens',
    },
  },
];

describe('SetupNotes', () => {
  it('renders nothing when there are no steps', () => {
    const { container } = render(<SetupNotes steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows titles collapsed, bodies hidden', () => {
    render(<SetupNotes steps={STEPS} />);

    expect(screen.getByText('Give other people access')).toBeInTheDocument();
    expect(screen.getByText('Turn on HTTPS for this app')).toBeInTheDocument();
    expect(screen.queryByText(/Rivulet is private/)).not.toBeInTheDocument();
  });

  it('says CE cannot do these for you', () => {
    render(<SetupNotes steps={STEPS} />);
    expect(screen.getByText(/can't do these for you/i)).toBeInTheDocument();
  });

  it('expands one body on click without expanding the others', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

    expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
    expect(screen.queryByText('Over HTTP now.')).not.toBeInTheDocument();
  });

  it('renders the deep link once expanded', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

    expect(screen.getByRole('link', { name: /manage members|go/i })).toHaveAttribute(
      'href',
      '/repo/acme/site/settings?tab=members',
    );
  });

  it('shows every body from the start when defaultExpanded', () => {
    render(<SetupNotes steps={STEPS} defaultExpanded />);

    expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
    expect(screen.getByText('Over HTTP now.')).toBeInTheDocument();
  });

  it('renders the title with no empty paragraph when body is empty', async () => {
    const step = { id: 'empty-body', title: 'Configure something', body: '' };
    render(<SetupNotes steps={[step]} defaultExpanded />);

    expect(screen.getByText('Configure something')).toBeInTheDocument();
    expect(document.querySelector('p.text-muted-foreground')).not.toBeInTheDocument();
  });

  it('renders the external link once expanded', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(
      screen.getByRole('button', { name: /HF_TOKEN for speaker diarization/i }),
    );

    expect(screen.getByRole('link', { name: 'Get a Hugging Face token' })).toHaveAttribute(
      'href',
      'https://huggingface.co/settings/tokens',
    );
  });

  it('opens the external link in a new tab safely', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(
      screen.getByRole('button', { name: /HF_TOKEN for speaker diarization/i }),
    );
    const link = screen.getByRole('link', { name: 'Get a Hugging Face token' });

    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders both the deep link and the external link side by side', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(
      screen.getByRole('button', { name: /HF_TOKEN for speaker diarization/i }),
    );

    expect(screen.getByRole('link', { name: 'Go' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get a Hugging Face token' })).toBeInTheDocument();
  });

  it('renders no external link for a step without one', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

    expect(screen.queryByRole('link', { name: /hugging face/i })).not.toBeInTheDocument();
  });
});
