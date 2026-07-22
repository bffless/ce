import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { DomainSslStep } from '../DomainSslStep';
import { api } from '@/services/api';
import setupReducer, { ServingMode, BootstrapSslMode, setServingMode, setBootstrapSslMode } from '@/store/slices/setupSlice';

// DomainDnsPhase's LE preflight path drives useDnsPreflightMutation — mocked
// the same way ApplyStep.test.tsx / the old DomainSslStep.test.tsx mock their
// RTK Query hooks (this codebase has no MSW harness; hooks are mocked
// directly rather than intercepting network calls).
const preflightMock = vi.fn();
const useDnsPreflightMutationMock = vi.fn();

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/setupApi')>();
  return {
    ...mod,
    useDnsPreflightMutation: () => useDnsPreflightMutationMock(),
  };
});

function createTestStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      setup: setupReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
}

// Renders DomainSslStep wrapped in a fresh store, optionally preloaded past
// phase 1 (serving choice) — via the same reducer actions ServingChoicePhase
// itself would dispatch — so a test can start directly on the dns phase.
// Mirrors the brief's `renderWithStore(<X/>, overrides)` helper, adapted to
// this repo's real (non-MSW, dispatch-based) test harness.
function renderWithStore(
  ui: React.ReactElement,
  wizardOverrides: Partial<{ servingMode: ServingMode | null; bootstrapSslMode: BootstrapSslMode | null }> = {}
) {
  const store = createTestStore();
  if (wizardOverrides.servingMode !== undefined && wizardOverrides.servingMode !== null) {
    store.dispatch(setServingMode(wizardOverrides.servingMode));
  }
  if (wizardOverrides.bootstrapSslMode !== undefined) {
    store.dispatch(setBootstrapSslMode(wizardOverrides.bootstrapSslMode));
  }
  render(<Provider store={store}>{ui}</Provider>);
  return store;
}

// window.location is shared, mutable global state (see the old
// DomainSslStep.test.tsx / ApplyStep.test.tsx). Save + restore per test.
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, hostname },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', originalLocationDescriptor);
  cleanup();
});

beforeEach(() => {
  setHostname('admin.example.com');
  preflightMock.mockReset();
  preflightMock.mockReturnValue({
    unwrap: () =>
      Promise.resolve({
        ok: true,
        checks: [{ host: 'example.com', resolvedIps: ['203.0.113.10'], probeOk: true }],
      }),
  });
  useDnsPreflightMutationMock.mockReset();
  useDnsPreflightMutationMock.mockReturnValue([preflightMock, { isLoading: false }]);
});

describe('DomainSslStep', () => {
  it('starts on the serving choice and requires a selection', () => {
    renderWithStore(<DomainSslStep />);
    expect(screen.getByText(/how does traffic reach this server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('direct requires the cert sub-choice before advancing', async () => {
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/directly/i));
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    await user.click(screen.getByLabelText(/let's encrypt/i));
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('cloudflare path shows orange-cloud DNS copy on the dns phase', async () => {
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/cloudflare/i));
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/proxied/i)).toBeInTheDocument();
  });

  it('direct path shows gray-cloud DNS copy on the dns phase', async () => {
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/directly/i));
    await user.click(screen.getByLabelText(/let's encrypt/i));
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/gray cloud/i)).toBeInTheDocument();
  });

  it('LE path gates Next on a passing preflight', async () => {
    const user = userEvent.setup();
    preflightMock.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          ok: false,
          checks: [
            { host: 'example.com', resolvedIps: [], probeOk: false, error: 'Hostname does not resolve yet' },
          ],
        }),
    });
    renderWithStore(<DomainSslStep />, { servingMode: 'none', bootstrapSslMode: 'letsencrypt' });

    // The helper preloads the store so the component starts on the dns phase.
    expect(screen.getByLabelText(/domain/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/domain/i));
    await user.type(screen.getByLabelText(/domain/i), 'example.com');
    await user.click(screen.getByRole('button', { name: /check dns/i }));

    expect(await screen.findByText(/does not resolve yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('LE path enables Next once the preflight passes', async () => {
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />, { servingMode: 'none', bootstrapSslMode: 'letsencrypt' });

    await user.clear(screen.getByLabelText(/domain/i));
    await user.type(screen.getByLabelText(/domain/i), 'example.com');
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /check dns/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
  });

  it('paste (non-LE) direct path does not show the preflight checklist', async () => {
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/directly/i));
    await user.click(screen.getByLabelText(/paste my own certificate/i));
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.queryByRole('button', { name: /check dns/i })).not.toBeInTheDocument();
  });

  it('the dns phase Back button returns to the serving choice', async () => {
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/cloudflare/i));
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/point your domain at/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(/how does traffic reach this server/i)).toBeInTheDocument();
  });

  it('pre-fills domain from hostname, stripping a leading admin.', async () => {
    setHostname('admin.example.com');
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/cloudflare/i));
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByLabelText(/domain/i)).toHaveValue('example.com');
  });

  it('leaves domain empty when arriving via a bare IP, and surfaces the server IP', async () => {
    setHostname('203.0.113.10');
    const user = userEvent.setup();
    renderWithStore(<DomainSslStep />);
    await user.click(screen.getByLabelText(/directly/i));
    await user.click(screen.getByLabelText(/let's encrypt/i));
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByLabelText(/domain/i)).toHaveValue('');
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument();
  });
});
