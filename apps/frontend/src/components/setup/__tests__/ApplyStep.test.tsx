import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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
// stub `href` as an accessor (rather than a plain writable property) so a
// redirect assignment in the component never triggers jsdom's "Not
// implemented: navigation" noise, AND so tests can count how many times the
// component actually assigns `href` (needed for the overlap-guard regression
// test below, where reading the final value alone can't distinguish one
// assignment from two identical ones).
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
let hrefAssignments: string[];

function stubLocation() {
  hrefAssignments = [];
  let currentHref = 'https://old-origin.example/setup';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      get href() {
        return currentHref;
      },
      set href(value: string) {
        hrefAssignments.push(value);
        currentHref = value;
      },
    },
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

    // The redirect-once guard doesn't break the happy path: exactly one
    // assignment, not zero and not more than one.
    expect(hrefAssignments).toEqual(['https://admin.example.com']);
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

  it('renders a clickable admin URL link in the switching state as a manual escape hatch', async () => {
    renderStep('example.com');

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('href', 'https://admin.example.com');
  });

  it('shows a manual-continue hint after about 30 seconds of failing polls, not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockRejectedValue(new Error('still restarting'));
    vi.stubGlobal('fetch', fetchMock);

    renderStep('example.com');
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    // Just under 30s of failing polls: no hint yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(27000);
    });
    expect(screen.queryByText(/taking longer than expected/i)).not.toBeInTheDocument();

    // At 30s: the hint appears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument();
  });

  it('guards against overlapping poll resolutions producing more than one redirect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveFirst!: (value: { ok: boolean }) => void;
    let resolveSecond!: (value: { ok: boolean }) => void;
    const firstPoll = new Promise<{ ok: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPoll = new Promise<{ ok: boolean }>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi.fn();
    fetchMock.mockReturnValueOnce(firstPoll);
    fetchMock.mockReturnValueOnce(secondPoll);
    vi.stubGlobal('fetch', fetchMock);

    renderStep('example.com');
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    // Two ticks fire while the first poll is still in flight — simulates a
    // slow in-flight poll overlapping with a later tick, the scenario the
    // unguarded async interval callback didn't handle.
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hrefAssignments).toEqual([]);

    // Both polls now resolve ok "simultaneously". Without the guard both
    // would assign window.location.href.
    resolveFirst({ ok: true });
    resolveSecond({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(hrefAssignments).toEqual(['https://admin.example.com']);
  });

  it('defaults to cloudflare and shows the Full (strict) reminder afterward', async () => {
    renderStep('example.com');

    expect(screen.getByRole('radio', { name: /^cloudflare/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^direct/i })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({ domain: 'example.com', proxyMode: 'cloudflare' })
    );
    expect(await screen.findByText(/full \(strict\)/i)).toBeInTheDocument();
  });

  it('lets the user choose "none" and sends it to apply, without the Cloudflare-specific reminder', async () => {
    renderStep('example.com');

    fireEvent.click(screen.getByRole('radio', { name: /^direct/i }));
    expect(screen.getByRole('radio', { name: /^direct/i })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({ domain: 'example.com', proxyMode: 'none' })
    );
    expect(await screen.findByText(/switching to/i)).toBeInTheDocument();
    expect(screen.queryByText(/full \(strict\)/i)).not.toBeInTheDocument();
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
