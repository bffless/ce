import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { computeWizardSteps, SetupWizard } from '../SetupWizard';
import { api } from '@/services/api';
import setupReducer from '@/store/slices/setupSlice';
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

function renderWizard(initialEntries: string[] = ['/setup']) {
  const store = createTestStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        <SetupWizard />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('SetupWizard bootstrap-mode step gating', () => {
  beforeEach(() => {
    setMockStatus(undefined);
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
