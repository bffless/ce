import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { RollbackPanel } from '../RollbackPanel';

const confirm = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
const rollback = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
vi.mock('@/services/primarySslApi', () => ({
  useApplyPrimarySslMutation: () => [vi.fn(), { isLoading: false }],
  useConfirmPrimarySslMutation: () => [confirm, { isLoading: false }],
  useRollbackPrimarySslMutation: () => [rollback, { isLoading: false }],
}));

describe('RollbackPanel', () => {
  it('shows Keep-these-changes when a revert is pending and confirms', () => {
    render(<RollbackPanel pendingRevert={{ deadlineMs: Date.now() + 60000 }} />);
    const keep = screen.getByRole('button', { name: /keep these changes/i });
    fireEvent.click(keep);
    expect(confirm).toHaveBeenCalled();
  });
  it('always offers restore-previous', () => {
    render(<RollbackPanel pendingRevert={null} />);
    fireEvent.click(screen.getByRole('button', { name: /restore previous/i }));
    expect(rollback).toHaveBeenCalled();
  });
});
