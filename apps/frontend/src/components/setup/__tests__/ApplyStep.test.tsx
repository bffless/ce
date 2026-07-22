import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ApplyStep } from '../ApplyStep';
import { api } from '@/services/api';
import setupReducer, {
  setBootstrapDomain,
  setClaimToken,
  setServingMode,
  setBootstrapSslMode,
  setBootstrapPort80,
  setBootstrapRealIp,
  setDnsPreflightPassed,
  setWildcardIssued,
  ServingMode,
  BootstrapSslMode,
} from '@/store/slices/setupSlice';

const applyMock = vi.fn();
const useApplyBootstrapMutationMock = vi.fn();

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/setupApi')>();
  return {
    ...mod,
    useApplyBootstrapMutation: () => useApplyBootstrapMutationMock(),
  };
});

interface StoreOverrides {
  bootstrapDomain?: string | null;
  servingMode?: ServingMode;
  bootstrapSslMode?: BootstrapSslMode;
  bootstrapPort80?: 'closed' | 'redirect';
  bootstrapRealIp?: { header: string; ranges: string[] };
  dnsPreflightPassed?: boolean;
  wildcardIssued?: boolean;
}

function createTestStore(overrides: StoreOverrides = {}) {
  const store = configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      setup: setupReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
  const bootstrapDomain = overrides.bootstrapDomain ?? 'example.com';
  if (bootstrapDomain !== null) {
    store.dispatch(setBootstrapDomain(bootstrapDomain));
  }
  // Seed the claim token the way the claim step would: apply is token-gated
  // (session-less wizard), so ApplyStep forwards it alongside domain/proxyMode.
  store.dispatch(setClaimToken('claim-xyz'));

  // setServingMode resets sslMode/port80/realIp/dnsPreflightPassed/wildcardIssued,
  // so it must be dispatched BEFORE any of those overrides.
  if (overrides.servingMode) {
    store.dispatch(setServingMode(overrides.servingMode));
  }
  if (overrides.bootstrapSslMode) {
    store.dispatch(setBootstrapSslMode(overrides.bootstrapSslMode));
  }
  if (overrides.bootstrapPort80) {
    store.dispatch(setBootstrapPort80(overrides.bootstrapPort80));
  }
  if (overrides.bootstrapRealIp) {
    store.dispatch(setBootstrapRealIp(overrides.bootstrapRealIp));
  }
  if (overrides.dnsPreflightPassed) {
    store.dispatch(setDnsPreflightPassed(overrides.dnsPreflightPassed));
  }
  if (overrides.wildcardIssued) {
    store.dispatch(setWildcardIssued(overrides.wildcardIssued));
  }
  return store;
}

function renderWithStore(ui: React.ReactElement, overrides: StoreOverrides = {}) {
  const store = createTestStore(overrides);
  render(<Provider store={store}>{ui}</Provider>);
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
  it('shows a summary of the serving choice, no radio', () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });
    expect(screen.getByText(/another cdn or waf/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('LE path pre-satisfies the DNS confirmation', () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
    });
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeEnabled();
    expect(screen.getByText(/verified during the dns check/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('sends the v2 apply body, including port80 and realIp', async () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
      bootstrapPort80: 'closed',
      bootstrapRealIp: { header: 'True-Client-IP', ranges: ['1.2.3.0/24'] },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({
        domain: 'example.com',
        proxyMode: 'proxy',
        sslMode: 'paste',
        port80: 'closed',
        realIp: { header: 'True-Client-IP', ranges: ['1.2.3.0/24'] },
        token: 'claim-xyz',
      })
    );
  });

  it('sends undefined port80/realIp when not set in the store', async () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith({
        domain: 'example.com',
        proxyMode: 'cloudflare',
        sslMode: 'paste',
        port80: undefined,
        realIp: undefined,
        token: 'claim-xyz',
      })
    );
  });

  it('keeps the Full (strict) hint cloudflare-only', async () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'none',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    expect(await screen.findByText(/switching to/i)).toBeInTheDocument();
    expect(screen.queryByText(/full \(strict\)/i)).not.toBeInTheDocument();
  });

  it('shows the Full (strict) hint when the applied serving mode is cloudflare', async () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    expect(await screen.findByText(/switching to/i)).toBeInTheDocument();
    expect(screen.getByText(/full \(strict\)/i)).toBeInTheDocument();
  });

  it('shows the wildcard status for Let\'s Encrypt: issued', () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
      wildcardIssued: true,
    });
    expect(screen.getByText(/wildcard/i)).toBeInTheDocument();
    expect(screen.getByText(/issued/i)).toBeInTheDocument();
  });

  it('shows the wildcard status for Let\'s Encrypt: skipped', () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
      wildcardIssued: false,
    });
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
  });

  it('does not show wildcard status for a paste ssl mode', () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    expect(screen.queryByText(/wildcard/i)).not.toBeInTheDocument();
  });

  it('surfaces the backend error message and does not enter the switching state', async () => {
    const message = 'Certificates for example.com were not found. Upload them first.';
    applyMock.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message } }),
    });
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.queryByText(/switching to/i)).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the backend error has none', async () => {
    applyMock.mockReturnValue({ unwrap: () => Promise.reject({}) });
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });

    fireEvent.click(screen.getByRole('checkbox'));
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

    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
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

    const store = createTestStore({
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    const { unmount } = render(
      <Provider store={store}>
        <ApplyStep />
      </Provider>
    );

    fireEvent.click(screen.getByRole('checkbox'));
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
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('href', 'https://admin.example.com');
  });

  it('shows a manual-continue hint after about 30 seconds of failing polls, not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockRejectedValue(new Error('still restarting'));
    vi.stubGlobal('fetch', fetchMock);

    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
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

    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
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

  it('disables the button when there is no bootstrapDomain', () => {
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: null,
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
  });

  it('disables Finish until the DNS-confirmation checkbox is ticked, and does not apply before then', () => {
    // Guards the NXDOMAIN-cache trap: apply must be blocked until the user
    // confirms DNS already resolves to this server.
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    const button = screen.getByRole('button', { name: /finish setup/i });
    expect(button).toBeDisabled();
    // Clicking a disabled button must not fire apply.
    fireEvent.click(button);
    expect(applyMock).not.toHaveBeenCalled();
    // Tick the confirmation → enabled → apply fires.
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(applyMock).toHaveBeenCalled();
  });

  it('disables the button while the mutation is loading', () => {
    useApplyBootstrapMutationMock.mockReturnValue([applyMock, { isLoading: true }]);
    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
