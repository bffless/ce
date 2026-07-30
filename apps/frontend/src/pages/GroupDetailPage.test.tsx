import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GroupDetailPage } from './GroupDetailPage';
import type { UserGroupMember } from '@/services/userGroupsApi';
import { useAddMemberMutation } from '@/services/userGroupsApi';
import { useSearchDirectoryQuery } from '@/services/usersApi';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ groupId: 'group-1' }), useNavigate: () => vi.fn() };
});

vi.mock('@/services/authApi', () => ({
  useGetSessionQuery: () => ({
    data: { user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' } },
    isLoading: false,
  }),
}));

const member: UserGroupMember = {
  id: 'membership-1',
  groupId: 'group-1',
  userId: 'user-2',
  addedBy: 'admin-1',
  addedAt: '2026-07-30T11:05:57.000Z',
  user: { id: 'user-2', email: 'member@example.com', name: null },
};

vi.mock('@/services/userGroupsApi', () => ({
  useGetGroupQuery: () => ({
    data: { id: 'group-1', name: 'cutover-smoke', description: 'e2e', createdBy: 'admin-1' },
    isLoading: false,
    error: undefined,
  }),
  useGetGroupMembersQuery: () => ({
    data: [member],
    isLoading: false,
    error: undefined,
  }),
  useUpdateGroupMutation: () => [vi.fn(), { isLoading: false }],
  useAddMemberMutation: vi.fn(),
  useRemoveMemberMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/services/usersApi', () => ({
  useSearchDirectoryQuery: vi.fn(),
}));

// Radix Popover doesn't play well with happy-dom; render trigger + content flat.
// (Same workaround used by ResponseHandlerConfig.test.tsx / DomainBlocklistsSection.test.tsx.)
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  vi.mocked(useAddMemberMutation).mockReturnValue([
    vi.fn().mockReturnValue({ unwrap: () => Promise.resolve() }),
    { isLoading: false },
  ] as any);
  vi.mocked(useSearchDirectoryQuery).mockReturnValue({ data: undefined, isFetching: false } as any);
});

describe('GroupDetailPage', () => {
  // Regression for #569: the per-member remove button used Dialog's `DialogTrigger`
  // inside an `AlertDialog`, so rendering ANY member row threw
  // "`DialogTrigger` must be used within `Dialog`" and crashed the page.
  it('renders a group with members without throwing', () => {
    render(
      <MemoryRouter>
        <GroupDetailPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('member@example.com')).toBeInTheDocument();
  });
});

describe('GroupDetailPage Add Member dialog', () => {
  async function openDialog() {
    render(
      <MemoryRouter>
        <GroupDetailPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    return screen.getByRole('dialog');
  }

  it('shows directory results for a typed search term (#572)', async () => {
    vi.mocked(useSearchDirectoryQuery).mockReturnValue({
      data: { users: [{ id: 'user-10', email: 'jane@example.com' }] },
      isFetching: false,
    } as any);

    const dialog = await openDialog();
    const searchInput = within(dialog).getByPlaceholderText(/search by email/i);
    await userEvent.type(searchInput, 'jane');

    await waitFor(() => {
      expect(within(dialog).getByText('jane@example.com')).toBeInTheDocument();
    });
  });

  it('shows a no-matches state for a term with no results', async () => {
    vi.mocked(useSearchDirectoryQuery).mockReturnValue({
      data: { users: [] },
      isFetching: false,
    } as any);

    const dialog = await openDialog();
    const searchInput = within(dialog).getByPlaceholderText(/search by email/i);
    await userEvent.type(searchInput, 'nobody');

    await waitFor(() => {
      expect(within(dialog).getByText(/no users found/i)).toBeInTheDocument();
    });
  });

  it('disables Add Member until a directory result is selected', async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByRole('button', { name: /add member/i })).toBeDisabled();
  });

  it('selecting a result and submitting posts the selected user id, not the email (#572)', async () => {
    const mockAddMember = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve() });
    vi.mocked(useAddMemberMutation).mockReturnValue([mockAddMember, { isLoading: false }] as any);
    vi.mocked(useSearchDirectoryQuery).mockReturnValue({
      data: { users: [{ id: 'user-10', email: 'jane@example.com' }] },
      isFetching: false,
    } as any);

    const dialog = await openDialog();
    const searchInput = within(dialog).getByPlaceholderText(/search by email/i);
    await userEvent.type(searchInput, 'jane');

    await waitFor(() => {
      expect(within(dialog).getByText('jane@example.com')).toBeInTheDocument();
    });
    await userEvent.click(within(dialog).getByText('jane@example.com'));

    const submitButton = within(dialog).getByRole('button', { name: /add member/i });
    expect(submitButton).toBeEnabled();
    await userEvent.click(submitButton);

    expect(mockAddMember).toHaveBeenCalledWith({
      groupId: 'group-1',
      dto: { userId: 'user-10' },
    });
  });
});
