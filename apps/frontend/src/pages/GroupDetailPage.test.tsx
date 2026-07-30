import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupDetailPage } from './GroupDetailPage';
import type { UserGroupMember } from '@/services/userGroupsApi';

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
  useAddMemberMutation: () => [vi.fn(), { isLoading: false }],
  useRemoveMemberMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
