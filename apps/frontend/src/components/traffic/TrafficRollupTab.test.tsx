import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrafficRollupTab } from './TrafficRollupTab';
import type { TrafficIpRollupEntry } from '@/services/trafficApi';

const mockUseListTrafficIpRollupsQuery = vi.fn();
const mockDownloadTrafficExport = vi.fn();

vi.mock('@/services/trafficApi', () => ({
  useListTrafficIpRollupsQuery: (params: unknown) => mockUseListTrafficIpRollupsQuery(params),
  downloadTrafficExport: (...args: unknown[]) => mockDownloadTrafficExport(...args),
  // Consumed by the embedded AddToBlocklistDialog (#393)
  useListBlocklistsQuery: () => ({ data: [], isLoading: false }),
  useAppendBlocklistEntryMutation: () => [vi.fn(), { isLoading: false }],
}));

// Radix Select doesn't play well with happy-dom; sorting is asserted through
// the default query params instead.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

const makeRollup = (overrides: Partial<TrafficIpRollupEntry> = {}): TrafficIpRollupEntry => ({
  id: 'rollup-1',
  ip: '203.0.113.7',
  requestCount: 1234,
  firstSeenAt: '2026-06-01T00:00:00.000Z',
  lastSeenAt: '2026-07-02T09:05:03.000Z',
  samplePaths: ['/.env', '/wp-login.php'],
  sampleUserAgents: ['scanner-bot/1.0'],
  ...overrides,
});

const queryResult = (entries: TrafficIpRollupEntry[], total = entries.length) => ({
  data: { data: entries, total, page: 1, pageSize: 50, totalPages: Math.ceil(total / 50) },
  isLoading: false,
  isFetching: false,
  error: undefined,
});

describe('TrafficRollupTab', () => {
  beforeEach(() => {
    mockUseListTrafficIpRollupsQuery.mockReset();
    mockDownloadTrafficExport.mockReset().mockResolvedValue(undefined);
  });

  it('renders the worst offenders with count and samples', () => {
    mockUseListTrafficIpRollupsQuery.mockReturnValue(queryResult([makeRollup()]));
    render(<TrafficRollupTab />);

    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText(/\/\.env \/wp-login\.php/)).toBeInTheDocument();
    expect(screen.getByText('scanner-bot/1.0')).toBeInTheDocument();
  });

  it('defaults to sorting by request count, worst first', () => {
    mockUseListTrafficIpRollupsQuery.mockReturnValue(queryResult([]));
    render(<TrafficRollupTab />);

    expect(mockUseListTrafficIpRollupsQuery.mock.calls.at(-1)![0]).toMatchObject({
      sortBy: 'requestCount',
      sortOrder: 'desc',
      page: 1,
    });
  });

  it('shows an empty state when nothing matches', () => {
    mockUseListTrafficIpRollupsQuery.mockReturnValue(queryResult([]));
    render(<TrafficRollupTab />);
    expect(screen.getByText(/No IPs match these filters/)).toBeInTheDocument();
  });

  it('filters by IP substring', () => {
    mockUseListTrafficIpRollupsQuery.mockReturnValue(queryResult([]));
    render(<TrafficRollupTab />);

    fireEvent.change(screen.getByLabelText('IP contains'), { target: { value: '203.0' } });
    expect(mockUseListTrafficIpRollupsQuery.mock.calls.at(-1)![0]).toMatchObject({ ip: '203.0' });
  });

  it('exports the rollup with the active filter', () => {
    mockUseListTrafficIpRollupsQuery.mockReturnValue(queryResult([]));
    render(<TrafficRollupTab />);

    fireEvent.change(screen.getByLabelText('IP contains'), { target: { value: '203.0' } });
    fireEvent.click(screen.getByRole('button', { name: /json/i }));

    expect(mockDownloadTrafficExport).toHaveBeenCalledWith('ips', 'json', { ip: '203.0' });
  });
});
