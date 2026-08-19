import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ApplyPanel } from '../ApplyPanel';
import type { PrimarySslApplyBody } from '@/services/primarySslApi';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apply = vi.fn();
vi.mock('@/services/primarySslApi', () => ({
  useApplyPrimarySslMutation: () => [apply, { isLoading: false }],
}));

const config: PrimarySslApplyBody = {
  proxyMode: 'none',
  sslMode: 'letsencrypt',
};

describe('ApplyPanel', () => {
  beforeEach(() => {
    mockToast.mockClear();
    apply.mockClear();
  });

  it('calls applyPrimarySsl with the passed config when clicking Apply changes', async () => {
    apply.mockReturnValue({ unwrap: () => Promise.resolve({ applied: true, kind: 'cert-only' }) });
    render(<ApplyPanel config={config} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith(config));
  });

  it('shows the countdown-started notice for a serving result', async () => {
    apply.mockReturnValue({
      unwrap: () =>
        Promise.resolve({ applied: true, kind: 'serving', deadlineMs: Date.now() + 60000 }),
    });
    render(<ApplyPanel config={config} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Applied — confirmation required' }),
      ),
    );
  });

  it('shows the countdown-started notice with cert copy for a cert-only result carrying a deadline', async () => {
    apply.mockReturnValue({
      unwrap: () =>
        Promise.resolve({ applied: true, kind: 'cert-only', deadlineMs: Date.now() + 60000 }),
    });
    render(<ApplyPanel config={config} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Applied — confirmation required',
          description: expect.stringContaining('new certificate'),
        }),
      ),
    );
  });

  it('shows the success toast for a cert-only result', async () => {
    apply.mockReturnValue({ unwrap: () => Promise.resolve({ applied: true, kind: 'cert-only' }) });
    render(<ApplyPanel config={config} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Applied',
          description: 'Certificate updated successfully.',
        }),
      ),
    );
  });

  it('shows an error toast when the mutation rejects', async () => {
    apply.mockReturnValue({ unwrap: () => Promise.reject({ data: { message: 'boom' } }) });
    render(<ApplyPanel config={config} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', description: 'boom', variant: 'destructive' }),
      ),
    );
  });

  it('respects disabled', () => {
    apply.mockReturnValue({ unwrap: () => Promise.resolve({ applied: true, kind: 'cert-only' }) });
    render(<ApplyPanel config={config} disabled={true} />);

    expect(screen.getByRole('button', { name: /apply changes/i })).toBeDisabled();
  });
});
