import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddToBlocklistDialog } from './AddToBlocklistDialog';
import type { BlocklistEntry } from '@/services/trafficApi';

const mockListBlocklists = vi.fn();
const mockAppendEntry = vi.fn();

vi.mock('@/services/trafficApi', () => ({
  useListBlocklistsQuery: (_arg: unknown, opts: { skip?: boolean }) => mockListBlocklists(opts),
  useAppendBlocklistEntryMutation: () => [mockAppendEntry, { isLoading: false }],
}));

// Radix Select doesn't play well with happy-dom; the selection logic is
// asserted through the mutation payload (default target) instead.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

const makeList = (overrides: Partial<BlocklistEntry> = {}): BlocklistEntry => ({
  id: 'b1',
  name: 'default-list',
  description: null,
  isDefault: true,
  attachedDomains: [],
  entries: [],
  allowlist: [],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...overrides,
});

describe('AddToBlocklistDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBlocklists.mockReturnValue({ data: [makeList()], isLoading: false });
    mockAppendEntry.mockReturnValue({
      unwrap: () => Promise.resolve(makeList({ name: 'default-list' })),
    });
  });

  it('renders nothing until a target is set', () => {
    render(<AddToBlocklistDialog target={null} onOpenChange={() => {}} />);
    expect(screen.queryByText('Add to Blocklist')).not.toBeInTheDocument();
  });

  it('prefills the pattern with the offending path and appends as a prefix by default', async () => {
    const onOpenChange = vi.fn();
    render(
      <AddToBlocklistDialog
        target={{ path: '/backend/.env', host: 'example.com' }}
        onOpenChange={onOpenChange}
      />,
    );

    expect(screen.getByLabelText('Pattern')).toHaveValue('/backend/.env');
    fireEvent.click(screen.getByRole('button', { name: 'Block it' }));

    await waitFor(() =>
      expect(mockAppendEntry).toHaveBeenCalledWith({
        id: 'b1',
        matchType: 'prefix',
        value: '/backend/.env',
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('defaults the target to a Blocklist attached to the request host (www-insensitive)', async () => {
    mockListBlocklists.mockReturnValue({
      data: [
        makeList(),
        makeList({
          id: 'b2',
          name: 'scoped',
          isDefault: false,
          attachedDomains: [{ id: 'dom-1', domain: 'shop.example.com' }],
        }),
      ],
      isLoading: false,
    });
    render(
      <AddToBlocklistDialog
        target={{ path: '/probe', host: 'www.shop.example.com' }}
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Block it' }));
    await waitFor(() =>
      expect(mockAppendEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'b2' })),
    );
  });

  it('surfaces the backend validation error and stays open', async () => {
    mockAppendEntry.mockReturnValue({
      unwrap: () =>
        Promise.reject({ data: { errors: ['entries: "/x;{}" — unsupported characters'] } }),
    });
    const onOpenChange = vi.fn();
    render(
      <AddToBlocklistDialog target={{ path: '/x', host: null }} onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Block it' }));

    expect(await screen.findByText(/unsupported characters/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('points at the Blocklist tab when no lists exist yet', () => {
    mockListBlocklists.mockReturnValue({ data: [], isLoading: false });
    render(
      <AddToBlocklistDialog target={{ path: '/probe', host: null }} onOpenChange={() => {}} />,
    );
    expect(screen.getByText(/No Blocklists exist yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block it' })).toBeDisabled();
  });
});
