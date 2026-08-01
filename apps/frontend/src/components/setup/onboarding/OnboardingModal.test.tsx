import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingModal } from './OnboardingModal';
import { api } from '@/services/api';
import setupReducer from '@/store/slices/setupSlice';

// This codebase has no MSW harness — RTK Query hooks are mocked directly, the
// same pattern the setup wizard tests use.
vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({ siteName: 'BFFLESS' }),
}));

vi.mock('@/services/projectsApi', () => ({
  useCreateProjectMutation: () => [vi.fn(), { isLoading: false }],
}));

// Role drives whether the welcome step shows the apps path (/apps is admin-only).
const mockSession = vi.fn();
vi.mock('@/services/authApi', () => ({
  useGetSessionQuery: () => mockSession(),
}));

// The apps path is also gated on ENABLE_APP_CATALOG — default to enabled so
// existing admin tests still see the apps path unless a test overrides it.
const mockFlags = vi.fn();
vi.mock('@/services/featureFlagsApi', () => ({
  useFeatureFlags: () => mockFlags(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

function renderModal({ onClose = vi.fn() } = {}) {
  const store = configureStore({
    reducer: { setup: setupReducer, [api.reducerPath]: api.reducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });

  render(
    <Provider store={store}>
      <MemoryRouter>
        <OnboardingModal isOpen onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );
  return { store, onClose };
}

describe('OnboardingModal', () => {
  beforeEach(() => {
    mockSession.mockReturnValue({ data: { user: { role: 'user' } } });
    mockFlags.mockReturnValue({ isEnabled: () => true });
    mockNavigate.mockClear();
  });
  afterEach(cleanup);

  it('opens on the welcome step, not the repository form', () => {
    renderModal();

    expect(screen.getByText('Welcome to BFFLESS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /first-deployment guide/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Repository Name')).toBeNull();
  });

  it('advances from welcome to the repository form', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Get Started' }));

    expect(screen.getByText('Create Your First Repository')).toBeInTheDocument();
    expect(screen.getByLabelText('Repository Name')).toBeInTheDocument();
  });

  it('shows the apps path only to admins, and Browse apps completes + routes to /apps', async () => {
    mockSession.mockReturnValue({ data: { user: { role: 'admin' } } });
    const { store, onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Browse apps' }));

    expect(store.getState().setup.onboarding.hasCompletedOnboarding).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/apps');
  });

  it('admins can still take the repository path', async () => {
    mockSession.mockReturnValue({ data: { user: { role: 'admin' } } });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Create a repository' }));

    expect(screen.getByText('Create Your First Repository')).toBeInTheDocument();
  });

  it('hides the apps path for admins when ENABLE_APP_CATALOG is off', () => {
    mockSession.mockReturnValue({ data: { user: { role: 'admin' } } });
    mockFlags.mockReturnValue({ isEnabled: () => false });
    renderModal();

    expect(screen.queryByRole('button', { name: 'Browse apps' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument();
  });
});
