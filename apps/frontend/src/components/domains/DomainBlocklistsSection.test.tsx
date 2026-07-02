import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DomainBlocklistsSection } from './DomainBlocklistsSection';
import type { BlocklistEntry } from '@/services/trafficApi';

const mockListBlocklists = vi.fn();
const mockGetDomainBlocklists = vi.fn();
const mockSync = vi.fn();

vi.mock('@/services/trafficApi', () => ({
  useListBlocklistsQuery: () => mockListBlocklists(),
  useGetDomainBlocklistsQuery: (domainId: string) => mockGetDomainBlocklists(domainId),
  useSyncDomainBlocklistsMutation: () => [mockSync, { isLoading: false }],
}));

// Radix Popover doesn't play well with happy-dom; render trigger + content flat.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

const makeList = (overrides: Partial<BlocklistEntry> = {}): BlocklistEntry => ({
  id: 'b1',
  name: 'aggressive-scanners',
  description: null,
  isDefault: false,
  attachedDomains: [],
  entries: [{ matchType: 'prefix', value: '/probe' }],
  allowlist: [],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...overrides,
});

describe('DomainBlocklistsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBlocklists.mockReturnValue({ data: [makeList()], isLoading: false });
    mockGetDomainBlocklists.mockReturnValue({
      data: { domainMappingId: 'dom-1', blocklistIds: [] },
      isLoading: false,
    });
    mockSync.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it('attaches a Blocklist through the replace-all mutation', async () => {
    render(<DomainBlocklistsSection domainId="dom-1" domain="shop.example.com" />);

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({
        domainMappingId: 'dom-1',
        blocklistIds: ['b1'],
      }),
    );
  });

  it('detaches from the attached badge', async () => {
    mockGetDomainBlocklists.mockReturnValue({
      data: { domainMappingId: 'dom-1', blocklistIds: ['b1'] },
      isLoading: false,
    });
    render(<DomainBlocklistsSection domainId="dom-1" domain="shop.example.com" />);

    expect(screen.getByText('1 Blocklist attached')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Detach aggressive-scanners' }));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({
        domainMappingId: 'dom-1',
        blocklistIds: [],
      }),
    );
  });

  it('marks all-domain lists as already applying', () => {
    mockListBlocklists.mockReturnValue({
      data: [makeList({ isDefault: true })],
      isLoading: false,
    });
    render(<DomainBlocklistsSection domainId="dom-1" domain="shop.example.com" />);
    expect(screen.getByText('(already on all domains)')).toBeInTheDocument();
  });

  it('points at the Blocklist tab when the library is empty', () => {
    mockListBlocklists.mockReturnValue({ data: [], isLoading: false });
    render(<DomainBlocklistsSection domainId="dom-1" domain="shop.example.com" />);
    expect(screen.getByText(/No Blocklists exist yet/)).toBeInTheDocument();
  });
});
