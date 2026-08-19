import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrafficBlocklistTab } from './TrafficBlocklistTab';
import type { BlocklistEntry } from '@/services/trafficApi';

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockGetBaseline = vi.fn();
const mockListBlocklists = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/services/trafficApi', () => ({
  useGetBlocklistSettingsQuery: () => mockGetSettings(),
  useUpdateBlocklistSettingsMutation: () => [mockUpdateSettings, { isLoading: false }],
  useGetBaselineBlocklistQuery: (_arg: unknown, opts: { skip?: boolean }) => mockGetBaseline(opts),
  useListBlocklistsQuery: () => mockListBlocklists(),
  useCreateBlocklistMutation: () => [mockCreate, { isLoading: false }],
  useUpdateBlocklistMutation: () => [mockUpdate, { isLoading: false }],
  useDeleteBlocklistMutation: () => [mockDelete, { isLoading: false }],
}));

// Radix AlertDialog doesn't play well with happy-dom; render a plain stand-in.
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
}));

const makeList = (overrides: Partial<BlocklistEntry> = {}): BlocklistEntry => ({
  id: 'b1',
  name: 'aggressive-scanners',
  description: 'Custom probes seen in the wild',
  isDefault: true,
  attachedDomains: [],
  entries: [
    { matchType: 'prefix', value: '/hidden-probe' },
    { matchType: 'extension', value: 'php' },
  ],
  allowlist: [{ matchType: 'exact', value: '/status' }],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...overrides,
});

describe('TrafficBlocklistTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({
      data: { enabled: true, baselineEntryCount: 200 },
      isLoading: false,
    });
    mockGetBaseline.mockReturnValue({ data: undefined });
    mockListBlocklists.mockReturnValue({ data: [], isLoading: false, error: undefined });
    mockUpdateSettings.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    mockCreate.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    mockDelete.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it('shows the master toggle state and Baseline size', () => {
    render(<TrafficBlocklistTab />);
    expect(screen.getByLabelText('On')).toBeInTheDocument();
    expect(screen.getByText(/200 scanner signatures/)).toBeInTheDocument();
  });

  it('flips the master toggle through the settings mutation', async () => {
    render(<TrafficBlocklistTab />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ enabled: false }));
  });

  it('lists Blocklists with pattern and exception counts', () => {
    mockListBlocklists.mockReturnValue({ data: [makeList()], isLoading: false, error: undefined });
    render(<TrafficBlocklistTab />);

    expect(screen.getByText('aggressive-scanners')).toBeInTheDocument();
    expect(screen.getByText('2 patterns')).toBeInTheDocument();
    expect(screen.getByText('1 exception')).toBeInTheDocument();
  });

  it('creates a Blocklist from the textarea, parsing one pattern per line', async () => {
    render(<TrafficBlocklistTab />);

    fireEvent.click(screen.getByRole('button', { name: /New Blocklist/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my-list' } });
    fireEvent.change(screen.getByLabelText(/Blocked patterns/), {
      target: { value: '/hidden-probe\nextension:php\n# comment\n' },
    });
    fireEvent.change(screen.getByLabelText(/Allowlist exceptions/), {
      target: { value: 'exact:/status' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'my-list',
        description: undefined,
        isDefault: true,
        entries: [
          { matchType: 'prefix', value: '/hidden-probe' },
          { matchType: 'extension', value: 'php' },
        ],
        allowlist: [{ matchType: 'exact', value: '/status' }],
      }),
    );
  });

  it('surfaces the backend per-pattern validation errors', async () => {
    mockCreate.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          data: { message: 'Invalid blocklist patterns', errors: ['entries: "/x;{}" — bad'] },
        }),
    });
    render(<TrafficBlocklistTab />);

    fireEvent.click(screen.getByRole('button', { name: /New Blocklist/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(/\/x;\{\}/)).toBeInTheDocument();
  });

  it('pre-fills the editor with the existing patterns when editing', () => {
    mockListBlocklists.mockReturnValue({ data: [makeList()], isLoading: false, error: undefined });
    render(<TrafficBlocklistTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit aggressive-scanners' }));

    expect(screen.getByLabelText(/Blocked patterns/)).toHaveValue('/hidden-probe\nextension:php');
    expect(screen.getByLabelText(/Allowlist exceptions/)).toHaveValue('exact:/status');
  });

  it('deletes after confirmation', async () => {
    mockListBlocklists.mockReturnValue({ data: [makeList()], isLoading: false, error: undefined });
    render(<TrafficBlocklistTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete aggressive-scanners' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('b1'));
  });
});
