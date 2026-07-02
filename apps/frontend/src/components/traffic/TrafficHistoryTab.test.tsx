import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrafficHistoryTab } from './TrafficHistoryTab';
import type { TrafficRequestEntry } from '@/services/trafficApi';

const mockUseListTrafficRequestsQuery = vi.fn();
const mockDownloadTrafficExport = vi.fn();

vi.mock('@/services/trafficApi', () => ({
  useListTrafficRequestsQuery: (params: unknown) => mockUseListTrafficRequestsQuery(params),
  downloadTrafficExport: (...args: unknown[]) => mockDownloadTrafficExport(...args),
}));

// Radix Select doesn't play well with happy-dom; the time-range filter is
// exercised indirectly through the query params assertion instead.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

const makeEntry = (overrides: Partial<TrafficRequestEntry> = {}): TrafficRequestEntry => ({
  id: 'entry-1',
  timestamp: '2026-07-02T09:05:03.000Z',
  ip: '203.0.113.7',
  method: 'GET',
  path: '/backend/.env',
  httpVersion: '1.1',
  status: 404,
  bytes: 42,
  referer: null,
  userAgent: 'scanner',
  host: 'j5s.dev',
  classification: 'unmatched',
  line: '203.0.113.7 - - [02/Jul/2026:09:05:03 +0000] "GET /backend/.env HTTP/1.1" 404 42 "-" "scanner"',
  ...overrides,
});

const queryResult = (entries: TrafficRequestEntry[], total = entries.length) => ({
  data: { data: entries, total, page: 1, pageSize: 100, totalPages: Math.ceil(total / 100) },
  isLoading: false,
  isFetching: false,
  error: undefined,
});

describe('TrafficHistoryTab', () => {
  beforeEach(() => {
    mockUseListTrafficRequestsQuery.mockReset();
    mockDownloadTrafficExport.mockReset().mockResolvedValue(undefined);
  });

  it('renders persisted requests as access-log lines with pagination summary', () => {
    mockUseListTrafficRequestsQuery.mockReturnValue(queryResult([makeEntry()]));
    render(<TrafficHistoryTab />);

    expect(screen.getByText(/GET \/backend\/\.env HTTP\/1\.1/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 to 1 of 1/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', () => {
    mockUseListTrafficRequestsQuery.mockReturnValue(queryResult([]));
    render(<TrafficHistoryTab />);
    expect(screen.getByText(/No persisted requests match these filters/)).toBeInTheDocument();
  });

  it('passes filters to the query and resets to page 1 on change', () => {
    mockUseListTrafficRequestsQuery.mockReturnValue(queryResult([]));
    render(<TrafficHistoryTab />);

    fireEvent.change(screen.getByLabelText('IP'), { target: { value: '203.0.113.7' } });
    fireEvent.change(screen.getByLabelText('Path contains'), { target: { value: '/.env' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '404' } });

    const lastCall = mockUseListTrafficRequestsQuery.mock.calls.at(-1)![0];
    expect(lastCall).toMatchObject({
      ip: '203.0.113.7',
      path: '/.env',
      status: 404,
      page: 1,
      pageSize: 100,
    });
  });

  it('exports with the active filters', () => {
    mockUseListTrafficRequestsQuery.mockReturnValue(queryResult([]));
    render(<TrafficHistoryTab />);

    fireEvent.change(screen.getByLabelText('IP'), { target: { value: '203.0.113.7' } });
    fireEvent.click(screen.getByRole('button', { name: /csv/i }));

    expect(mockDownloadTrafficExport).toHaveBeenCalledWith(
      'requests',
      'csv',
      expect.objectContaining({ ip: '203.0.113.7' }),
    );
  });

  it('disables Previous on the first page and Next on the last', () => {
    mockUseListTrafficRequestsQuery.mockReturnValue(queryResult([makeEntry()], 1));
    render(<TrafficHistoryTab />);

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
