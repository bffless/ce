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
});
