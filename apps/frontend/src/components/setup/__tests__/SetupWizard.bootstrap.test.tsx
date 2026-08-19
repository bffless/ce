import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
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

// MemoryRouter keeps its location in-memory, independent of window.history,
// so a real address-bar assertion can't reach it. Mounting a probe inside
// the same <MemoryRouter> that reads the live search params (the same
// useSearchParams() the wizard itself relies on) is how the scrub gets
// observed from the outside.
function LocationSearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="location-search">{params.toString()}</div>;
}

function wizardTreeWithProbe(store: ReturnType<typeof createTestStore>, initialEntries: string[]) {
  return (
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationSearchProbe />
        <SetupWizard />
      </MemoryRouter>
    </Provider>
  );
}

function renderWizardWithProbe(initialEntries: string[] = ['/setup']) {
  const store = createTestStore();
  render(wizardTreeWithProbe(store, initialEntries));
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
    setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: false, hasAdminUser: true }));
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
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: false, hasAdminUser: true }));

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
        baseStatus({ bootstrapMode: false, hasAdminUser: true, storageProvider: 'minio' }),
      );

      renderWizard();

      expect(screen.getByText('CACHE STEP')).toBeInTheDocument();
    });
  });

  describe('skip-path token scrub (review follow-up: PR #536)', () => {
    // ClaimStep's own scrub effect only ever mounts on the NO-token path
    // (computeWizardSteps drops 'claim' precisely when a url token is
    // present), so the token-seeding path here — the one install.sh's
    // `?token=` links and the Platform relay actually take — must do its
    // own scrubbing. It must also survive re-render: once `urlToken` goes
    // back to null (post-scrub), computeWizardSteps must not resurrect the
    // claim step.
    it('scrubs the token from the URL while preserving other params, and stashes it', () => {
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));

      const store = renderWizardWithProbe(['/setup?token=platform-relay-token&foo=bar']);

      expect(store.getState().setup.wizard.claimToken).toBe('platform-relay-token');
      const probe = screen.getByTestId('location-search');
      const parsed = new URLSearchParams(probe.textContent ?? '');
      expect(parsed.has('token')).toBe(false);
      expect(parsed.get('foo')).toBe('bar');
    });

    it('does not resurrect the claim step after the URL is scrubbed (urlToken -> null on re-render)', () => {
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));

      renderWizardWithProbe(['/setup?token=platform-relay-token']);

      // Post-scrub: the url no longer carries the token ...
      expect(screen.getByTestId('location-search').textContent).toBe('');
      // ... yet the claim step must still be absent and the wizard must
      // still be showing the step right after it, not stranded/reset.
      expect(screen.queryByText(/claim this instance/i)).not.toBeInTheDocument();
      expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();
    });

    it('does not touch the URL when there is no ?token= to begin with', () => {
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));

      renderWizardWithProbe(['/setup']);

      expect(screen.getByTestId('location-search').textContent).toBe('');
      expect(screen.getByText(/claim this instance/i)).toBeInTheDocument();
    });
  });

  describe('manual claim submission must not collapse the step list (review r2 of PR #536)', () => {
    // ClaimStep's own handleSubmit ALSO dispatches setClaimToken (that's how
    // the manually-typed token reaches the store) — but that must NOT be
    // read by computeWizardSteps as "this came from the URL". If it were,
    // the claim step (and its progress-rail bubble) would vanish from the
    // list the instant a manual submission lands, in the same render that
    // is supposed to advance the user to the next step.
    it('keeps the claim step in the list after a manual ClaimStep submission (progress rail intact)', async () => {
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));
      const user = userEvent.setup();
      const store = renderWizard(); // no ?token= — the manual DigitalOcean-console path

      expect(screen.getByText(/claim this instance/i)).toBeInTheDocument();

      const input = screen.getByLabelText('Claim token');
      await user.type(input, 'manually-typed-token');
      await user.click(screen.getByRole('button', { name: /continue/i }));

      // Wizard advanced past claim to the next real step ...
      expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();
      // ... the token landed in the store via ClaimStep's real handleSubmit ...
      expect(store.getState().setup.wizard.claimToken).toBe('manually-typed-token');
      // ... it must NOT be flagged as URL-seeded ...
      expect(store.getState().setup.wizard.claimTokenFromUrl).toBe(false);
      // ... and the claim step must still be part of the active list (i.e.
      // the progress rail's "Claim" bubble is still rendered), not silently
      // dropped out from under the user mid-flow.
      expect(store.getState().setup.wizard.stepOrder).toContain('claim');
      expect(screen.getAllByText('Claim').length).toBeGreaterThan(0);
    });
  });

  describe('scrub-only-after-durable-persist (review r2 of PR #536)', () => {
    it('refresh-resume: a url-seeded token skips the claim step on a fresh remount with preserved sessionStorage', () => {
      // First "visit": the `?token=` relay link lands, gets seeded + scrubbed.
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));
      renderWizard(['/setup?token=platform-relay-token']);
      expect(sessionStorage.getItem('bffless.setup.claimToken')).toBe('platform-relay-token');
      expect(sessionStorage.getItem('bffless.setup.claimTokenFromUrl')).toBe('true');

      cleanup(); // simulate a full page reload: fresh component tree + store

      // Second "visit": no `?token=` in the URL anymore (it was scrubbed),
      // a brand-new store (Redux is in-memory and was cleared by the
      // reload), but sessionStorage survived. claimRequired is STILL true
      // (e.g. the admin-user refetch hasn't landed yet) — the claim step
      // must stay skipped because the token was URL-seeded, not because
      // claimRequired happened to flip false.
      renderWizard(['/setup']);
      expect(screen.queryByText(/claim this instance/i)).not.toBeInTheDocument();
      expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();
    });

    it('does not scrub the url token when sessionStorage.setItem throws (incognito) — token stays recoverable in the URL', () => {
      setMockStatus(baseStatus({ bootstrapMode: true, claimRequired: true }));
      const setItemSpy = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError: sessionStorage disabled (incognito)');
      });

      const store = renderWizardWithProbe(['/setup?token=platform-relay-token']);

      // The token is still usable from the store (downstream bootstrap
      // steps read it from there) ...
      expect(store.getState().setup.wizard.claimToken).toBe('platform-relay-token');
      // ... but since persistence failed, the URL must NOT be scrubbed —
      // leaving the token in the URL is the pre-fix, degraded-but-functional
      // behavior, and it remains recoverable (vs. losing it forever on the
      // next reload, since sessionStorage can't hold it either).
      const probe = screen.getByTestId('location-search');
      expect(probe.textContent).toBe('token=platform-relay-token');
      // The claim step is still correctly skipped since the token IS present.
      expect(screen.queryByText(/claim this instance/i)).not.toBeInTheDocument();
      expect(screen.getByText('ADMIN STEP')).toBeInTheDocument();

      setItemSpy.mockRestore();
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
          baseStatus({ bootstrapMode: true, claimRequired: false, hasAdminUser: true }),
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
      'some-token',
    );

    expect(steps).toEqual(['admin', 'storage', 'cache', 'email', 'complete']);
  });

  it('bootstrap mode + claimRequired: full 7-step list, claim first', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: true }),
      null,
    );

    expect(steps).toEqual(['claim', 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']);
  });

  it('bootstrap mode + claimRequired + ?token= present: claim step dropped', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: true }),
      'platform-relay-token',
    );

    expect(steps).toEqual(['admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']);
  });

  it('bootstrap mode + claimRequired + no urlToken but claimTokenFromUrl=true (post-scrub): claim step stays dropped', () => {
    // Reproduces the exact re-render this gating must survive: the
    // seeding effect scrubs `?token=` from the URL immediately after
    // stashing it, so urlToken goes back to null on the very next render.
    // Without honoring the dedicated claimTokenFromUrl flag as an
    // alternative signal, this would incorrectly resurrect 'claim'.
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: true }),
      null,
      true,
    );

    expect(steps).toEqual(['admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']);
  });

  it('bootstrap mode + claimRequired + no urlToken + bare claimToken set but claimTokenFromUrl=false: claim step stays (manual path)', () => {
    // The bug this gate exists to prevent: a manually-submitted claim token
    // must NOT be mistaken for a URL-seeded one. Gating on bare claimToken
    // truthiness (instead of the dedicated flag) would collapse the claim
    // step out of the list the instant ClaimStep's own handleSubmit
    // dispatches setClaimToken.
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: true }),
      null,
      false,
    );

    expect(steps).toEqual(['claim', 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']);
  });

  it('bootstrap mode without a required claim: 6-step list, no claim step', () => {
    const steps = computeWizardSteps(
      baseStatus({ bootstrapMode: true, claimRequired: false }),
      null,
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
