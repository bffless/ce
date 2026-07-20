import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { computeWizardSteps, SetupWizard } from '../SetupWizard';
import { api } from '@/services/api';
import setupReducer, { nextWizardStep } from '@/store/slices/setupSlice';
import type { SetupStatusResponse } from '@/services/setupApi';

// Sub-steps other than ClaimStep have their own heavy dependencies (API
// hooks, form state); the wizard's job is only to pick the right one, so
// stub them out here and assert on which stub is mounted.
vi.mock('../AdminAccountStep', () => ({
  AdminAccountStep: () => <div>ADMIN STEP</div>,
}));
vi.mock('../DomainSslStep', () => ({
  DomainSslStep: () => <div>DOMAIN-SSL STEP</div>,
}));
vi.mock('../StorageStep', () => ({
  StorageStep: () => <div>STORAGE STEP</div>,
}));
vi.mock('../CacheStep', () => ({
  CacheStep: () => <div>CACHE STEP</div>,
}));
vi.mock('../EmailStep', () => ({
  EmailStep: () => <div>EMAIL STEP</div>,
}));
vi.mock('../ApplyStep', () => ({
  ApplyStep: () => <div>APPLY STEP</div>,
}));
vi.mock('../CompleteStep', () => ({
  CompleteStep: () => <div>COMPLETE STEP</div>,
}));

const { mockStatus, setMockStatus } = vi.hoisted(() => {
  let status: unknown = undefined;
  return {
    mockStatus: () => status,
    setMockStatus: (next: unknown) => {
      status = next;
    },
  };
});

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/setupApi')>();
  return {
    ...mod,
    useGetSetupStatusQuery: () => ({ data: mockStatus() }),
  };
});

function baseStatus(overrides: Partial<SetupStatusResponse> = {}): SetupStatusResponse {
  return {
    isSetupComplete: false,
    hasAdminUser: false,
    bootstrapMode: false,
    claimRequired: false,
    ...overrides,
  };
}

function createTestStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      setup: setupReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
}

function wizardTree(store: ReturnType<typeof createTestStore>, initialEntries: string[]) {
  return (
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        <SetupWizard />
      </MemoryRouter>
    </Provider>
  );
}

function renderWizard(initialEntries: string[] = ['/setup']) {
  const store = createTestStore();
  render(wizardTree(store, initialEntries));
  return store;
}

// Like renderWizard, but also returns `rerender` so a test can flip the
// mocked status (simulating a live getSetupStatus refetch landing) and
// force a re-render against the SAME component instance / store.
function renderWizardWithRerender(initialEntries: string[] = ['/setup']) {
  const store = createTestStore();
  const { rerender } = render(wizardTree(store, initialEntries));
  return {
    store,
    rerender: () => rerender(wizardTree(store, initialEntries)),
  };
}

