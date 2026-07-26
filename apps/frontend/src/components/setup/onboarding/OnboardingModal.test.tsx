import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
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

function renderModal() {
  const store = configureStore({
    reducer: { setup: setupReducer, [api.reducerPath]: api.reducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });

  return render(
    <Provider store={store}>
      <OnboardingModal isOpen onClose={vi.fn()} />
    </Provider>
  );
}

describe('OnboardingModal', () => {
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
});
