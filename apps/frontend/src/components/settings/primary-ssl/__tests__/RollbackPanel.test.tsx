import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { RollbackPanel } from '../RollbackPanel';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const confirm = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
const rollback = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
vi.mock('@/services/primarySslApi', () => ({
  useApplyPrimarySslMutation: () => [vi.fn(), { isLoading: false }],
  useConfirmPrimarySslMutation: () => [confirm, { isLoading: false }],
  useRollbackPrimarySslMutation: () => [rollback, { isLoading: false }],
}));

describe('RollbackPanel', () => {
  beforeEach(() => {
    mockToast.mockClear();
    confirm.mockClear();
    rollback.mockClear();
  });

  it('shows Keep-these-changes when a revert is pending and confirms', async () => {
    render(<RollbackPanel pendingRevert={{ deadlineMs: Date.now() + 60000 }} />);
    const keep = screen.getByRole('button', { name: /keep these changes/i });
    fireEvent.click(keep);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Changes kept' }),
      ),
    );
  });

  it('always offers restore-previous', async () => {
    render(<RollbackPanel pendingRevert={null} />);
    fireEvent.click(screen.getByRole('button', { name: /restore previous/i }));
    await waitFor(() => expect(rollback).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Restored' }),
      ),
    );
  });

  it('shows an error toast when confirm fails', async () => {
    confirm.mockReturnValueOnce({
      unwrap: () => Promise.reject({ data: { message: 'boom' } }),
    });
    render(<RollbackPanel pendingRevert={{ deadlineMs: Date.now() + 60000 }} />);
    fireEvent.click(screen.getByRole('button', { name: /keep these changes/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', description: 'boom', variant: 'destructive' }),
      ),
    );
  });

  it('shows an error toast when rollback fails', async () => {
    rollback.mockReturnValueOnce({
      unwrap: () => Promise.reject({ data: { message: 'nope' } }),
    });
    render(<RollbackPanel pendingRevert={null} />);
    fireEvent.click(screen.getByRole('button', { name: /restore previous/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', description: 'nope', variant: 'destructive' }),
      ),
    );
  });
});
