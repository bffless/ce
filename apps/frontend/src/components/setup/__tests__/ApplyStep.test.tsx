import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ApplyStep } from '../ApplyStep';
import { api } from '@/services/api';
import setupReducer, { setBootstrapDomain } from '@/store/slices/setupSlice';

const applyMock = vi.fn();
const useApplyBootstrapMutationMock = vi.fn();

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/setupApi')>();
  return {
    ...mod,
    useApplyBootstrapMutation: () => useApplyBootstrapMutationMock(),
  };
});

function createTestStore(bootstrapDomain: string | null = 'example.com') {
  const store = configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      setup: setupReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
  if (bootstrapDomain !== null) {
    store.dispatch(setBootstrapDomain(bootstrapDomain));
  }
  return store;
}

function renderStep(bootstrapDomain: string | null = 'example.com') {
  const store = createTestStore(bootstrapDomain);
  render(
    <Provider store={store}>
      <ApplyStep />
    </Provider>
  );
  return store;
}

// window.location is shared, mutable global state (see DomainSslStep.test.tsx).
// Save the real descriptor once and restore it after every test. We also
// stub `href` as a plain writable property so a redirect assignment in the
// component never triggers jsdom's "Not implemented: navigation" noise.
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;

function stubLocation() {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, href: 'https://old-origin.example/setup' },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', originalLocationDescriptor);
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

beforeEach(() => {
  stubLocation();
  applyMock.mockReset();
  applyMock.mockReturnValue({
    unwrap: () => Promise.resolve({ applying: true, adminUrl: 'https://admin.example.com' }),
  });
  useApplyBootstrapMutationMock.mockReset();
  useApplyBootstrapMutationMock.mockReturnValue([applyMock, { isLoading: false }]);
  vi.stubGlobal('fetch', vi.fn());
});

describe('ApplyStep', () => {
  it('applies with the stored domain and shows the switching state with the Full (strict) reminder', async () => {
    renderStep('example.com');

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({ domain: 'example.com', proxyMode: 'cloudflare' })
    );

    expect(await screen.findByText(/switching to/i)).toBeInTheDocument();
    expect(screen.getByText(/full \(strict\)/i)).toBeInTheDocument();
  });

  it('surfaces the backend error message and does not enter the switching state', async () => {
    const message = 'Certificates for example.com were not found. Upload them first.';
    applyMock.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message } }),
    });
    renderStep('example.com');

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.queryByText(/switching to/i)).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the backend error has none', async () => {
    applyMock.mockReturnValue({ unwrap: () => Promise.reject({}) });
    renderStep('example.com');

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(/apply failed/i)).toBeInTheDocument());
    expect(screen.queryByText(/switching to/i)).not.toBeInTheDocument();
  });

  it('polls the new origin, keeps polling through failures, and redirects only once a poll succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn();
    // First poll: rejects (network/DNS not ready). Second poll: resolves ok.
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    fetchMock.mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    renderStep('example.com');
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    // First poll tick: fetch rejects, no redirect yet.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://admin.example.com/api/setup/status',
      { mode: 'cors' }
    );
    expect(window.location.href).toBe('https://old-origin.example/setup');

    // Second poll tick: fetch resolves ok, redirect happens.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe('https://admin.example.com');

    // No further polling after a successful redirect.
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the polling interval on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockRejectedValue(new Error('still restarting'));
    vi.stubGlobal('fetch', fetchMock);

    const store = createTestStore('example.com');
    const { unmount } = render(
      <Provider store={store}>
        <ApplyStep />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();

    await vi.advanceTimersByTimeAsync(9000);
    // No additional calls after unmount — the interval must be cleared, not
    // left polling a dead component forever.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disables the button when there is no bootstrapDomain', () => {
    renderStep(null);
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
  });

  it('disables the button while the mutation is loading', () => {
    useApplyBootstrapMutationMock.mockReturnValue([applyMock, { isLoading: true }]);
    renderStep('example.com');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