describe('SetupWizard bootstrap-mode step gating', () => {
  beforeEach(() => {
    setMockStatus(undefined);
    // The wizard persists the claim token in sessionStorage; clear it so a
    // token stored by one test can't leak into another.
    sessionStorage.clear();
  });

  it('shows the claim step first in bootstrap mode with a required claim', () => {
    setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));

    renderWizard();

    expect(screen.getByText(/claim this instance/i)).toBeInTheDocument();
  });

  it('skips the claim step and stashes the token when ?token= is present', () => {
    setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));

    const store = renderWizard(['/setup?token=platform-relay-token']);

    expect(screen.queryByText(/claim this instance/i)).not.toBeInTheDocument();
    expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();
    expect(store.getState().setup.wizard.claimToken).toBe('platform-relay-token');
  });

  it('persists the ?token= relay token to sessionStorage', () => {
    setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));
    renderWizard(['/setup?token=platform-relay-token']);
    expect(sessionStorage.getItem('bffless.setup.claimToken')).toBe('platform-relay-token');
  });

  it('rehydrates the claim token from sessionStorage after a reload (no strand)', () => {
    // Reproduces the strand: the user entered the token and created the admin,
    // then reloaded (Redux cleared). claimRequired is now false (an admin
    // exists), so the claim step does NOT reappear — yet the session-less
    // cert/apply endpoints still need the token. Rehydrating it from
    // sessionStorage is what keeps those requests authenticated.
    sessionStorage.setItem('bffless.setup.claimToken', 'persisted-token');
    setMockStatus(
      baseStatus({ bootstrapMode: true, claimRequired: false, hasAdminUser: true })
    );
    const store = renderWizard(); // no ?token= in the URL
    // The claim step is not shown (admin already exists) ...
    expect(screen.queryByText(/claim this instance/i)).not.toBeInTheDocument();
    // ... but the token is back in the store, so DomainSslStep/ApplyStep can
    // send it instead of 401-ing.
    expect(store.getState().setup.wizard.claimToken).toBe('persisted-token');
  });

  it('does not show the claim step when claimRequired is false', () => {
    setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: false }));

    renderWizard();

    expect(screen.queryByText(/claim this instance/i)).not.toBeInTheDocument();
    expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();
  });

  describe('auto-advance past a completed admin step', () => {
    it('bootstrap mode: lands on domain-ssl (not storage) after admin', () => {
      setMockStatus(
        baseStatus({ bootstrapMode: true, claimRequired: false, hasAdminUser: true })
      );

      renderWizard();

      expect(screen.getByText('DOMAIN-SSL STEP')).toBeInTheDocument();
      expect(screen.queryByText('STORAGE STEP')).not.toBeInTheDocument();
    });

    it('normal mode: lands on storage after admin (unchanged behavior)', () => {
      setMockStatus(baseStatus({ bootstrapMode: false, hasAdminUser: true }));

      renderWizard();

      expect(screen.getByText('STORAGE STEP')).toBeInTheDocument();
    });

    it('normal mode: lands on cache once admin + storage are both done', () => {
      setMockStatus(
        baseStatus({ bootstrapMode: false, hasAdminUser: true, storageProvider: 'minio' })
      );

      renderWizard();

      expect(screen.getByText('CACHE STEP')).toBeInTheDocument();
    });
  });

  describe('Critical-1 regression: claimRequired flipping mid-session must not relocate the user', () => {
    it('reproduces the failure trace: claim -> admin -> domain-ssl, then the 7->6 shrink must not land on storage', () => {
      // No `?token=` in the URL — the DigitalOcean console-token flow.
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));
      const { store, rerender } = renderWizardWithRerender();

      // Initial list is the full 7-step bootstrap list, claim first.
      expect(screen.getByText(/claim this instance/i)).toBeInTheDocument();

      // ClaimStep's Continue button dispatches nextWizardStep() — simulate
      // that directly rather than re-deriving ClaimStep's own form/submit
      // wiring, which is exercised elsewhere.
      act(() => {
        store.dispatch(nextWizardStep());
      });
      rerender();
      expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();

      // AdminAccountStep's onSuccess handler dispatches nextWizardStep()
      // immediately after `initialize()` resolves — BEFORE the invalidated
      // 'Setup' query's refetch has landed, so this still runs against the
      // (still 7-item) bootstrap list.
      act(() => {
        store.dispatch(nextWizardStep());
      });
      rerender();
      expect(screen.getByText('DOMAIN-SSL STEP')).toBeInTheDocument();

      // Now the refetch lands: hasAdminUser=true, so claimRequired flips
      // false and the step list shrinks from 7 to 6 (claim drops out) —
      // every subsequent index shifts left by one.
      act(() => {
        setMockStatus(
          baseStatus({ bootstrapMode: true, claimRequired: false, hasAdminUser: true })
        );
      });
      rerender();

      // BUG (pre-fix): a numeric currentStep=3 into the new 6-item list
      // resolves to 'storage' (steps[2]), silently relocating the user off
      // Domain & SSL with bootstrapDomain still unset.
      expect(screen.getByText('DOMAIN-SSL STEP')).toBeInTheDocument();
      expect(screen.queryByText('STORAGE STEP')).not.toBeInTheDocument();
    });
  });
});

describe('computeWizardSteps (regression guard: normal mode is unchanged)', () => {
  it('normal (non-bootstrap) mode is exactly the pre-existing 5-step list', () => {
    const steps = computeWizardSteps(baseStatus({ bootstrapMode: false }), null);

    expect(steps).toEqual(['admin', 'storage', 'cache', 'email', 'complete']);
  });

  it('normal mode ignores claimRequired and a ?token= entirely', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: false, claimRequired: true }),
      'some-token'
    );

    expect(steps).toEqual(['admin', 'storage', 'cache', 'email', 'complete']);
  });

  it('bootstrap mode + claimRequired: full 7-step list, claim first', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: true }),
      null
    );

    expect(steps).toEqual([
      'claim',
      'admin',
      'domain-ssl',
      'storage',
      'cache',
      'email',
      'apply',
    ]);
  });

  it('bootstrap mode + claimRequired + ?token= present: claim step dropped', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: true }),
      'platform-relay-token'
    );

    expect(steps).toEqual(['admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']);
  });

  it('bootstrap mode without a required claim: 6-step list, no claim step', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: false }),
      null
    );

    expect(steps).toEqual(['admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']);
  });

  it('undefined status (still loading) behaves as normal mode', () => {
    expect(computeWizardSteps(undefined, null)).toEqual([
      'admin',
      'storage',
      'cache',
      'email',
      'complete',
    ]);
  });
});
