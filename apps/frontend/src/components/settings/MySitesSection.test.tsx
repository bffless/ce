import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MySitesSection } from './MySitesSection';
import type { MyProjectMembership } from '@/services/meApi';

const mockUnwrap = vi.fn();
const mockMutate = vi.fn(() => ({ unwrap: mockUnwrap }));
let mockQueryResult: {
  data?: MyProjectMembership[];
  isLoading: boolean;
  error?: unknown;
} = { data: [], isLoading: false };

vi.mock('@/services/meApi', () => ({
  useListMyProjectsQuery: () => mockQueryResult,
  useLeaveProjectMutation: () => [mockMutate, { isLoading: false }],
}));

// Radix AlertDialog uses a context scope (`createContextScope`) that hits
// `useMemo` against a null React renderer in happy-dom. Stub the primitives so
// the dialog is just a controlled fragment for assertion purposes — the
// behavior we care about (open/close + button clicks) is preserved.
vi.mock('@/components/ui/alert-dialog', () => {
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const Passthrough = ({ children }: Props) => <>{children}</>;
  const Open = ({ open, children }: Props & { open?: boolean }) =>
    open ? <div role="dialog">{children}</div> : null;
  return {
    AlertDialog: Open,
    AlertDialogContent: Passthrough,
    AlertDialogHeader: Passthrough,
    AlertDialogFooter: Passthrough,
    AlertDialogTitle: ({ children }: Props) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: Props) => <p>{children}</p>,
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
    }: Props & { onClick?: () => void; disabled?: boolean }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children, disabled }: Props & { disabled?: boolean }) => (
      <button type="button" disabled={disabled}>
        {children}
      </button>
    ),
  };
});

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const guestMembership: MyProjectMembership = {
  projectId: 'p-1',
  projectName: 'Bella Real Estate',
  projectSlug: 'bffless/realestate-modern',
  primaryUrl: 'https://www.bellacharlesworth.com',
  role: 'guest',
  joinedAt: '2026-04-30T00:00:00.000Z',
  ownerEmail: 'james@example.com',
};

const ownerMembership: MyProjectMembership = {
  projectId: 'p-2',
  projectName: 'My Own Site',
  projectSlug: 'me/my-site',
  primaryUrl: 'https://my-site.example.com',
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
  ownerEmail: 'me@example.com',
};

describe('MySitesSection', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockUnwrap.mockReset();
    mockToast.mockClear();
    mockQueryResult = { data: [], isLoading: false };
  });

  it('shows empty state when user has no memberships', () => {
    mockQueryResult = { data: [], isLoading: false };
    render(<MySitesSection />);
    expect(screen.getByText(/not a member of any sites yet/i)).toBeInTheDocument();
  });

  it('renders membership cards with name, host, role, and owner email', () => {
    mockQueryResult = { data: [guestMembership], isLoading: false };
    render(<MySitesSection />);

    expect(screen.getByText('Bella Real Estate')).toBeInTheDocument();
    expect(screen.getByText('www.bellacharlesworth.com')).toBeInTheDocument();
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(screen.getByText(/Owner: james@example\.com/)).toBeInTheDocument();
    const visit = screen.getByRole('link', { name: /visit/i });
    expect(visit).toHaveAttribute('href', 'https://www.bellacharlesworth.com');
  });

  it('disables the Leave button for owners', () => {
    mockQueryResult = { data: [ownerMembership], isLoading: false };
    render(<MySitesSection />);
    const leaveBtn = screen.getByRole('button', { name: /leave/i });
    expect(leaveBtn).toBeDisabled();
  });

  it('opens the confirmation dialog and triggers the mutation on confirm', async () => {
    mockUnwrap.mockResolvedValue(undefined);
    mockQueryResult = { data: [guestMembership], isLoading: false };
    render(<MySitesSection />);

    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(await screen.findByText(/Leave Bella Real Estate\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /leave site/i }));

    expect(mockMutate).toHaveBeenCalledWith({ projectId: 'p-1' });
  });

  it('shows an error toast when leaving fails', async () => {
    mockUnwrap.mockRejectedValue({ data: { message: 'You cannot leave a site you own.' } });
    mockQueryResult = { data: [guestMembership], isLoading: false };
    render(<MySitesSection />);

    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    fireEvent.click(await screen.findByRole('button', { name: /leave site/i }));

    // Wait for the rejected promise to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: 'You cannot leave a site you own.',
      }),
    );
  });
});
