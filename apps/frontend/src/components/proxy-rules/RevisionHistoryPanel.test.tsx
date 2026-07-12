import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RevisionHistoryPanel } from './RevisionHistoryPanel';
import type { RuleSetRevisionListItem } from '@/services/proxyRulesApi';

const mockGetRevisions = vi.fn();
const mockRollback = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/services/proxyRulesApi', () => ({
  useGetRuleSetRevisionsQuery: () => mockGetRevisions(),
  useRollbackRuleSetMutation: () => [mockRollback, { isLoading: false }],
}));

// Newest first, per the server contract — the component must not re-sort.
const revisions: RuleSetRevisionListItem[] = [
  {
    id: 'rev-2',
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    trigger: 'sync',
    contentHash: 'sha256:aaa',
    ruleCount: 4,
    current: true,
  },
  {
    id: 'rev-1',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    trigger: 'import',
    contentHash: 'sha256:bbb',
    ruleCount: 3,
    current: false,
    source: {
      repo: 'bffless/apps',
      gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      syncedAt: new Date().toISOString(),
      contentHash: 'sha256:bbb',
    },
  },
];

function openPanel() {
  render(<RevisionHistoryPanel ruleSetId="rs-1" />);
  fireEvent.click(screen.getByRole('button', { name: /History/ }));
}

describe('RevisionHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRevisions.mockReturnValue({ data: { revisions }, isLoading: false });
    mockRollback.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          ruleSetId: 'rs-1',
          created: [{ pathPattern: '/api/x', method: null }],
          updated: [{ pathPattern: '/api/z', method: 'GET' }, { pathPattern: '/api/w', method: null }],
          deleted: [{ pathPattern: '/api/y', method: 'GET' }],
          unchanged: [],
          pruneCandidates: [],
          schemaResolutions: [],
          missingSecrets: [],
          warnings: [],
          dryRun: false,
          setCreated: false,
        }),
    });
  });

  it('renders revisions newest-first, with no Restore button on the current row', () => {
    openPanel();

    const rows = screen.getAllByTestId('revision-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('sync');
    expect(rows[1]).toHaveTextContent('import');

    // current row has no Restore button
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1);
    expect(screen.getByText('Current')).toBeInTheDocument();

    // repo@shortSha shown for the row with source
    expect(screen.getByText('bffless/apps@a1b2c3d')).toBeInTheDocument();

    // rule counts
    expect(screen.getByText('4 rules')).toBeInTheDocument();
    expect(screen.getByText('3 rules')).toBeInTheDocument();
  });

  it('does not render revisions until expanded', () => {
    render(<RevisionHistoryPanel ruleSetId="rs-1" />);
    expect(screen.queryByTestId('revision-row')).not.toBeInTheDocument();
  });

  it('confirm dialog fires the rollback mutation with { id, revisionId }, then toasts the counts', async () => {
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      screen.getByText(/Rules added since will be deleted/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));

    await waitFor(() =>
      expect(mockRollback).toHaveBeenCalledWith({ id: 'rs-1', revisionId: 'rev-1' }),
    );

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('1 created'),
        }),
      ),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('2 updated'),
      }),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('1 deleted'),
      }),
    );
  });

  it('shows an error toast when the rollback mutation fails', async () => {
    mockRollback.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: 'Sync failed: bad snapshot' } }),
    });
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Sync failed: bad snapshot',
          variant: 'destructive',
        }),
      ),
    );
  });
});
